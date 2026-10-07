//! Attacks on the local API: what a hostile process on this machine, a browser
//! page, or an unlucky filesystem can do to the server, the control and the
//! connection file. A test here that fails is a hole, not a flake: each one
//! names the invariant it holds the code to.
//!
//! Timing-sensitive tests run on Tokio's paused clock, so "an hour later" is
//! virtual and nothing sleeps on real time.

use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use super::broker::{Answer, Broker};
use super::connection::{self, ConnectionFile};
use super::control::ApiControl;
use super::request::ApiRequest;
use super::server::{bind, start, Forward, Gate, Running};
use super::vet::MAX_BODY_BYTES;

const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/// A server whose app answers every request with the request it was handed.
fn serve_echo() -> (Running, Arc<std::sync::Mutex<Vec<ApiRequest>>>) {
    let broker = Arc::new(Broker::default());
    let forwarded = Arc::new(std::sync::Mutex::new(Vec::new()));
    let seen = forwarded.clone();
    let answering = broker.clone();
    let forward: Forward = Arc::new(move |request: &ApiRequest| {
        seen.lock().unwrap().push(request.clone());
        let body = serde_json::to_value(request).unwrap();
        answering.answer(&request.id, Answer { status: 200, body });
        Ok(())
    });
    let gate = Arc::new(Gate {
        token: Arc::new(RwLock::new(TOKEN.to_string())),
        broker,
        forward,
        answer_timeout: Duration::from_secs(30),
        max_body: MAX_BODY_BYTES,
        router_ready: Arc::new(AtomicBool::new(true)),
    });
    let (running, serving) = start(bind(0).unwrap(), gate).unwrap();
    tokio::spawn(serving);
    (running, forwarded)
}

/// How long a test on the real clock waits for the server to answer and close.
/// A server that does neither fails the test rather than hanging it.
const ANSWER_WITHIN: Duration = Duration::from_secs(10);

/// Sends `raw` and reads until the server closes. Only for tests on the real
/// clock: on a paused one the timeout would fire while loopback I/O is in flight.
async fn exchange(port: u16, raw: &[u8]) -> String {
    let exchanged = async {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        stream.write_all(raw).await.unwrap();
        let mut bytes = Vec::new();
        stream.read_to_end(&mut bytes).await.unwrap();
        bytes
    };
    let bytes = tokio::time::timeout(ANSWER_WITHIN, exchanged)
        .await
        .expect("the server neither answered nor closed");
    String::from_utf8_lossy(&bytes).into_owned()
}

