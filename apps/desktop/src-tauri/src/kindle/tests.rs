//! The notebook fetch against a fake Amazon on 127.0.0.1 serving the parser's
//! hand-made fixtures: the round trip, and each way a fetch goes wrong. No
//! test reaches Amazon, and the cookies are invented.

use std::time::Duration;

use reqwest::Url;

use super::cookies::SessionCookie;
use super::failure::{FailureKind, KindleFailure};
use super::fake_amazon::{
    FakeAmazon, Reply, ANNOTATIONS, LIBRARY, LIBRARY_EMPTY, SIGN_IN, UNRECOGNISED,
};
use super::fetch::{KindlePage, REQUEST_TIMEOUT};
use super::{fetch_notebook, sign_in_may_load, NotebookRequest};

const SESSION_VALUE: &str = "Atza|FAKE-SESSION-TOKEN-0123456789";

fn session() -> Vec<SessionCookie> {
    vec![
        SessionCookie {
            name: "at-main".into(),
            value: SESSION_VALUE.into(),
            domain: "127.0.0.1".into(),
            path: "/".into(),
            secure: false,
        },
        SessionCookie {
            name: "lc-main".into(),
            value: "en_US".into(),
            domain: "127.0.0.1".into(),
            path: "/".into(),
            secure: false,
        },
    ]
}

async fn fetch(
    amazon: &FakeAmazon,
    path: &str,
    cookies: &[SessionCookie],
) -> Result<KindlePage, KindleFailure> {
    fetch_notebook(NotebookRequest {
        origin: &amazon.origin,
        url: &amazon.url(path),
        cookies,
        timeout: REQUEST_TIMEOUT,
    })
    .await
}

