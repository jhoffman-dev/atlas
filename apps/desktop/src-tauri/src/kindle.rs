//! Amazon's Kindle notebook, read in a session of its own (#508, ADR-0044).
//!
//! **Connect Kindle** opens a window of DFAI's own on Amazon, in a WebKit data
//! store used by nothing else, where the person signs in once. A sync then
//! asks for notebook pages. The host loads the notebook in a hidden window
//! of that same store, with every navigation and response policed to the
//! notebook, and fetches each page from inside it with a same-origin
//! `fetch`: Amazon's cookies go with the request as they do for a browser and
//! never become a string of DFAI's. What comes back is the page's status and
//! HTML, raw, and where a redirect off the notebook pointed.
//!
//! What is decided in TypeScript, as every rule is (ADR-0005): which pages to
//! ask for, what they mean, what to write, and what to tell the person. What
//! the host holds is where the session may go — the notebook's origin and its
//! paths, fixed here rather than named by the webview, as `granola.rs` fixes
//! Granola's (ADR-0017) — and where the sign-in window may go: Amazon, over
//! https. With no session in the store the notebook sends the hidden window
//! to Amazon's sign-in, which is stopped there and reported as a redirect;
//! the person never sees it, and no sign-in page is ever loaded unseen.

use reqwest::Url;
use tauri::{AppHandle, Runtime};

pub mod failure;
pub mod notebook_url;
pub mod page_script;
#[cfg(target_os = "macos")]
mod session_macos;

#[cfg(test)]
mod tests;

pub use failure::KindleFailure;
pub use page_script::KindlePage;

use notebook_url::{is_notebook_page, notebook_url};

const ORIGIN: &str = "https://read.amazon.com";

/// Where the sign-in window opens, and the hidden window starts: the
/// notebook, which sends a signed-out person to Amazon's sign-in and back.
#[cfg(target_os = "macos")]
const NOTEBOOK_START: &str = "https://read.amazon.com/notebook";

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

/// Whether the hidden window may load `raw`: a notebook page, nothing else.
/// Amazon's sign-in is not allowed here — it is stopped and reported.
pub fn reader_may_load(raw: &str) -> bool {
    raw == "about:blank" || Url::parse(raw).is_ok_and(|url| is_notebook_page(&origin(), &url))
}

fn origin() -> Url {
    Url::parse(ORIGIN).expect("the notebook's origin is a URL")
}

/// The path and query of a notebook URL, as the hidden window fetches it.
fn path_and_query(url: &Url) -> String {
    match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    }
}

/// A notebook page, as `readKindleLibrary` and `readKindleAnnotations` read it.
#[tauri::command]
pub async fn kindle_fetch_notebook<R: Runtime>(
    app: AppHandle<R>,
    url: String,
) -> Result<KindlePage, KindleFailure> {
    // The URL is checked before any window is made: a refusal costs nothing.
    let url = notebook_url(&origin(), &url)?;
    platform::fetch(&app, &path_and_query(&url)).await
}

/// Opens the sign-in window; answers when the person closes it.
#[tauri::command]
pub async fn kindle_connect<R: Runtime>(app: AppHandle<R>) -> Result<(), KindleFailure> {
    platform::connect(&app).await
}