fn status_of(response: &str) -> u16 {
    response
        .get(9..12)
        .and_then(|code| code.parse().ok())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// Connection exhaustion
// ---------------------------------------------------------------------------

/// Invariant: a client that never reads its answers cannot hold a connection —
/// a file descriptor and hyper's ~400 KiB write buffer in the app's process —
/// for ever. It needs no token: every pipelined request here is refused 401.
///
/// Without a write/idle deadline the server sits blocked on a full socket
/// buffer with no timer running (the header timeout only runs while a head is
/// being read), so after a virtual hour it is still there and, once the client
/// finally reads, it answers every single request.
#[tokio::test(start_paused = true)]
async fn a_client_that_never_reads_its_answers_cannot_hold_a_connection_for_ever() {
    let (running, _) = serve_echo();
    let port = running.port;
    const PIPELINED: usize = 30_000;
    let one = format!("GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
    let flood = one.repeat(PIPELINED).into_bytes();

    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let (mut reader, mut writer) = stream.into_split();
    let writing = tokio::spawn(async move {
        // The server may close on us mid-write once it gives up; that is the
        // behaviour asked for, so a write error here is not a failure.
        let _ = writer.write_all(&flood).await;
        writer
    });

    // The client stops reading for an hour. Nothing on the server should still
    // be waiting on it by the end.
    tokio::time::sleep(Duration::from_secs(3600)).await;

    let answers = read_until_closed_or_quiet(&mut reader).await;
    let answered = String::from_utf8_lossy(&answers)
        .matches("HTTP/1.1 401")
        .count();
    // The writer may be blocked for good on a server that has gone, whose
    // reset the kernel dropped; nothing is waited on, it is simply dropped.
    writing.abort();
    assert!(
        answered < PIPELINED,
        "the server held a non-reading, unauthenticated connection for an hour \
         and then answered all {answered} of its requests"
    );
}

/// Everything the server sends until it closes, resets, or goes quiet for a
/// virtual minute.
///
/// Not a bare `read_to_end`: a server that gave up closes with the client's
/// flood unread, and the reset it sends can land while the client's receive
/// window is zero, where the kernel drops it. The client then waits on real
/// I/O that never comes, with no timer for the paused clock to advance to, and
/// the test hangs. Quiet is measured one virtual second at a time, and only
/// consecutive silent seconds count, so a server still draining answers to us
/// keeps being read to the end — which is what the assertion needs to see.
async fn read_until_closed_or_quiet(reader: &mut tokio::net::tcp::OwnedReadHalf) -> Vec<u8> {
    const QUIET_SECONDS: u32 = 60;
    let mut received = Vec::new();
    let mut quiet = 0;
    while quiet < QUIET_SECONDS {
        let mut chunk = [0u8; 64 * 1024];
        match tokio::time::timeout(Duration::from_secs(1), reader.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) => break,
            Ok(Ok(read)) => {
                received.extend_from_slice(&chunk[..read]);
                quiet = 0;
            }
            Err(_) => quiet += 1,
        }
    }
    received
}

/// What arrives on `stream` within `within` of virtual time, and whether the
/// server closed the connection in that time. Steps a tenth of a second at a
/// time: the paused clock advances whenever the runtime is idle, including
/// while real loopback I/O is in flight, so small steps keep a slow moment
/// under load from eating the whole budget.
async fn received_within(stream: &mut TcpStream, within: Duration) -> (String, bool) {
    let deadline = tokio::time::Instant::now() + within;
    let mut received = Vec::new();
    while tokio::time::Instant::now() < deadline {
        let mut chunk = [0u8; 64 * 1024];
        match tokio::time::timeout(Duration::from_millis(100), stream.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) => return (String::from_utf8_lossy(&received).into(), true),
            Ok(Ok(read)) => received.extend_from_slice(&chunk[..read]),
            Err(_) => {}
        }
    }
    (String::from_utf8_lossy(&received).into(), false)
}

/// Invariant: only a token holder keeps a connection. Every refusal the host
/// makes before the router sees the request closes the connection, so a
/// caller without the token cannot pipeline refused requests on it or hold it
/// open.
#[tokio::test(start_paused = true)]
async fn a_refusal_before_the_router_closes_the_connection() {
    let (running, forwarded) = serve_echo();
    let port = running.port;
    let host = format!("Host: 127.0.0.1:{port}\r\n");
    let token = format!("Authorization: Bearer {TOKEN}\r\n");
    let refused = [
        (401, format!("GET /v1/status HTTP/1.1\r\n{host}\r\n")),
        (
            403,
            format!("GET /v1/status HTTP/1.1\r\nHost: evil.test\r\n{token}\r\n"),
        ),
        (
            404,
            format!("GET /v2/nothing HTTP/1.1\r\n{host}{token}\r\n"),
        ),
        (
            400,
            format!("GET /v1/search?q=%FF HTTP/1.1\r\n{host}{token}\r\n"),
        ),
        (
            400,
            format!("POST /v1/notes HTTP/1.1\r\n{host}{token}Content-Length: 3\r\n\r\nnot"),
        ),
        (
            413,
            format!("POST /v1/notes HTTP/1.1\r\n{host}{token}Content-Length: 99999999\r\n\r\n"),
        ),
    ];
    for (status, first) in refused {
        let follow_up = format!("GET /v1/status HTTP/1.1\r\n{host}{token}\r\n");
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        // The server may already have closed by the time the follow-up is sent.
        let _ = stream
            .write_all(format!("{first}{follow_up}").as_bytes())
            .await;

        // Half the 10 s header timeout, which would close it anyway — and only
        // after answering the follow-up.
        let (received, closed) = received_within(&mut stream, Duration::from_secs(5)).await;

        assert_eq!(status_of(&received), status, "{received}");
        assert!(
            received.to_ascii_lowercase().contains("connection: close"),
            "{received}"
        );
        assert_eq!(received.matches("HTTP/1.1 ").count(), 1, "{received}");
        assert!(closed, "a {status} left the connection open: {received}");
    }
    assert!(forwarded.lock().unwrap().is_empty());
}

