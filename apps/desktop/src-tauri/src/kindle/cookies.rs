//! The Amazon session's cookies, between the data store and the request.
//!
//! They are read from the Kindle session's own WebKit data store just before
//! a page is fetched, sent to the notebook in its `Cookie` header, and
//! dropped: never stored by DFAI, logged, or handed to the webview. Which of
//! them go is RFC 6265's rule for a request — domain, path, secure — not a
//! decision about Amazon.

use reqwest::Url;

/// A cookie as the data store holds it, only what a request needs.
#[derive(Clone, PartialEq, Eq)]
pub struct SessionCookie {
    pub name: String,
    pub value: String,
    /// As WebKit writes it: `read.amazon.com`, or `.amazon.com` for a domain cookie.
    pub domain: String,
    pub path: String,
    pub secure: bool,
}

// Hand-written so that a cookie printed by mistake — in a panic, a log —
// shows its name and never its value.
impl std::fmt::Debug for SessionCookie {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SessionCookie")
            .field("name", &self.name)
            .field("domain", &self.domain)
            .finish_non_exhaustive()
    }
}

/// A value shorter than this is a setting (`en_US`, `1`), not a credential,
/// and striking it would rewrite ordinary words of the page.
const STRUCK_FROM: usize = 16;

const STRUCK: &str = "[cookie]";

fn domain_matches(host: &str, domain: &str) -> bool {
    let domain = domain.trim_start_matches('.').to_ascii_lowercase();
    !domain.is_empty() && (host == domain || host.ends_with(&format!(".{domain}")))
}

fn path_matches(request: &str, cookie: &str) -> bool {
    cookie.is_empty()
        || request == cookie
        || (request.starts_with(cookie)
            && (cookie.ends_with('/') || request[cookie.len()..].starts_with('/')))
}

fn goes_to(cookie: &SessionCookie, url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    domain_matches(&host, &cookie.domain)
        && path_matches(url.path(), &cookie.path)
        && (!cookie.secure || url.scheme() == "https")
}

/// The `Cookie` header for a request to `url`; None when no cookie goes there.
pub fn cookie_header(cookies: &[SessionCookie], url: &Url) -> Option<String> {
    let pairs: Vec<String> = cookies
        .iter()
        .filter(|cookie| goes_to(cookie, url))
        .map(|cookie| format!("{}={}", cookie.name, cookie.value))
        .collect();
    (!pairs.is_empty()).then(|| pairs.join("; "))
}

/// Whether any cookie in the store would go to `url`: whether there is a
/// session to send at all.
pub fn has_session_for(cookies: &[SessionCookie], url: &Url) -> bool {
    cookies.iter().any(|cookie| goes_to(cookie, url))
}

/// `page` with every credential-length cookie value struck from it, so that
/// a page which echoes one does not hand it to the webview.
pub fn strike(page: String, cookies: &[SessionCookie]) -> String {
    cookies
        .iter()
        .filter(|cookie| cookie.value.len() >= STRUCK_FROM)
        .fold(page, |page, cookie| page.replace(&cookie.value, STRUCK))
}

#[cfg(test)]
mod tests {
    use reqwest::Url;

    use super::{cookie_header, has_session_for, strike, SessionCookie};

    fn cookie(name: &str, value: &str, domain: &str, path: &str, secure: bool) -> SessionCookie {
        SessionCookie {
            name: name.into(),
            value: value.into(),
            domain: domain.into(),
            path: path.into(),
            secure,
        }
    }

    fn notebook() -> Url {
        Url::parse("https://read.amazon.com/notebook?asin=B0EXAMPLE1").unwrap()
    }

    #[test]
    fn a_domain_cookie_and_a_host_cookie_both_go_to_the_notebook() {
        let cookies = [
            cookie(
                "session-id",
                "111-2222222-3333333",
                ".amazon.com",
                "/",
                true,
            ),
            cookie("ubid-main", "444", "read.amazon.com", "/", false),
        ];
        assert_eq!(
            cookie_header(&cookies, &notebook()).unwrap(),
            "session-id=111-2222222-3333333; ubid-main=444"
        );
        assert!(has_session_for(&cookies, &notebook()));
    }

    #[test]
    fn a_cookie_for_another_host_another_path_or_https_only_over_http_stays_behind() {
        let cookies = [
            cookie("other", "1", "www.amazon.com", "/", false),
            cookie("lookalike", "2", "ead.amazon.com", "/", false),
            cookie("evil", "3", ".amazon.com.example.com", "/", false),
            cookie("path", "4", ".amazon.com", "/kp", false),
            cookie("prefix", "5", ".amazon.com", "/note", false),
            cookie("empty", "6", "", "/", false),
        ];
        assert_eq!(cookie_header(&cookies, &notebook()), None);
        assert!(!has_session_for(&cookies, &notebook()));
        let secure = [cookie("secure", "7", "127.0.0.1", "/", true)];
        let plain = Url::parse("http://127.0.0.1:9/notebook").unwrap();
        assert_eq!(cookie_header(&secure, &plain), None);
    }

    #[test]
    fn a_path_cookie_goes_to_the_paths_under_it() {
        let cookies = [
            cookie("kp", "1", ".amazon.com", "/kp", false),
            cookie("slash", "2", ".amazon.com", "/kp/", false),
            cookie("none", "3", ".amazon.com", "", false),
        ];
        let kp = Url::parse("https://read.amazon.com/kp/notebook").unwrap();
        assert_eq!(
            cookie_header(&cookies, &kp).unwrap(),
            "kp=1; slash=2; none=3"
        );
    }

    #[test]
    fn a_page_that_echoes_a_session_value_has_it_struck_and_keeps_short_settings() {
        let cookies = [
            cookie(
                "at-main",
                "Atza|SECRETSECRETSECRET",
                ".amazon.com",
                "/",
                true,
            ),
            cookie("lc-main", "en_US", ".amazon.com", "/", false),
        ];
        let page = r#"<html lang="en_US"><input value="Atza|SECRETSECRETSECRET"></html>"#;
        assert_eq!(
            strike(page.to_string(), &cookies),
            r#"<html lang="en_US"><input value="[cookie]"></html>"#
        );
    }

    #[test]
    fn a_cookie_printed_by_mistake_shows_no_value() {
        let printed = format!(
            "{:?}",
            cookie("at-main", "Atza|SECRET", ".amazon.com", "/", true)
        );
        assert!(printed.contains("at-main"));
        assert!(!printed.contains("SECRET"), "{printed}");
    }
}