/// Forgets the session: deletes its data store, and every cookie in it. This
/// is local: it does not sign the person out on Amazon.
#[tauri::command]
pub async fn kindle_disconnect<R: Runtime>(app: AppHandle<R>) -> Result<(), KindleFailure> {
    platform::disconnect(&app).await
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

    use objc2::MainThreadMarker;
    use tauri::{AppHandle, Runtime};
    use tokio::sync::{oneshot, Mutex};

    use super::failure::{FailureKind, KindleFailure};
    use super::page_script::{
        fetch_script, read_answer, KindlePage, ScriptAnswer, REQUEST_TIMEOUT,
    };
    use super::session_macos::{self, Loaded};
    use super::{sign_in_may_load, NOTEBOOK_START};

    /// The hidden window is let go this long after the last fetch; a sync's
    /// pages follow one another well inside it.
    const IDLE_RELEASE: Duration = Duration::from_secs(60);

    /// One fetch at a time: the hidden window loads one page, and a second
    /// load would take the first one's place.
    static FETCHING: Mutex<()> = Mutex::const_new(());
    static LAST_FETCH: AtomicU64 = AtomicU64::new(0);

    fn unreachable_main(error: impl std::fmt::Display) -> KindleFailure {
        KindleFailure::new(
            FailureKind::Refused,
            format!("cannot reach the main thread: {error}"),
        )
    }

    fn given_up() -> KindleFailure {
        KindleFailure::new(FailureKind::Refused, "the Kindle session could not be read")
    }

    fn needs_macos_14() -> KindleFailure {
        KindleFailure::new(
            FailureKind::Unsupported,
            "Kindle sync needs macOS 14 or later, which keeps its Amazon session apart from the rest of DFAI",
        )
    }

    fn cannot_reach(kind: FailureKind) -> KindleFailure {
        KindleFailure::new(kind, "cannot reach Amazon")
    }

    /// Runs `job` on the main thread, if this Mac has stores of a session's own.
    fn on_main<R: Runtime>(
        app: &AppHandle<R>,
        job: impl FnOnce(MainThreadMarker) + Send + 'static,
    ) -> Result<(), KindleFailure> {
        if !session_macos::has_stores_of_its_own() {
            return Err(needs_macos_14());
        }
        app.run_on_main_thread(move || {
            // Tauri runs this on the main thread; if not, the job is dropped
            // and its caller hears that it was given up.
            if let Some(main) = MainThreadMarker::new() {
                job(main);
            }
        })
        .map_err(unreachable_main)
    }

    /// Runs `job` on the main thread and waits for the answer it gives, for
    /// at most `timeout`; past it the hidden window is let go.
    async fn ask<R: Runtime, T: Send + 'static>(
        app: &AppHandle<R>,
        timeout: Duration,
        job: impl FnOnce(MainThreadMarker, Box<dyn FnOnce(T)>) + Send + 'static,
    ) -> Result<T, KindleFailure> {
        let (sender, receiver) = oneshot::channel();
        on_main(app, move |main| {
            job(
                main,
                Box::new(move |answer| {
                    // The command stopped waiting (its own timeout): nobody to tell.
                    let _ = sender.send(answer);
                }),
            );
        })?;
        match tokio::time::timeout(timeout, receiver).await {
            Ok(answer) => answer.map_err(|_| given_up()),
            Err(_) => {
                // A hung window would be asked again on the next fetch; start afresh.
                let _ = on_main(app, |_| session_macos::reset_reader());
                Err(cannot_reach(FailureKind::Timeout))
            }
        }
    }

    fn redirected(target: String) -> KindlePage {
        KindlePage {
            status: 302,
            html: String::new(),
            redirected_to: (!target.is_empty()).then_some(target),
        }
    }

    async fn load_notebook<R: Runtime>(app: &AppHandle<R>) -> Result<Loaded, KindleFailure> {
        ask(app, REQUEST_TIMEOUT, |main, done| {
            session_macos::load_notebook(main, done)
        })
        .await
    }

    /// The hidden window's own navigation, which is policed and can say where
    /// Amazon sent it, where a script's `fetch` could only fail.
    async fn look_at_navigation<R: Runtime>(
        app: &AppHandle<R>,
    ) -> Result<KindlePage, KindleFailure> {
        on_main(app, |_| session_macos::reset_reader())?;
        match load_notebook(app).await? {
            Loaded::Blocked(target) => Ok(redirected(target)),
            Loaded::Page => Err(cannot_reach(FailureKind::Unreachable)),
            Loaded::Failed { timed_out } => Err(cannot_reach(if timed_out {
                FailureKind::Timeout
            } else {
                FailureKind::Unreachable
            })),
        }
    }

    async fn fetch_loaded<R: Runtime>(
        app: &AppHandle<R>,
        path_and_query: &str,
    ) -> Result<KindlePage, KindleFailure> {
        // Before any window: with no store there is no session, and nothing
        // is sent to Amazon for a Mac that was never connected.
        let connected = ask(app, REQUEST_TIMEOUT, |main, done| {
            session_macos::store_exists(main, done)
        })
        .await?;
        if !connected {
            return Err(KindleFailure::new(
                FailureKind::NotConnected,
                "Kindle is not connected on this Mac",
            ));
        }
        match load_notebook(app).await? {
            Loaded::Page => {}
            Loaded::Blocked(target) => return Ok(redirected(target)),
            Loaded::Failed { timed_out } => {
                return Err(cannot_reach(if timed_out {
                    FailureKind::Timeout
                } else {
                    FailureKind::Unreachable
                }))
            }
        }
        let script = fetch_script(path_and_query);
        let answer = ask(app, REQUEST_TIMEOUT, move |main, done| {
            session_macos::run_script(main, &script, done)
        })
        .await?;
        let json = answer.map_err(|()| cannot_reach(FailureKind::Unreachable))?;
        match read_answer(&json)? {
            ScriptAnswer::Page(page) => Ok(page),
            ScriptAnswer::LookAtNavigation => look_at_navigation(app).await,
        }
    }

    pub async fn fetch<R: Runtime>(
        app: &AppHandle<R>,
        path_and_query: &str,
    ) -> Result<KindlePage, KindleFailure> {
        let result = {
            let _one_at_a_time = FETCHING.lock().await;
            fetch_loaded(app, path_and_query).await
        };
        release_when_idle(app);
        result
    }

    fn release_when_idle<R: Runtime>(app: &AppHandle<R>) {
        let this_fetch = LAST_FETCH.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(IDLE_RELEASE).await;
            if LAST_FETCH.load(Ordering::SeqCst) == this_fetch {
                // Best effort: a window that is not let go now is at the next fetch.
                let _ = on_main(&app, |_| session_macos::reset_reader());
            }
        });
    }

    pub async fn connect<R: Runtime>(app: &AppHandle<R>) -> Result<(), KindleFailure> {
        let (sender, receiver) = oneshot::channel();
        let (opened, opening) = oneshot::channel();
        on_main(app, move |main| {
            let result = session_macos::open_sign_in(
                main,
                NOTEBOOK_START,
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
        // The hidden window may hold the page of before the sign-in.
        on_main(app, |_| session_macos::reset_reader())
    }

    pub async fn disconnect<R: Runtime>(app: &AppHandle<R>) -> Result<(), KindleFailure> {
        let _one_at_a_time = FETCHING.lock().await;
        // Its own turn of the main thread, so that WebKit has let the hidden
        // window go before the store is removed.
        on_main(app, |_| session_macos::reset_reader())?;
        let removed = ask(app, REQUEST_TIMEOUT, |main, done| {
            session_macos::remove_store(main, done)
        })
        .await?;
        removed.map_err(|message| KindleFailure::new(FailureKind::Refused, message))
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::{AppHandle, Runtime};

    use super::failure::{FailureKind, KindleFailure};
    use super::page_script::KindlePage;

    fn needs_macos() -> KindleFailure {
        KindleFailure::new(FailureKind::Unsupported, "Kindle sync needs macOS")
    }

    pub async fn fetch<R: Runtime>(
        _app: &AppHandle<R>,
        _path_and_query: &str,
    ) -> Result<KindlePage, KindleFailure> {
        Err(needs_macos())
    }

    pub async fn connect<R: Runtime>(_app: &AppHandle<R>) -> Result<(), KindleFailure> {
        Err(needs_macos())
    }

    pub async fn disconnect<R: Runtime>(_app: &AppHandle<R>) -> Result<(), KindleFailure> {
        Err(needs_macos())
    }
}