/// Invariant: callers without the token cannot hold every connection slot. 32
/// token-less clients that pipeline refused requests and never read used to
/// keep all 32 slots for the connection lifetime and drain, two minutes, while
/// a token holder waited in the accept queue.
#[tokio::test(start_paused = true)]
async fn token_less_non_readers_do_not_hold_the_connection_slots() {
    let (running, _) = serve_echo();
    let port = running.port;
    let refused = format!("GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").repeat(2000);
    let mut hogs = Vec::new();
    for _ in 0..32 {
        let mut hog = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        // The server may close before the whole flood is written.
        let _ = hog.write_all(refused.as_bytes()).await;
        hogs.push(hog);
    }

    let mut caller = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    caller
        .write_all(
            format!(
                "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
                 Authorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    // Half the 10 s header timeout, which is when idle hogs would let go.
    let (received, _) = received_within(&mut caller, Duration::from_secs(5)).await;

    assert_eq!(
        status_of(&received),
        200,
        "the token holder was still waiting for a slot: {received}"
    );
    drop(hogs);
}

/// Hardening that holds: a connection that went quiet after one refused
/// request is closed — at once, since the refusal says `Connection: close` —
/// rather than kept alive for ever.
#[tokio::test(start_paused = true)]
async fn an_idle_keep_alive_connection_after_a_refusal_is_closed() {
    let (running, _) = serve_echo();
    let port = running.port;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream
        .write_all(format!("GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n").as_bytes())
        .await
        .unwrap();
    // Step the virtual clock a second at a time, so it can never leap past the
    // server's header timer before the server has had the chance to set it.
    let mut received = Vec::new();
    let mut closed_after = None;
    for second in 0..60u64 {
        let mut chunk = [0u8; 4096];
        match tokio::time::timeout(Duration::from_millis(100), stream.read(&mut chunk)).await {
            Ok(Ok(0)) | Ok(Err(_)) => {
                closed_after = Some(second);
                break;
            }
            Ok(Ok(read)) => received.extend_from_slice(&chunk[..read]),
            Err(_) => {}
        }
    }
    assert_eq!(status_of(&String::from_utf8_lossy(&received)), 401);
    let closed_after = closed_after.expect("the idle connection was still open a minute later");
    assert!(closed_after <= 15, "closed only after {closed_after}s");
}

/// Hardening that holds: a client dribbling its headers cannot keep the
/// connection past the header timeout by sending a byte every few seconds.
#[tokio::test(start_paused = true)]
async fn dribbling_the_headers_does_not_keep_the_connection_open() {
    let (running, _) = serve_echo();
    let port = running.port;
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let mut closed_after = None;
    for second in 0..120u64 {
        if stream.write_all(b"X").await.is_err() {
            closed_after = Some(second);
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
        let mut probe = [0u8; 1];
        if let Ok(Ok(0) | Err(_)) =
            tokio::time::timeout(Duration::from_millis(1), stream.read(&mut probe)).await
        {
            closed_after = Some(second);
            break;
        }
    }
    let closed_after = closed_after.expect("still open after two minutes of dribbling");
    assert!(closed_after <= 15, "closed only after {closed_after}s");
}

// ---------------------------------------------------------------------------
// Request translation
// ---------------------------------------------------------------------------

/// Invariant: the request judged is the request forwarded. In absolute form
/// (`GET http://evil.test/v1/status`) RFC 9112 §3.2.2 makes the target's
/// authority — not `Host` — the request's host, so the Host check is judging
/// a header the request itself says to ignore.
#[tokio::test(flavor = "multi_thread")]
async fn an_absolute_form_target_naming_a_foreign_host_is_refused() {
    let (running, forwarded) = serve_echo();
    let port = running.port;
    let raw = format!(
        "GET http://evil.test/v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Authorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"
    );
    let response = exchange(port, raw.as_bytes()).await;
    assert_eq!(status_of(&response), 403, "{response}");
    assert!(forwarded.lock().unwrap().is_empty());
}

/// Invariant: translation never changes what the caller asked for. A query
/// value that is not UTF-8 is silently rewritten to U+FFFD, so two different
/// requests (`%FF` and `%FE`) reach the router as the same one.
#[tokio::test(flavor = "multi_thread")]
async fn a_query_value_that_is_not_utf8_is_refused_not_rewritten() {
    let (running, forwarded) = serve_echo();
    let port = running.port;
    let raw = format!(
        "GET /v1/search?q=%FF HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Authorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"
    );
    let response = exchange(port, raw.as_bytes()).await;
    let forwarded = forwarded.lock().unwrap();
    assert!(
        status_of(&response) == 400 && forwarded.is_empty(),
        "forwarded as q={:?} with status {}",
        forwarded.first().map(|request| request.query["q"].clone()),
        status_of(&response)
    );
}

/// Hardening that holds: a status that forbids a body (204) does not put the
/// app's body on the wire, which would desynchronise a keep-alive client.
#[tokio::test(flavor = "multi_thread")]
async fn a_no_content_answer_does_not_desynchronise_keep_alive() {
    let broker = Arc::new(Broker::default());
    let answering = broker.clone();
    let forward: Forward = Arc::new(move |request: &ApiRequest| {
        let status = if request.path == "/v1/first" {
            204
        } else {
            200
        };
        answering.answer(
            &request.id,
            Answer {
                status,
                body: serde_json::json!({ "path": request.path }),
            },
        );
        Ok(())
    });
    let gate = Arc::new(Gate {
        token: Arc::new(RwLock::new(TOKEN.to_string())),
        broker,
        forward,
        answer_timeout: Duration::from_secs(30),
        max_body: MAX_BODY_BYTES,
        router_ready: Arc::new(AtomicBool::new(true)),
    });
    let (running, serving) = start(bind(0).unwrap(), gate).unwrap();
    tokio::spawn(serving);
    let port = running.port;
    let head = |path: &str, close: &str| {
        format!(
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
             Authorization: Bearer {TOKEN}\r\n{close}\r\n"
        )
    };
    let raw = head("/v1/first", "") + &head("/v1/second", "Connection: close\r\n");
    let response = exchange(port, raw.as_bytes()).await;
    let starts: Vec<_> = response
        .match_indices("HTTP/1.1 ")
        .map(|(i, _)| i)
        .collect();
    assert_eq!(starts.len(), 2, "{response}");
    assert!(
        response[starts[0]..].starts_with("HTTP/1.1 204"),
        "{response}"
    );
    assert!(
        response[starts[1]..].starts_with("HTTP/1.1 200"),
        "{response}"
    );
    assert!(!response[..starts[1]].contains("/v1/first"), "{response}");
}

// ---------------------------------------------------------------------------
// Control: the switch in Settings
// ---------------------------------------------------------------------------

fn answer_nothing() -> Forward {
    Arc::new(|_: &ApiRequest| Ok(()))
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

fn accepts_connections(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port))
        .and_then(|mut stream| {
            write!(
                stream,
                "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
            )?;
            let mut response = String::new();
            stream.read_to_string(&mut response)?;
            Ok(response.starts_with("HTTP/1.1 401"))
        })
        .unwrap_or(false)
}

/// Invariant: when turning the API on fails, nothing is listening. Here the
/// server binds and starts, then the connection file cannot be written; the
/// command reports the failure and status says `enabled: false`, but the
/// server is left running and serving with the token — on while Settings
/// says off, and never recorded, so the user has no way to see it.
#[cfg(unix)]
#[test]
fn a_failed_turn_on_leaves_nothing_listening() {
    let dir = tempfile::tempdir().unwrap();
    let app = dir.path().join("app");
    let control = ApiControl::load(app.clone()).unwrap();
    set_mode(&app, 0o500);

    let turned_on = control.set_enabled(true, answer_nothing());
    let status = control.status();
    set_mode(&app, 0o700);

    assert!(turned_on.is_err(), "the save was expected to fail");
    let port = status.port;
    assert!(
        !status.running,
        "status after the failed turn-on: {status:?} — a server is running while \
         enabled is false"
    );
    if let Some(port) = port {
        assert!(!accepts_connections(port), "port {port} still answers");
    }
}

// ---------------------------------------------------------------------------
// The connection file
// ---------------------------------------------------------------------------

/// Invariant (ADR-0016): the file holding the token is mode 0600. A usable
/// file found with looser permissions — restored from a backup, copied by
/// hand, written by a tool — is loaded and kept as is: the token stays
/// readable by every user on the machine for as long as it is in force.
#[cfg(unix)]
#[test]
fn loading_a_world_readable_connection_file_leaves_it_private() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let file = ConnectionFile {
        port: 27183,
        enabled: true,
        ..ConnectionFile::fresh().unwrap()
    };
    connection::save(dir.path(), &file).unwrap();
    let path = connection::path_in(dir.path());
    set_mode(&path, 0o644);

    let control = ApiControl::load(dir.path().to_path_buf()).unwrap();
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    let token_still_in_force = control.token() == file.token;
    assert!(
        mode == 0o600 || !token_still_in_force,
        "api.json is {mode:o} and its token is still the one in force"
    );
}

/// Hardening that holds: a symlink planted at the temporary path is replaced,
/// not followed, so a save cannot be steered into writing the token elsewhere.
#[cfg(unix)]
#[test]
fn a_symlink_at_the_temporary_path_is_not_followed() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let target = elsewhere.path().join("stolen");
    std::fs::write(&target, b"").unwrap();
    let temporary = dir.path().join(format!(
        ".{}.{}.tmp",
        connection::FILE_NAME,
        std::process::id()
    ));
    std::os::unix::fs::symlink(&target, &temporary).unwrap();

    connection::save(dir.path(), &ConnectionFile::fresh().unwrap()).unwrap();
    assert!(std::fs::read(&target).unwrap().is_empty());
}

