//! Amazon's Kindle notebook, read in a session of its own (#508).
//!
//! **Connect Kindle** opens a window of DFAI's own on Amazon, in a WebKit data
//! store used by nothing else, where the person signs in once. A sync then
//! asks for notebook pages; the host reads the session's cookies from that
//! store, sends them to the notebook, and hands back the page's HTML, raw.
//! No cookie reaches the main webview, the vault, a log or an IPC payload:
//! what comes back is a status, the HTML (any cookie value it echoes struck)
//! and where a redirect off the notebook pointed.
//!
//! What is decided in TypeScript, as every rule is (ADR-0005): which pages to
//! ask for, what they mean, what to write, and what to tell the person. What
//! the host holds is where the session may go — the notebook's origin and its
//! paths, fixed here rather than named by the webview, as `granola.rs` fixes
//! Granola's (ADR-0017) — and where the sign-in window may go: Amazon, over
//! https. Nothing is sent when the store holds no session, so a sync that was
//! never connected never reaches Amazon.

use reqwest::Url;
use tauri::{AppHandle, Runtime};

pub mod cookies;
pub mod failure;
pub mod fetch;
pub mod notebook_url;
#[cfg(target_os = "macos")]
mod session_macos;

#[cfg(test)]
mod fake_amazon;
#[cfg(test)]
mod tests;

pub use failure::{FailureKind, KindleFailure};
pub use fetch::KindlePage;

use cookies::{has_session_for, SessionCookie};
use fetch::{fetch_page, Fetch, REQUEST_TIMEOUT};
use notebook_url::notebook_url;

const ORIGIN: &str = "https://read.amazon.com";

#[cfg(target_os = "macos")]
/// Where the sign-in window opens: the notebook, which sends a signed-out
/// person to Amazon's sign-in and back.
const SIGN_IN_START: &str = "https://read.amazon.com/notebook";

/// Amazon's own site, and every subdomain of it, is where the sign-in window
/// may go: sign-in, two-step, the robot check and the notebook itself.
const AMAZON_DOMAIN: &str = "amazon.com";

/// Whether the sign-in window may load `raw`: Amazon over https, or the blank
/// page WebKit starts on. Anything else — a link off Amazon — is refused.
pub fn sign_in_may_load(raw: &str) -> bool {
    if raw == "about:blank" {
        return true;
    }
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    url.scheme() == "https"
        && url.port().is_none()
        && (host == AMAZON_DOMAIN || host.ends_with(&format!(".{AMAZON_DOMAIN}")))
}

fn origin() -> Url {
    Url::parse(ORIGIN).expect("the notebook's origin is a URL")
}

fn not_connected() -> KindleFailure {
    KindleFailure::new(
        FailureKind::NotConnected,
        "Kindle is not connected on this Mac",
    )
}

#[cfg(target_os = "macos")]
fn needs_macos_14() -> KindleFailure {
    KindleFailure::new(
        FailureKind::Refused,
        "Kindle sync needs macOS 14 or later, which keeps its Amazon session apart from the rest of DFAI",
    )
}

/// What a notebook fetch is given: the raw URL the webview named, and the
/// session read from the store.
pub struct NotebookRequest<'a> {
    pub origin: &'a Url,
    pub url: &'a str,
    pub cookies: &'a [SessionCookie],
    pub timeout: std::time::Duration,
}

/// Fetches the notebook page the webview named, if it is one and there is a
/// session to send.
pub async fn fetch_notebook(request: NotebookRequest<'_>) -> Result<KindlePage, KindleFailure> {
    let url = notebook_url(request.origin, request.url)?;
    if !has_session_for(request.cookies, &url) {
        return Err(not_connected());
    }
    fetch_page(Fetch {
        origin: request.origin,
        url,
        cookies: request.cookies,
        timeout: request.timeout,
    })
    .await
}

/// A notebook page, as `readKindleLibrary` and `readKindleAnnotations` read it.
#[tauri::command]
pub async fn kindle_fetch_notebook<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<KindlePage, KindleFailure> {
    let origin = origin();
    // The URL is checked before the store is opened: a refusal costs nothing.
    notebook_url(&origin, &url)?;
    let cookies = platform::session_cookies(&app).await?;
    fetch_notebook(NotebookRequest {
        origin: &origin,
        url: &url,
        cookies: &cookies,
        timeout: REQUEST_TIMEOUT,
    })
    .await
}

/// Opens the sign-in window; answers when the person closes it.
#[tauri::command]
pub async fn kindle_connect<R: Runtime>(app: AppHandle<R>) -> Result<(), KindleFailure> {
    platform::connect(&app).await
}

