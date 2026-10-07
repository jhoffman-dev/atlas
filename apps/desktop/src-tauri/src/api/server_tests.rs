//! The server over real TCP, with a closure standing in for the webview.
//!
//! Requests are written as raw bytes so each test controls exactly what goes on
//! the wire — a missing header, a repeated one, a lying length — which a
//! well-behaved HTTP client would not let it send.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::broker::{Answer, Broker};
use super::request::ApiRequest;
use super::server::{bind, start_with, ConnectionLimits, Forward, Gate, RouterReady, Running};
use super::vet::MAX_BODY_BYTES;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/// What the stand-in for the webview does with a request.
#[derive(Clone, Copy)]
enum App {
    /// Answers 200 with the request it was handed, as JSON.
    Echo,
    /// Never answers.
    Silent,
    /// Cannot be reached.
    Unreachable,
    /// Answers like `Echo`, but only after this long.
    Late(Duration),
}

struct Harness {
    running: Running,
    token: Arc<RwLock<String>>,
    broker: Arc<Broker>,
    forwarded: Arc<Mutex<Vec<ApiRequest>>>,
    router_ready: RouterReady,
}

fn forward_as(app: App, broker: Arc<Broker>, forwarded: Arc<Mutex<Vec<ApiRequest>>>) -> Forward {
    Arc::new(move |request: &ApiRequest| {
        forwarded.lock().unwrap().push(request.clone());
        match app {
            App::Echo => {
                let body = serde_json::to_value(request).unwrap();
                broker.answer(&request.id, Answer { status: 200, body });
                Ok(())
            }
            App::Silent => Ok(()),
            App::Unreachable => Err("no webview".into()),
            App::Late(delay) => {
                let broker = broker.clone();
                let request = request.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(delay).await;
                    let body = serde_json::to_value(&request).unwrap();
                    broker.answer(&request.id, Answer { status: 200, body });
                });
                Ok(())
            }
        }
    })
}

fn serve(app: App, max_body: usize) -> Harness {
    let limits = ConnectionLimits::default();
    serve_with(app, max_body, Duration::from_millis(200), limits)
}

fn serve_with(
    app: App,
    max_body: usize,
    answer_timeout: Duration,
    limits: ConnectionLimits,
) -> Harness {
    let token = Arc::new(RwLock::new(TOKEN.to_string()));
    let broker = Arc::new(Broker::default());
    let forwarded = Arc::new(Mutex::new(Vec::new()));
    let router_ready = Arc::new(AtomicBool::new(true));
    let gate = Arc::new(Gate {
        token: token.clone(),
        broker: broker.clone(),
        forward: forward_as(app, broker.clone(), forwarded.clone()),
        answer_timeout,
        max_body,
        router_ready: router_ready.clone(),
    });
    let (running, serving) = start_with(bind(0).unwrap(), gate, limits).unwrap();
    tokio::spawn(serving);
    Harness {
        running,
        token,
        broker,
        forwarded,
        router_ready,
    }
}

struct Reply {
    status: u16,
    head: String,
    body: Value,
}

async fn send(port: u16, raw: &[u8]) -> Reply {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream.write_all(raw).await.unwrap();
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).await.unwrap();
    parse_reply(&bytes)
}

fn parse_reply(bytes: &[u8]) -> Reply {
    let text = String::from_utf8_lossy(bytes);
    let (head, body) = text.split_once("\r\n\r\n").expect("a complete response");
    let status = head[9..12].parse().unwrap();
    Reply {
        status,
        head: head.to_ascii_lowercase(),
        body: serde_json::from_str(body).unwrap_or(Value::Null),
    }
}