/// Hardening that holds: a symlink at `api.json` is replaced by the save, not
/// written through.
#[cfg(unix)]
#[test]
fn a_symlink_at_the_connection_file_is_replaced_not_written_through() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let target = elsewhere.path().join("stolen");
    std::fs::write(&target, b"").unwrap();
    std::os::unix::fs::symlink(&target, connection::path_in(dir.path())).unwrap();

    connection::save(dir.path(), &ConnectionFile::fresh().unwrap()).unwrap();
    assert!(std::fs::read(&target).unwrap().is_empty());
    assert!(!std::fs::symlink_metadata(connection::path_in(dir.path()))
        .unwrap()
        .file_type()
        .is_symlink());
}

// ---------------------------------------------------------------------------
// Envelope tricks over the wire (hardening that holds)
// ---------------------------------------------------------------------------

/// Near-miss spellings of this machine are refused, and none reaches the app.
#[tokio::test(flavor = "multi_thread")]
async fn near_miss_hosts_are_refused_over_the_wire() {
    let (running, forwarded) = serve_echo();
    let port = running.port;
    for host in [
        format!("localhost.:{port}"),
        format!("LOCALHOST:{port}"),
        format!("127.0.0.1:0{port}"),
        format!("127.1:{port}"),
        format!("127.0.0.1:{port}@evil.test"),
        format!("evil.test@127.0.0.1:{port}"),
        format!("[::1]:{port}"),
        format!("[::ffff:127.0.0.1]:{port}"),
    ] {
        let raw = format!(
            "GET /v1/status HTTP/1.1\r\nHost: {host}\r\n\
             Authorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"
        );
        let status = status_of(&exchange(port, raw.as_bytes()).await);
        assert!(status == 403 || status == 400, "{host}: {status}");
    }
    assert!(forwarded.lock().unwrap().is_empty());
}