/// Forgets the session: deletes its data store, and every cookie in it.
#[tauri::command]
pub async fn kindle_disconnect<R: Runtime>(app: AppHandle<R>) -> Result<(), KindleFailure> {
    platform::disconnect(&app).await
}

#[cfg(target_os = "macos")]
mod platform {
    use std::time::Duration;

    use tauri::{AppHandle, Runtime};
    use tokio::sync::oneshot;

    use super::cookies::SessionCookie;
    use super::failure::{FailureKind, KindleFailure};
    use super::{needs_macos_14, session_macos, sign_in_may_load, SIGN_IN_START};

    /// Reading the store is a moment's work for WebKit; past this, the main
    /// thread is stuck and the fetch gives up rather than wait on it.
    const COOKIES_TIMEOUT: Duration = Duration::from_secs(10);

    fn unreachable_main(error: impl std::fmt::Display) -> KindleFailure {
        KindleFailure::new(
            FailureKind::Refused,
            format!("cannot reach the main thread: {error}"),
        )
    }

    fn given_up() -> KindleFailure {
        KindleFailure::new(FailureKind::Refused, "the Kindle session could not be read")
    }

    /// Runs `job` on the main thread, if this Mac has stores of a session's own.
    fn on_main<R: Runtime>(
        app: &AppHandle<R>,
        job: impl FnOnce(objc2::MainThreadMarker) + Send + 'static,
    ) -> Result<(), KindleFailure> {
        if !session_macos::has_stores_of_its_own() {
            return Err(needs_macos_14());
        }
        app.run_on_main_thread(move || {
            // Tauri runs this on the main thread; if not, the job is dropped
            // and its caller hears that it was given up.
            if let Some(main) = objc2::MainThreadMarker::new() {
                job(main);
            }
        })
        .map_err(unreachable_main)
    }

    pub async fn session_cookies<R: Runtime>(
        app: &AppHandle<R>,
    ) -> Result<Vec<SessionCookie>, KindleFailure> {
        let (sender, receiver) = oneshot::channel();
        on_main(app, move |main| {
            session_macos::read_cookies(
                main,
                Box::new(move |cookies| {
                    // The fetch stopped waiting (its own timeout): nobody to tell.
                    let _ = sender.send(cookies);
                }),
            );
        })?;
        tokio::time::timeout(COOKIES_TIMEOUT, receiver)
            .await
            .map_err(|_| given_up())?
            .map_err(|_| given_up())
    }

    pub async fn connect<R: Runtime>(app: &AppHandle<R>) -> Result<(), KindleFailure> {
        let (sender, receiver) = oneshot::channel();
        let (opened, opening) = oneshot::channel();
        on_main(app, move |main| {
            let result = session_macos::open_sign_in(
                main,
                SIGN_IN_START,
                sign_in_may_load,
                Box::new(move || {
                    // The webview stopped waiting for the window: nobody to tell.
                    let _ = sender.send(());
                }),
            );
            // The command is always waiting for this; a closed channel is a cancelled command.
            let _ = opened.send(result);
        })?;
        opening
            .await
            .map_err(|_| given_up())?
            .map_err(|message| KindleFailure::new(FailureKind::Refused, message))?;
        // The person may take as long as they like; a dropped sender is a
        // window that went away, which is closed too.
        let _ = receiver.await;
        Ok(())
    }

    pub async fn disconnect<R: Runtime>(app: &AppHandle<R>) -> Result<(), KindleFailure> {
        let (sender, receiver) = oneshot::channel();
        on_main(app, move |main| {
            session_macos::remove_store(
                main,
                Box::new(move |result| {
                    // The command is waiting for this; a closed channel is a cancelled command.
                    let _ = sender.send(result);
                }),
            );
        })?;
        receiver
            .await
            .map_err(|_| given_up())?
            .map_err(|message| KindleFailure::new(FailureKind::Refused, message))
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::{AppHandle, Runtime};

    use super::cookies::SessionCookie;
    use super::failure::{FailureKind, KindleFailure};

    fn needs_macos() -> KindleFailure {
        KindleFailure::new(FailureKind::Refused, "Kindle sync needs macOS")
    }

    pub async fn session_cookies<R: Runtime>(
        _app: &AppHandle<R>,
    ) -> Result<Vec<SessionCookie>, KindleFailure> {
        Err(needs_macos())
    }

    pub async fn connect<R: Runtime>(_app: &AppHandle<R>) -> Result<(), KindleFailure> {
        Err(needs_macos())
    }

    pub async fn disconnect<R: Runtime>(_app: &AppHandle<R>) -> Result<(), KindleFailure> {
        Err(needs_macos())
    }
}