/// A request with the right Host and token unless `headers` says otherwise.
fn request(port: u16, method_and_path: &str, headers: &str, body: &str) -> Vec<u8> {
    let mut raw = format!("{method_and_path} HTTP/1.1\r\n");
    if !headers.contains("Host:") {
        raw.push_str(&format!("Host: 127.0.0.1:{port}\r\n"));
    }
    if !headers.contains("Authorization:") {
        raw.push_str(&format!("Authorization: Bearer {TOKEN}\r\n"));
    }
    raw.push_str(headers);
    if !body.is_empty() {
        raw.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    raw.push_str("Connection: close\r\n\r\n");
    raw.push_str(body);
    raw.into_bytes()
}

fn error_code(reply: &Reply) -> &str {
    reply.body["error"]["code"].as_str().unwrap_or("<none>")
}

#[tokio::test(flavor = "multi_thread")]
async fn forwards_an_admitted_request_and_returns_the_apps_answer() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    let reply = send(
        port,
        &request(
            port,
            "POST /v1/notes/My%20Note.md?q=a%20b&limit=1&limit=2",
            "Content-Type: application/json\r\n",
            r#"{"title":"Hi"}"#,
        ),
    )
    .await;

    assert_eq!(reply.status, 200);
    assert!(
        reply.head.contains("content-type: application/json"),
        "{}",
        reply.head
    );
    assert!(
        !reply.head.contains("access-control"),
        "no CORS header, ever"
    );
    assert_eq!(reply.body["method"], "POST");
    assert_eq!(reply.body["path"], "/v1/notes/My%20Note.md");
    assert_eq!(reply.body["query"], json!({ "q": "a b", "limit": "2" }));
    assert_eq!(reply.body["body"], json!({ "title": "Hi" }));
    assert!(reply.body["id"].as_str().is_some_and(|id| !id.is_empty()));
    assert_eq!(server.broker.waiting(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_request_without_a_body_is_forwarded_with_null() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    let reply = send(port, &request(port, "GET /v1/status", "", "")).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["body"], Value::Null);
    assert_eq!(reply.body["query"], json!({}));
}

#[tokio::test(flavor = "multi_thread")]
async fn passes_on_the_status_the_app_chose() {
    let server = serve(App::Silent, MAX_BODY_BYTES);
    let port = server.running.port;
    let broker = server.broker.clone();
    let forwarded = server.forwarded.clone();
    tokio::spawn(async move {
        loop {
            let id = forwarded.lock().unwrap().first().map(|r| r.id.clone());
            if let Some(id) = id {
                let body = json!({ "error": { "code": "conflict", "message": "changed" } });
                broker.answer(&id, Answer { status: 409, body });
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    });
    let reply = send(port, &request(port, "GET /v1/notes/a.md", "", "")).await;
    assert_eq!(reply.status, 409);
    assert_eq!(error_code(&reply), "conflict");
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_missing_token_with_401() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    let raw =
        format!("GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    let reply = send(port, raw.as_bytes()).await;
    assert_eq!((reply.status, error_code(&reply)), (401, "unauthorized"));
    assert!(server.forwarded.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_wrong_token_with_401() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    let wrong = format!("Authorization: Bearer {}\r\n", TOKEN.replace('0', "1"));
    let reply = send(port, &request(port, "GET /v1/status", &wrong, "")).await;
    assert_eq!((reply.status, error_code(&reply)), (401, "unauthorized"));
    assert!(server.forwarded.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_rotated_token_is_refused_on_the_next_request() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    *server.token.write().unwrap() = "f".repeat(64);
    let reply = send(port, &request(port, "GET /v1/status", "", "")).await;
    assert_eq!(reply.status, 401);
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_foreign_host_with_403() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    for host in ["evil.com", &format!("evil.com:{port}"), "127.0.0.1"] {
        let header = format!("Host: {host}\r\n");
        let reply = send(port, &request(port, "GET /v1/status", &header, "")).await;
        assert_eq!(
            (reply.status, error_code(&reply)),
            (403, "forbidden"),
            "{host}"
        );
    }
    assert!(server.forwarded.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn accepts_localhost_as_the_host() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    let header = format!("Host: localhost:{port}\r\n");
    let reply = send(port, &request(port, "GET /v1/status", &header, "")).await;
    assert_eq!(reply.status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_any_origin_with_403() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    let origin = format!("Origin: http://127.0.0.1:{port}\r\n");
    let reply = send(port, &request(port, "GET /v1/status", &origin, "")).await;
    assert_eq!((reply.status, error_code(&reply)), (403, "forbidden"));
    assert!(!reply.head.contains("access-control"));
    assert!(server.forwarded.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_an_oversized_content_length_with_413_before_reading_it() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    // Only the headers are sent: the answer must come without waiting for a
    // body that never arrives.
    let raw = format!(
        "POST /v1/notes HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Authorization: Bearer {TOKEN}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        MAX_BODY_BYTES + 1
    );
    let reply = tokio::time::timeout(Duration::from_secs(5), send(port, raw.as_bytes()))
        .await
        .expect("answered without reading the body");
    assert_eq!((reply.status, error_code(&reply)), (413, "too_large"));
    assert!(server.forwarded.lock().unwrap().is_empty());
}

fn chunked(port: u16, chunks: usize, chunk_size: usize) -> Vec<u8> {
    let mut raw = format!(
        "POST /v1/notes HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Authorization: Bearer {TOKEN}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
    )
    .into_bytes();
    for _ in 0..chunks {
        raw.extend(format!("{chunk_size:x}\r\n").as_bytes());
        raw.extend(std::iter::repeat_n(b' ', chunk_size));
        raw.extend(b"\r\n");
    }
    raw.extend(b"0\r\n\r\n");
    raw
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_chunked_body_that_grows_past_the_cap_with_413() {
    // A small cap keeps the whole body inside the socket buffers, so the server
    // closing early cannot reset the connection before the answer is read.
    let server = serve(App::Echo, 1024);
    let port = server.running.port;
    let reply = send(port, &chunked(port, 4, 400)).await;
    assert_eq!((reply.status, error_code(&reply)), (413, "too_large"));
    assert!(server.forwarded.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn accepts_a_chunked_body_within_the_cap() {
    let server = serve(App::Echo, 1024);
    let port = server.running.port;
    // A JSON value split across two chunks, well under the cap.
    let mut raw = format!(
        "POST /v1/notes HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Authorization: Bearer {TOKEN}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
    );
    raw.push_str("5\r\n{\"a\":\r\n2\r\n1}\r\n0\r\n\r\n");
    let reply = send(port, raw.as_bytes()).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["body"], json!({ "a": 1 }));
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_body_that_is_not_json_with_400() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    let reply = send(port, &request(port, "POST /v1/notes", "", "title=Hi")).await;
    assert_eq!((reply.status, error_code(&reply)), (400, "invalid"));
    assert!(server.forwarded.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_504_when_the_app_does_not_answer_in_time() {
    let server = serve(App::Silent, MAX_BODY_BYTES);
    let port = server.running.port;
    let reply = send(port, &request(port, "GET /v1/status", "", "")).await;
    assert_eq!((reply.status, error_code(&reply)), (504, "timeout"));
    assert_eq!(server.forwarded.lock().unwrap().len(), 1);
    assert_eq!(
        server.broker.waiting(),
        0,
        "the timed-out request is forgotten"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_500_when_the_app_cannot_be_reached() {
    let server = serve(App::Unreachable, MAX_BODY_BYTES);
    let port = server.running.port;
    let reply = send(port, &request(port, "GET /v1/status", "", "")).await;
    assert_eq!((reply.status, error_code(&reply)), (500, "internal"));
    assert_eq!(server.broker.waiting(), 0);
}

/// Until the router says it is listening, an event sent to it would be lost:
/// the caller is told at once instead of waiting out the answer timeout.
#[tokio::test(flavor = "multi_thread")]
async fn answers_500_at_once_until_the_router_is_listening() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    server.router_ready.store(false, Ordering::SeqCst);

    let reply = send(port, &request(port, "GET /v1/status", "", "")).await;

    assert_eq!((reply.status, error_code(&reply)), (500, "internal"));
    assert_eq!(
        reply.body["error"]["message"],
        "Atlas is still starting — try again in a moment"
    );
    assert!(server.forwarded.lock().unwrap().is_empty());
    assert_eq!(server.broker.waiting(), 0);

    server.router_ready.store(true, Ordering::SeqCst);
    let reply = send(port, &request(port, "GET /v1/status", "", "")).await;
    assert_eq!(reply.status, 200);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_path_outside_v1_has_no_route() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    for path in [
        "GET /",
        "GET /v2/status",
        "GET /status",
        "OPTIONS /v1/status",
    ] {
        let reply = send(port, &request(port, path, "", "")).await;
        assert_eq!(
            (reply.status, error_code(&reply)),
            (404, "not_found_route"),
            "{path}"
        );
    }
    assert!(server.forwarded.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_path_outside_v1_still_needs_the_token() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    let raw =
        format!("GET /secret HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    let reply = send(port, raw.as_bytes()).await;
    assert_eq!(reply.status, 401);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_answer_with_an_impossible_status_becomes_500() {
    let server = serve(App::Silent, MAX_BODY_BYTES);
    let port = server.running.port;
    let broker = server.broker.clone();
    let forwarded = server.forwarded.clone();
    tokio::spawn(async move {
        loop {
            let id = forwarded.lock().unwrap().first().map(|r| r.id.clone());
            if let Some(id) = id {
                broker.answer(
                    &id,
                    Answer {
                        status: 42,
                        body: json!({}),
                    },
                );
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    });
    let reply = send(port, &request(port, "GET /v1/status", "", "")).await;
    assert_eq!((reply.status, error_code(&reply)), (500, "internal"));
}

#[tokio::test(flavor = "multi_thread")]
async fn listens_only_on_the_loopback_address() {
    let listener = bind(0).unwrap();
    assert!(listener.local_addr().unwrap().ip().is_loopback());
    assert_eq!(listener.local_addr().unwrap().ip().to_string(), "127.0.0.1");
}

#[test]
fn reuses_the_preferred_port_when_free_and_falls_back_when_taken() {
    let free = bind(0).unwrap();
    let port = free.local_addr().unwrap().port();
    drop(free);
    assert_eq!(bind(port).unwrap().local_addr().unwrap().port(), port);

    let squatter = bind(0).unwrap();
    let taken = squatter.local_addr().unwrap().port();
    let fallback = bind(taken).unwrap();
    assert_ne!(fallback.local_addr().unwrap().port(), taken);
}

#[tokio::test(flavor = "multi_thread")]
async fn dropping_the_handle_stops_the_server() {
    let server = serve(App::Echo, MAX_BODY_BYTES);
    let port = server.running.port;
    drop(server.running);
    let mut refused = false;
    for _ in 0..200 {
        if TcpStream::connect(("127.0.0.1", port)).await.is_err() {
            refused = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(refused, "the port still accepts connections after the stop");
}

const DAY: Duration = Duration::from_secs(86_400);

/// On the paused clock, `work` without time passing. Tokio advances a paused
/// clock whenever the runtime goes idle — including while real socket I/O is
/// still on its way — which would fire the server's deadlines early. Yielding
/// keeps the runtime busy, so the clock stands still until `work` is done.
async fn frozen<T>(work: impl std::future::Future<Output = T>) -> T {
    let mut work = std::pin::pin!(work);
    loop {
        tokio::select! {
            biased;
            done = &mut work => return done,
            () = tokio::task::yield_now() => {}
        }
    }
}

async fn until_forwarded(server: &Harness, count: usize) {
    while server.forwarded.lock().unwrap().len() < count {
        tokio::task::yield_now().await;
    }
}

/// Gives the server many turns, with the clock stopped, to do anything it
/// would do with what is already on its sockets.
async fn settle() {
    for _ in 0..10_000 {
        tokio::task::yield_now().await;
    }
}

async fn connect_and_send(port: u16) -> TcpStream {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream
        .write_all(&request(port, "GET /v1/status", "", ""))
        .await
        .unwrap();
    stream
}

fn answer_nth(server: &Harness, nth: usize) {
    let id = server.forwarded.lock().unwrap()[nth].id.clone();
    let body = json!({ "answered": nth });
    server.broker.answer(&id, Answer { status: 200, body });
}

/// Past the cap a connection is not refused: it waits, unforwarded, until an
/// open one ends, and is then served.
#[tokio::test(start_paused = true)]
async fn a_connection_past_the_cap_waits_until_one_closes() {
    let limits = ConnectionLimits {
        lifetime: DAY,
        drain: DAY,
        max_open: 1,
    };
    let server = serve_with(App::Silent, MAX_BODY_BYTES, DAY, limits);
    let port = server.running.port;
    // The holder's request is in flight, so no header timer runs on it.
    let mut holder = frozen(connect_and_send(port)).await;
    frozen(until_forwarded(&server, 1)).await;
    let mut waiting = frozen(connect_and_send(port)).await;

    settle().await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    settle().await;
    assert_eq!(
        server.forwarded.lock().unwrap().len(),
        1,
        "a second connection was served while the only slot was held"
    );

    answer_nth(&server, 0);
    frozen(holder.read_to_end(&mut Vec::new())).await.unwrap();
    frozen(until_forwarded(&server, 2)).await;
    answer_nth(&server, 1);
    let mut bytes = Vec::new();
    frozen(waiting.read_to_end(&mut bytes)).await.unwrap();
    let reply = parse_reply(&bytes);
    assert_eq!(
        (reply.status, &reply.body),
        (200, &json!({ "answered": 1 }))
    );
}

/// The lifetime stops a connection taking new requests; it does not cut off
/// one the app is still answering.
#[tokio::test(start_paused = true)]
async fn a_request_in_flight_when_the_lifetime_ends_is_still_answered() {
    let limits = ConnectionLimits {
        lifetime: Duration::from_secs(5),
        drain: DAY,
        ..ConnectionLimits::default()
    };
    let app = App::Late(Duration::from_secs(20));
    let server = serve_with(app, MAX_BODY_BYTES, Duration::from_secs(30), limits);
    let port = server.running.port;
    let mut stream = frozen(connect_and_send(port)).await;
    frozen(until_forwarded(&server, 1)).await;

    // Now the clock may run: past the lifetime at 5 s, to the answer at 20 s.
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).await.unwrap();
    let reply = parse_reply(&bytes);
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["path"], "/v1/status");
}