/// A folded (obs-fold) Host line cannot smuggle a second value past the check.
#[tokio::test(flavor = "multi_thread")]
async fn a_folded_host_header_is_refused() {
    let (running, forwarded) = serve_echo();
    let port = running.port;
    let raw = format!(
        "GET /v1/status HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n evil.test\r\n\
         Authorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"
    );
    let status = status_of(&exchange(port, raw.as_bytes()).await);
    assert!(status == 400 || status == 403, "{status}");
    assert!(forwarded.lock().unwrap().is_empty());
}

/// A small Content-Length alongside a chunked body cannot sneak more than the
/// cap past the reader.
#[tokio::test(flavor = "multi_thread")]
async fn content_length_and_chunked_together_cannot_pass_an_oversized_body() {
    let (running, forwarded) = serve_echo();
    let port = running.port;
    let chunk = "a".repeat(64 * 1024);
    let mut raw = format!(
        "POST /v1/notes HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Authorization: Bearer {TOKEN}\r\nContent-Length: 2\r\n\
         Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
    );
    for _ in 0..20 {
        raw.push_str(&format!("{:x}\r\n{chunk}\r\n", chunk.len()));
    }
    raw.push_str("0\r\n\r\n");
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    // The server may refuse and close before the whole body is sent.
    let _ = stream.write_all(raw.as_bytes()).await;
    let mut bytes = Vec::new();
    // A reset after the answer is not what this test is about; the status is.
    let _ = tokio::time::timeout(ANSWER_WITHIN, stream.read_to_end(&mut bytes))
        .await
        .expect("the server neither answered nor closed");
    let status = status_of(&String::from_utf8_lossy(&bytes));
    assert!(status == 400 || status == 413, "{status}");
    assert!(forwarded.lock().unwrap().is_empty());
}

