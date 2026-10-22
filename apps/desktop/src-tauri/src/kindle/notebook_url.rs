//! Where the Kindle session may be sent: the notebook, and nowhere else.
//!
//! Which page to ask for is TypeScript's (`kindleAnnotationsUrl`); that the
//! session's cookies go only to the notebook is the host's, because the
//! webview is the untrusted side (ADR-0017). So the webview names a URL and
//! the host refuses any that is not on the notebook's origin — scheme, host
//! and port — at one of its two paths. The same check polices every
//! navigation and response of the window that reads the notebook.

use reqwest::Url;

use super::failure::{FailureKind, KindleFailure};

/// The notebook's paths: `/notebook`, and `/kp/notebook`, where Amazon has
/// served the same page.
pub const NOTEBOOK_PATHS: [&str; 2] = ["/notebook", "/kp/notebook"];

fn refused(raw: &str) -> KindleFailure {
    // The address is the webview's own; naming it carries no cookie.
    KindleFailure::new(
        FailureKind::Refused,
        format!("{raw:?} is not a page of the Kindle notebook"),
    )
}

/// Whether `url` is a notebook page at `origin`, as the parser reads it.
pub fn is_notebook_page(origin: &Url, url: &Url) -> bool {
    url.origin() == origin.origin()
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && NOTEBOOK_PATHS.contains(&url.path())
}

/// Where `raw` points, as an origin and a path: never its query, fragment or
/// user info, which a sign-in URL fills with tokens. Empty when it is no URL.
pub fn shown_target(raw: &str) -> String {
    Url::parse(raw)
        .map(|url| format!("{}{}", url.origin().ascii_serialization(), url.path()))
        .unwrap_or_default()
}

/// `raw` as a URL, if it is a notebook page at `origin`.
pub fn notebook_url(origin: &Url, raw: &str) -> Result<Url, KindleFailure> {
    let url = Url::parse(raw).map_err(|_| refused(raw))?;
    if is_notebook_page(origin, &url) {
        Ok(url)
    } else {
        Err(refused(raw))
    }
}

#[cfg(test)]
mod tests {
    use reqwest::Url;

    use super::notebook_url;
    use crate::kindle::failure::FailureKind;

    fn origin() -> Url {
        Url::parse("https://read.amazon.com").unwrap()
    }

    #[test]
    fn the_library_and_a_book_page_may_be_fetched() {
        for raw in [
            "https://read.amazon.com/notebook",
            "https://read.amazon.com/notebook?asin=B0EXAMPLE1&contentLimitState=&token=",
            "https://read.amazon.com/kp/notebook?asin=B0EXAMPLE1",
            "https://READ.amazon.com:443/notebook",
        ] {
            assert!(notebook_url(&origin(), raw).is_ok(), "{raw}");
        }
    }

    #[test]
    fn anything_off_the_notebook_is_refused() {
        for raw in [
            "http://read.amazon.com/notebook",
            "https://read.amazon.com:8443/notebook",
            "https://www.amazon.com/notebook",
            "https://read.amazon.com.invalid/notebook",
            "https://read.amazon.com/notebook/../ap/signin",
            "https://read.amazon.com/notebookx",
            "https://read.amazon.com/notebook/",
            "https://read.amazon.com/kindle-library",
            "https://read.amazon.com/%6eotebook",
            "https://ida@read.amazon.com/notebook",
            "https://read.amazon.com/notebook#x",
            "/notebook",
            "not a url",
            "",
        ] {
            let failure = notebook_url(&origin(), raw).unwrap_err();
            assert_eq!(failure.kind, FailureKind::Refused, "{raw}");
        }
    }

    #[test]
    fn a_dot_segment_that_lands_on_the_notebook_is_read_as_the_parser_reads_it() {
        // The parser resolves it to /notebook, and /notebook is what is sent.
        let url = notebook_url(&origin(), "https://read.amazon.com/x/../notebook").unwrap();
        assert_eq!(url.path(), "/notebook");
    }
}