/// What Tauri would hand the webview for a command's result.
fn handed(result: &Result<KindlePage, KindleFailure>) -> String {
    match result {
        Ok(page) => serde_json::to_string(page).unwrap(),
        Err(failure) => serde_json::to_string(failure).unwrap(),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn the_library_comes_back_raw_with_the_session_sent() {
    let amazon = FakeAmazon::start(Reply::Page(LIBRARY)).await;
    let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
    assert_eq!(
        page,
        KindlePage {
            status: 200,
            html: LIBRARY.to_string(),
            redirected_to: None,
        }
    );
    let heard = amazon.heard();
    assert_eq!(heard.len(), 1);
    assert_eq!(heard[0].target, "/notebook");
    assert_eq!(
        heard[0].cookie.as_deref(),
        Some(format!("at-main={SESSION_VALUE}; lc-main=en_US").as_str())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_book_page_is_asked_for_with_its_query_as_named() {
    let amazon = FakeAmazon::start(Reply::Page(ANNOTATIONS)).await;
    let path = "/notebook?asin=B0EXAMPLE1&contentLimitState=&token=CgUIAhCeAg";
    let page = fetch(&amazon, path, &session()).await.unwrap();
    assert_eq!(page.html, ANNOTATIONS);
    assert_eq!(amazon.heard()[0].target, path);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_page_is_handed_over_in_the_shape_the_adapter_reads() {
    let amazon = FakeAmazon::start(Reply::Page(LIBRARY_EMPTY)).await;
    let result = fetch(&amazon, "/notebook", &session()).await;
    let value: serde_json::Value = serde_json::from_str(&handed(&result)).unwrap();
    assert_eq!(value["status"], 200);
    assert_eq!(value["html"], LIBRARY_EMPTY);
    assert!(value["redirectedTo"].is_null());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_redirect_to_sign_in_comes_back_as_where_it_pointed_without_its_query_and_is_not_followed(
) {
    // Off the notebook's origin by its port, and on this Mac: were the fetch
    // ever to follow it, it would find nothing listening and reach no one.
    let sign_in = "http://127.0.0.1:1/ap/signin";
    let amazon = FakeAmazon::start(Reply::Page(SIGN_IN)).await;
    amazon.reply(
        "/notebook",
        Reply::Redirect(format!("{sign_in}?openid.return_to=notebook&token=SECRET")),
    );
    let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
    assert_eq!(
        page,
        KindlePage {
            status: 302,
            html: String::new(),
            redirected_to: Some(sign_in.into()),
        }
    );
    assert_eq!(
        amazon.heard().len(),
        1,
        "the sign-in page was not asked for"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_redirect_to_another_notebook_page_is_followed_with_the_session() {
    let amazon = FakeAmazon::start(Reply::Page(LIBRARY)).await;
    amazon.reply("/notebook", Reply::Redirect("/kp/notebook".into()));
    let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
    assert_eq!(page.status, 200);
    assert_eq!(page.html, LIBRARY);
    let heard = amazon.heard();
    assert_eq!(
        heard.iter().map(|h| h.target.as_str()).collect::<Vec<_>>(),
        ["/notebook", "/kp/notebook"]
    );
    assert!(heard[1].cookie.as_deref().unwrap().contains(SESSION_VALUE));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_redirect_to_another_path_of_the_same_host_is_handed_back_not_followed() {
    let amazon = FakeAmazon::start(Reply::Page(LIBRARY)).await;
    amazon.reply("/notebook", Reply::Redirect("/ap/signin?x=1".into()));
    let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
    assert_eq!(
        page.redirected_to,
        Some(format!(
            "{}/ap/signin",
            amazon.origin.as_str().trim_end_matches('/')
        ))
    );
    assert_eq!(amazon.heard().len(), 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_redirect_with_nowhere_to_go_comes_back_as_its_status_alone() {
    let amazon = FakeAmazon::start(Reply::RedirectNowhere).await;
    let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
    assert_eq!(
        page,
        KindlePage {
            status: 302,
            html: String::new(),
            redirected_to: None,
        }
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_notebook_that_redirects_to_itself_for_ever_is_given_up() {
    let amazon = FakeAmazon::start(Reply::Redirect("/kp/notebook".into())).await;
    let failure = fetch(&amazon, "/notebook", &session()).await.unwrap_err();
    assert_eq!(
        failure.kind,
        FailureKind::Unreachable,
        "{}",
        failure.message
    );
    assert!(amazon.heard().len() <= 6, "{}", amazon.heard().len());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_signed_in_page_that_is_the_sign_in_page_or_another_shape_comes_back_as_it_is() {
    // What it means is the parser's: the host hands either back untouched.
    for html in [SIGN_IN, UNRECOGNISED] {
        let amazon = FakeAmazon::start(Reply::Page(html)).await;
        let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
        assert_eq!((page.status, page.html.as_str()), (200, html));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn an_error_status_is_a_page_not_a_failure() {
    let amazon = FakeAmazon::start(Reply::Status(503)).await;
    let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
    assert_eq!(page.status, 503);
    assert_eq!(page.html, "<p>fake error</p>");
}

#[tokio::test(flavor = "multi_thread")]
async fn bytes_that_are_not_utf8_come_back_as_text_with_the_rest_kept() {
    let amazon = FakeAmazon::start(Reply::NotText).await;
    let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
    assert!(page.html.contains("<p>word</p>"), "{}", page.html);
    assert!(page.html.contains('\u{fffd}'));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_page_larger_than_the_host_reads_is_too_large() {
    let amazon = FakeAmazon::start(Reply::Oversized).await;
    let failure = fetch(&amazon, "/notebook", &session()).await.unwrap_err();
    assert_eq!(failure.kind, FailureKind::TooLarge);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_page_that_echoes_the_session_hands_the_webview_none_of_it() {
    let amazon = FakeAmazon::start(Reply::EchoCookie).await;
    let result = fetch(&amazon, "/notebook", &session()).await;
    let shown = handed(&result);
    assert!(shown.contains("at-main=[cookie]"), "{shown}");
    assert!(!shown.contains(SESSION_VALUE), "{shown}");
}

#[tokio::test(start_paused = true)]
async fn an_amazon_that_never_answers_times_out() {
    let amazon = FakeAmazon::start(Reply::Silent).await;
    let failure = fetch_notebook(NotebookRequest {
        origin: &amazon.origin,
        url: &amazon.url("/notebook"),
        cookies: &session(),
        timeout: Duration::from_secs(30),
    })
    .await
    .unwrap_err();
    assert_eq!(failure.kind, FailureKind::Timeout, "{}", failure.message);
    assert!(
        !failure.message.contains("127.0.0.1"),
        "{}",
        failure.message
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_amazon_that_cannot_be_reached_is_unreachable_and_named_without_its_url() {
    let closed = {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        Url::parse(&format!(
            "http://127.0.0.1:{}",
            listener.local_addr().unwrap().port()
        ))
        .unwrap()
    };
    let failure = fetch_notebook(NotebookRequest {
        origin: &closed,
        url: closed.join("/notebook?asin=B0EXAMPLE1").unwrap().as_str(),
        cookies: &session(),
        timeout: REQUEST_TIMEOUT,
    })
    .await
    .unwrap_err();
    assert_eq!(failure.kind, FailureKind::Unreachable);
    assert!(
        !failure.message.contains("B0EXAMPLE1"),
        "{}",
        failure.message
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn with_no_session_in_the_store_nothing_is_sent() {
    let amazon = FakeAmazon::start(Reply::Page(LIBRARY)).await;
    let elsewhere = vec![SessionCookie {
        name: "other".into(),
        value: "x".into(),
        domain: "example.com".into(),
        path: "/".into(),
        secure: false,
    }];
    for cookies in [Vec::new(), elsewhere] {
        let failure = fetch(&amazon, "/notebook", &cookies).await.unwrap_err();
        assert_eq!(failure.kind, FailureKind::NotConnected);
    }
    assert!(amazon.heard().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn an_address_off_the_notebook_is_refused_before_anything_is_sent() {
    let amazon = FakeAmazon::start(Reply::Page(LIBRARY)).await;
    for path in ["/ap/signin", "/notebook/extra", "/gp/your-account"] {
        let failure = fetch(&amazon, path, &session()).await.unwrap_err();
        assert_eq!(failure.kind, FailureKind::Refused, "{path}");
    }
    let other = fetch_notebook(NotebookRequest {
        origin: &amazon.origin,
        url: "https://example.com/notebook",
        cookies: &session(),
        timeout: REQUEST_TIMEOUT,
    })
    .await
    .unwrap_err();
    assert_eq!(other.kind, FailureKind::Refused);
    assert!(amazon.heard().is_empty());
}

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
        "https://amazon.com.example.com/",
        "https://evilamazon.com/",
        "https://example.com/?amazon.com",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "tauri://localhost/",
        "",
    ] {
        assert!(!sign_in_may_load(refused), "{refused}");
    }
}

// ---- Attack on PR #511 -------------------------------------------------
// Every server below binds 127.0.0.1; nothing here names a host off this Mac.

/// The fake session's value as a page would echo it percent-encoded (`|` as `%7C`).
const SESSION_PERCENT_ENCODED: &str = "Atza%7CFAKE-SESSION-TOKEN-0123456789";

#[tokio::test(flavor = "multi_thread")]
async fn attack_511_a_redirect_off_the_notebook_never_hands_the_webview_the_session_in_its_path() {
    let amazon = FakeAmazon::start(Reply::Page(LIBRARY)).await;
    amazon.reply(
        "/notebook",
        Reply::Redirect(format!("/ap/signin/{SESSION_VALUE}")),
    );
    let page = fetch(&amazon, "/notebook", &session()).await.unwrap();
    let shown = page.redirected_to.clone().unwrap_or_default();
    assert!(
        !shown.contains("FAKE-SESSION-TOKEN"),
        "the redirect target reaches the webview with the session in it: {shown}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn attack_511_a_page_that_echoes_the_session_percent_encoded_hands_the_webview_none_of_it() {
    const ECHO: &str = concat!(
        r#"<div id="kp-notebook-library"><a href="/x?s="#,
        "Atza%7CFAKE-SESSION-TOKEN-0123456789",
        r#"">x</a></div>"#
    );
    let amazon = FakeAmazon::start(Reply::Page(ECHO)).await;
    let result = fetch(&amazon, "/notebook", &session()).await;
    let handed = handed(&result);
    assert!(
        !handed.contains(SESSION_PERCENT_ENCODED),
        "the session reaches the webview percent-encoded: {handed}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn attack_511_a_page_that_echoes_the_session_as_html_entities_hands_the_webview_none_of_it() {
    // What the parser decodes `&#124;` to is the session itself.
    const ECHO: &str = concat!(
        r#"<div id="kp-notebook-library"><input value=""#,
        "Atza&#124;FAKE-SESSION-TOKEN-0123456789",
        r#""></div>"#
    );
    let amazon = FakeAmazon::start(Reply::Page(ECHO)).await;
    let result = fetch(&amazon, "/notebook", &session()).await;
    let handed = handed(&result);
    assert!(
        !handed.contains("FAKE-SESSION-TOKEN-0123456789"),
        "the session reaches the webview entity-encoded: {handed}"
    );
}

#[test]
fn attack_511_hostile_addresses_are_all_refused() {
    let origin = Url::parse("https://read.amazon.com").unwrap();
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
        assert!(
            super::notebook_url::notebook_url(&origin, raw).is_err(),
            "{raw}"
        );
    }
}

/// A server on 127.0.0.1 that answers with a body shorter than its
/// Content-Length and hangs up: a page cut off mid-way.
async fn truncating_amazon() -> Url {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let origin = Url::parse(&format!(
        "http://127.0.0.1:{}",
        listener.local_addr().unwrap().port()
    ))
    .unwrap();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request).await;
            let _ = stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 4000\r\n\r\n<div id=\"kp-notebook-library\">",
                )
                .await;
            let _ = stream.shutdown().await;
        }
    });
    origin
}

#[tokio::test(flavor = "multi_thread")]
async fn attack_511_a_page_cut_off_mid_way_is_a_failure_not_part_of_a_page() {
    let origin = truncating_amazon().await;
    let result = fetch_notebook(NotebookRequest {
        origin: &origin,
        url: origin.join("/notebook").unwrap().as_str(),
        cookies: &session(),
        timeout: REQUEST_TIMEOUT,
    })
    .await;
    assert_eq!(
        result.unwrap_err().kind,
        FailureKind::Unreachable,
        "a truncated page must not come back as a page"
    );
}

/// Run only as the child of the test below, with a proxy in its environment.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "the child half of attack_511_the_fetcher_s_requests_never_go_through_a_proxy_in_the_environment"]
async fn attack_511_child_fetches_the_fake_notebook() {
    let amazon = FakeAmazon::start(Reply::Page(LIBRARY)).await;
    let _ = fetch(&amazon, "/notebook", &session()).await;
}

#[test]
fn attack_511_the_fetcher_s_requests_never_go_through_a_proxy_in_the_environment() {
    // The guard that the fetcher's tests stay on 127.0.0.1 whatever shell runs
    // them: a proxy variable must not reroute the session. The "proxy" here is
    // a listener on 127.0.0.1 that only records that it was asked, so nothing
    // leaves this Mac either way. The fetch runs in a child process so that the
    // variable reaches no other test.
    use std::io::{Read, Write};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let proxy = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
    let proxy_url = format!("http://127.0.0.1:{}", proxy.local_addr().unwrap().port());
    let asked = Arc::new(AtomicBool::new(false));
    let heard_cookie = Arc::new(AtomicBool::new(false));
    {
        let asked = asked.clone();
        let heard_cookie = heard_cookie.clone();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = proxy.accept() {
                asked.store(true, Ordering::SeqCst);
                let mut request = [0u8; 4096];
                let read = stream.read(&mut request).unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..read]).to_string();
                heard_cookie.store(request.contains("FAKE-SESSION-TOKEN"), Ordering::SeqCst);
                let _ = stream.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
            }
        });
    }
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "kindle::tests::attack_511_child_fetches_the_fake_notebook",
            "--exact",
            "--ignored",
            "--quiet",
        ])
        .env("HTTP_PROXY", &proxy_url)
        .env("http_proxy", &proxy_url)
        .env("HTTPS_PROXY", &proxy_url)
        .env("ALL_PROXY", &proxy_url)
        .env_remove("NO_PROXY")
        .env_remove("no_proxy")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success(), "the child fetch did not run");
    assert!(
        !asked.load(Ordering::SeqCst),
        "the fetch went to the proxy named in the environment (session sent: {}): a test's \
         request, and the app's, can leave 127.0.0.1 / the notebook's host",
        heard_cookie.load(Ordering::SeqCst)
    );
}