/// Invariant: a caller refused before its body is read still reads the whole
/// refusal. Closing a socket with unread bytes in it sends a reset rather than
/// a clean close, and a reset can reach the caller before it has read the
/// answer, which it then never sees. Run many times: a lost answer is a race.
#[tokio::test(flavor = "multi_thread")]
async fn a_refusal_with_the_body_unread_is_read_in_full() {
    let (running, forwarded) = serve_echo();
    let port = running.port;
    let host = format!("Host: 127.0.0.1:{port}\r\n");
    let token = format!("Authorization: Bearer {TOKEN}\r\n");
    let body = "a".repeat(32 * 1024);
    let refused = [
        (
            401,
            format!(
                "POST /v1/notes HTTP/1.1\r\n{host}Content-Length: {}\r\n\r\n",
                body.len()
            ),
        ),
        (
            413,
            format!("POST /v1/notes HTTP/1.1\r\n{host}{token}Content-Length: 99999999\r\n\r\n"),
        ),
    ];
    for (status, head) in refused {
        for attempt in 0..50 {
            let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            stream.write_all(head.as_bytes()).await.unwrap();
            // The server may refuse and close before the whole body is sent.
            let _ = stream.write_all(body.as_bytes()).await;
            let mut bytes = Vec::new();
            let read = tokio::time::timeout(ANSWER_WITHIN, stream.read_to_end(&mut bytes))
                .await
                .expect("the server neither answered nor closed");
            let received = String::from_utf8_lossy(&bytes);
            assert!(
                read.is_ok(),
                "attempt {attempt}: {read:?} after {received:?}"
            );
            assert_eq!(
                status_of(&received),
                status,
                "attempt {attempt}: {received}"
            );
            assert!(received.ends_with('}'), "attempt {attempt}: {received}");
        }
    }
    assert!(forwarded.lock().unwrap().is_empty());
}
