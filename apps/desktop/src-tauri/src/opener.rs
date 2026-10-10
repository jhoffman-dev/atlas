//! Opening a link in the person's own browser — an artifact's claude.ai page.
//!
//! The webview must never navigate away from the app, and a page it shows
//! must never be able to open things on the machine; so this is the one way
//! out, and it opens only web addresses. What to open, and when, is decided in
//! TypeScript.

use std::process::Command;

use reqwest::Url;

/// A link this may open: `http` or `https`, nothing that reaches the machine
/// (`file:`), runs something (`javascript:`), or hands off to another app.
fn openable(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|_| format!("{raw:?} is not a link"))?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        scheme => Err(format!("only web links can be opened, not {scheme}:")),
    }
}

#[cfg(target_os = "macos")]
fn browser(url: &str) -> Command {
    let mut command = Command::new("open");
    command.arg(url);
    command
}

#[cfg(target_os = "windows")]
fn browser(url: &str) -> Command {
    // `explorer <url>` hands the link to the default browser, with no shell to
    // read `&` in a query string as a second command.
    let mut command = Command::new("explorer");
    command.arg(url);
    command
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn browser(url: &str) -> Command {
    let mut command = Command::new("xdg-open");
    command.arg(url);
    command
}

/// Opens a web link in the default browser. The link is passed as one
/// argument, never through a shell.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let target = openable(&url)?;
    open_web_link(&target)?;
    log::info!("opened {target}");
    Ok(())
}

/// Opens a link the host made itself — a sign-in page — in the default
/// browser. Not logged: the link carries the sign-in's `state`.
pub fn open_web_link(target: &Url) -> Result<(), String> {
    openable(target.as_str())?;
    browser(target.as_str())
        .spawn()
        .map_err(|error| format!("cannot open the browser: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::openable;

    #[test]
    fn opens_web_links() {
        assert!(openable("https://claude.ai/artifact/abc").is_ok());
        assert!(openable(" http://localhost:3000/x ").is_ok());
    }

    #[test]
    fn refuses_anything_that_is_not_a_web_link() {
        for raw in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "vscode://open",
            "not a link",
        ] {
            assert!(openable(raw).is_err(), "{raw} should be refused");
        }
    }
}
