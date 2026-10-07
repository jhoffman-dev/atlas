//! Keeps every frame in the webview on the app's own pages.
//!
//! A saved artifact is a stranger's page shown in a sandboxed frame. Its
//! policy governs one document: a `<meta http-equiv=refresh>` or a
//! `location = …` would replace it with a live remote page, under no policy,
//! inside the app's pane — and a link dropped on the window would replace the
//! app itself. On macOS the navigation handler is asked about every frame's
//! navigations, not only the window's, so refusing here covers both. Links
//! meant for the browser go out through `opener`, never by navigating.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime, Url,
};

/// Whether a frame may load `url`: the app's own pages, the empty and inline
/// documents a frame starts as (`about:blank`, `about:srcdoc`), and — in
/// development only — the dev server the app is served from.
fn stays_in_app(url: &Url, dev_server: Option<&Url>) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        // Windows serves the app from `http://tauri.localhost`.
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        _ => dev_server.is_some_and(|dev| dev.origin() == url.origin()),
    }
}

/// The plugin that refuses, for every frame, a navigation off the app.
pub fn guard<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            let config = webview.config();
            let dev_server = if tauri::is_dev() {
                config.build.dev_url.as_ref()
            } else {
                None
            };
            let allowed = stays_in_app(url, dev_server);
            if !allowed {
                log::warn!("refused a navigation to {url}");
            }
            allowed
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("a test URL parses")
    }

    #[test]
    fn allows_the_app_and_a_frame_s_starting_documents() {
        for raw in [
            "tauri://localhost/",
            "tauri://localhost/index.html#x",
            "http://tauri.localhost/",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(stays_in_app(&url(raw), None), "{raw} should be allowed");
        }
    }

    #[test]
    fn refuses_any_other_site_or_scheme() {
        for raw in [
            "https://beacon.test/refresh",
            "http://localhost:1420/",
            "file:///etc/passwd",
            "data:text/html,<p>x",
            "javascript:alert(1)",
            "https://tauri.localhost.evil.test/",
        ] {
            assert!(!stays_in_app(&url(raw), None), "{raw} should be refused");
        }
    }

    #[test]
    fn allows_the_dev_server_only_when_there_is_one() {
        let dev = url("http://localhost:1420");
        assert!(stays_in_app(&url("http://localhost:1420/note"), Some(&dev)));
        assert!(!stays_in_app(&url("http://localhost:9999/"), Some(&dev)));
        assert!(!stays_in_app(&url("https://beacon.test/"), Some(&dev)));
    }
}
