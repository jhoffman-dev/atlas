//! The HTTP server itself: accept, vet, forward, wait, answer.
//!
//! It knows nothing about Tauri. What it forwards to is a function it is handed
//! — the webview in the app, a closure in the tests — so everything between the
//! socket and that function can be tested over real TCP.

use std::convert::Infallible;
use std::future::poll_fn;
use std::net::{Ipv4Addr, TcpListener};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, RwLock};
use std::time::Duration;

use http_body_util::{BodyExt, Full, Limited};
use hyper::body::{Body, Bytes, Incoming};
use hyper::header::{HeaderMap, HeaderName, HeaderValue};
use hyper::http::request::Parts;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{header, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{watch, Semaphore};

use super::broker::{Answer, Broker};
use super::request::{next_id, parse_body, parse_query, route, ApiRequest};
use super::vet::{vet, Envelope, Expected, Refusal};

/// ADR-0016: a stuck handler must not hold a caller forever.
pub const ANSWER_TIMEOUT: Duration = Duration::from_secs(30);

/// A client that opens a connection and dribbles its headers or body holds a
/// task; these bound how long.
const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
const BODY_TIMEOUT: Duration = Duration::from_secs(10);

/// How much of a caller's unread request a closing connection reads and
/// discards, and for how long, so the caller can read the last answer (see
/// `close_lingering`). Bounded, so a caller that keeps sending is reset soon
/// rather than holding the connection.
const LINGER_BYTES: usize = 64 * 1024;
const LINGER_TIMEOUT: Duration = Duration::from_secs(1);

/// How long one connection may live, and how many may be open at once.
///
/// Every connection is a file descriptor in the app's process, and vault saves
/// need descriptors too, so no caller — token or not — may hold them without
/// limit. A client that stops reading its answers leaves the server blocked on
/// a full socket with no other timer running; the lifetime is what ends that.
#[derive(Debug, Clone, Copy)]
pub struct ConnectionLimits {
    /// After this the connection takes no new request; one already in flight
    /// may still finish.
    pub lifetime: Duration,
    /// Then, after this much longer, it is closed whatever it is doing. Longer
    /// than a legitimate request can take — header, body and answer timeouts
    /// together — so only a stalled connection is ever cut off.
    pub drain: Duration,
    /// Connections past this wait in the kernel's accept queue, costing the
    /// app nothing, until one of the open ones ends.
    pub max_open: usize,
}

impl Default for ConnectionLimits {
    fn default() -> Self {
        ConnectionLimits {
            lifetime: Duration::from_secs(60),
            drain: Duration::from_secs(60),
            max_open: 32,
        }
    }
}

/// Hands a request to whatever answers it. An error means it could not be
/// handed over at all.
pub type Forward = Arc<dyn Fn(&ApiRequest) -> Result<(), String> + Send + Sync>;

/// The token, shared with the commands that rotate it, so a new token applies
/// to the very next request — including one on a connection already open.
pub type SharedToken = Arc<RwLock<String>>;

/// Whether the webview's router is listening, as it last said. Shared with the
/// command it says so through.
pub type RouterReady = Arc<AtomicBool>;

/// Everything a request is checked against and handed to.
pub struct Gate {
    pub token: SharedToken,
    pub broker: Arc<Broker>,
    pub forward: Forward,
    pub answer_timeout: Duration,
    pub max_body: usize,
    /// Until the router listens — at startup, and while the page reloads — an
    /// event sent to it is lost and its caller would wait out the whole answer
    /// timeout.
    pub router_ready: RouterReady,
}

/// How long `Running::stop` waits for the listener to close. The accept loop
/// notices the stop at its next poll, so this is only ever reached by a
/// runtime that has stalled.
const STOP_TIMEOUT: Duration = Duration::from_secs(2);

/// A server that is listening. Dropping it stops the server and closes every
/// connection it had open, so turning the API off takes effect at once.
pub struct Running {
    pub port: u16,
    stop: watch::Sender<()>,
    /// Disconnects once the listener is closed and the port is free again.
    released: mpsc::Receiver<()>,
}

impl Running {
    /// Stops the server and blocks until its port is free, so turning the API
    /// straight back on binds the same port rather than finding it held by
    /// this server's own listener. Never call it on the runtime the server is
    /// spawned on: that runtime has to run the accept loop to its end.
    pub fn stop(self) {
        let Running {
            port,
            stop,
            released,
        } = self;
        drop(stop);
        if let Err(mpsc::RecvTimeoutError::Timeout) = released.recv_timeout(STOP_TIMEOUT) {
            log::warn!("API port {port} was still open {STOP_TIMEOUT:?} after stopping");
        }
    }
}

/// Binds `127.0.0.1` — never every interface — on the port asked for when it is
/// free, and otherwise on whatever port the OS chooses.
pub fn bind(preferred: u16) -> std::io::Result<TcpListener> {
    if preferred != 0 {
        if let Ok(listener) = TcpListener::bind((Ipv4Addr::LOCALHOST, preferred)) {
            return Ok(listener);
        }
        log::info!("API port {preferred} is taken; letting the OS choose");
    }
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
}

/// Prepares to serve on `listener`. The returned future is the server; spawn it
/// on a Tokio runtime. It ends when the `Running` handle is dropped.
pub fn start(
    listener: TcpListener,
    gate: Arc<Gate>,
) -> std::io::Result<(Running, impl std::future::Future<Output = ()>)> {
    start_with(listener, gate, ConnectionLimits::default())
}

/// `start`, with connection limits other than the defaults.
pub fn start_with(
    listener: TcpListener,
    gate: Arc<Gate>,
    limits: ConnectionLimits,
) -> std::io::Result<(Running, impl std::future::Future<Output = ()>)> {
    let port = listener.local_addr()?.port();
    listener.set_nonblocking(true)?;
    let (stop, stopped) = watch::channel(());
    let (release, released) = mpsc::channel();
    let serving = async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                let serving = Serving { gate, port, limits };
                accept_until_stopped(listener, serving, stopped).await
            }
            Err(error) => log::error!("the API server could not start: {error}"),
        }
        // The listener was dropped above; `Running::stop` is waiting on this.
        drop(release);
    };
    let running = Running {
        port,
        stop,
        released,
    };
    Ok((running, serving))
}

/// What every connection of one server shares.
struct Serving {
    gate: Arc<Gate>,
    port: u16,
    limits: ConnectionLimits,
}

async fn accept_until_stopped(
    listener: tokio::net::TcpListener,
    serving: Serving,
    mut stopped: watch::Receiver<()>,
) {
    let port = serving.port;
    let open = Arc::new(Semaphore::new(serving.limits.max_open));
    let serving = Arc::new(serving);
    log::info!("API listening on 127.0.0.1:{port}");
    // A slot first, then the accept: past the cap, connections wait in the
    // kernel's queue rather than as descriptors in this process. Only a closed
    // semaphore fails to give a slot, and this one is never closed.
    while let Some(Ok(slot)) = until_stopped(&mut stopped, open.clone().acquire_owned()).await {
        let Some(accepted) = until_stopped(&mut stopped, listener.accept()).await else {
            break;
        };
        match accepted {
            Ok((stream, _)) => {
                let connection = serve_connection(stream, serving.clone(), stopped.clone());
                tokio::spawn(async move {
                    connection.await;
                    drop(slot);
                });
            }
            Err(error) => pause_after_failed_accept(error).await,
        }
    }
    log::info!("API stopped listening on 127.0.0.1:{port}");
}

/// What `work` comes to, or nothing once the server is told to stop.
async fn until_stopped<T>(
    stopped: &mut watch::Receiver<()>,
    work: impl std::future::Future<Output = T>,
) -> Option<T> {
    tokio::select! {
        done = work => Some(done),
        _ = stopped.changed() => None,
    }
}

/// Usually out of file descriptors; pausing lets some close rather than
/// spinning on the same failure.
async fn pause_after_failed_accept(error: std::io::Error) {
    log::warn!("API accept failed: {error}");
    tokio::time::sleep(Duration::from_millis(100)).await;
}

async fn serve_connection(
    stream: tokio::net::TcpStream,
    serving: Arc<Serving>,
    mut stopped: watch::Receiver<()>,
) {
    let limits = serving.limits;
    let refused = Arc::new(AtomicBool::new(false));
    let refusing = refused.clone();
    let service = service_fn(move |request| {
        let (serving, refusing) = (serving.clone(), refusing.clone());
        // Boxed so the connection is `Unpin`, which taking the stream back
        // from hyper once it is done (`poll_without_shutdown`) needs.
        Box::pin(async move { Ok::<_, Infallible>(respond(&serving, request, &refusing).await) })
    });
    let mut connection = http1::Builder::new()
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_TIMEOUT)
        .serve_connection(TokioIo::new(stream), service);
    match served_for_its_lifetime(&mut connection, limits, &mut stopped).await {
        Some(Ok(())) if refused.load(Ordering::Relaxed) => {
            close_lingering(connection.into_parts().io.into_inner()).await
        }
        Some(Err(error)) => log::debug!("API connection ended: {error}"),
        Some(Ok(())) | None => {}
    }
}

/// Serves the connection until hyper is done with it, taking no new request
/// after its lifetime; nothing once it outlives the drain too, or the server
/// stops.
async fn served_for_its_lifetime<S>(
    connection: &mut http1::Connection<TokioIo<tokio::net::TcpStream>, S>,
    limits: ConnectionLimits,
    stopped: &mut watch::Receiver<()>,
) -> Option<hyper::Result<()>>
where
    S: hyper::service::HttpService<Incoming, ResBody = Full<Bytes>> + Unpin,
    S::Future: Unpin,
    S::Error: Into<Box<dyn std::error::Error + Send + Sync>>,
{
    tokio::select! {
        served = poll_fn(|cx| connection.poll_without_shutdown(cx)) => return Some(served),
        _ = tokio::time::sleep(limits.lifetime) => {}
        _ = stopped.changed() => return None,
    }
    Pin::new(&mut *connection).graceful_shutdown();
    let draining = poll_fn(|cx| connection.poll_without_shutdown(cx));
    tokio::select! {
        drained = tokio::time::timeout(limits.drain, draining) => drained.ok().or_else(|| {
            log::debug!("API connection closed: still busy after its lifetime");
            None
        }),
        _ = stopped.changed() => None,
    }
}

/// Closes a connection after a refusal so that its caller can read it.
///
/// A refusal is sent before the request's body is read, and closing a socket
/// with unread bytes in it sends a reset rather than a clean close; the reset
/// can reach the caller before it has read the refusal, which it then never
/// sees. So the write half is shut first — the caller reads the answer, then
/// the end — and whatever the caller is still sending is read and thrown
/// away, within bounds, until it closes too. Any other connection hyper is
/// done with has nothing unread, and closes at once.
async fn close_lingering(mut stream: tokio::net::TcpStream) {
    if stream.shutdown().await.is_err() {
        // The caller already reset or closed it: there is nothing left to deliver.
        return;
    }
    let mut discarded = 0;
    let mut chunk = [0u8; 8 * 1024];
    let draining = async {
        while discarded < LINGER_BYTES {
            match stream.read(&mut chunk).await {
                Ok(0) | Err(_) => break,
                Ok(read) => discarded += read,
            }
        }
    };
    // Out of time or bytes: the caller is still sending, and the close that
    // follows may reset it, but it has had its chance to read the answer.
    let _ = tokio::time::timeout(LINGER_TIMEOUT, draining).await;
}

/// The answer to a request, marking `refused` when it is refused before the
/// router sees it — the connection then closes after it.
async fn respond(
    serving: &Serving,
    request: Request<Incoming>,
    refused: &AtomicBool,
) -> Response<Full<Bytes>> {
    match translate(serving, request).await {
        Ok(request) => json_response(
            forward_and_wait(&serving.gate, &request)
                .await
                .unwrap_or_else(answer_of),
        ),
        Err(refusal) => {
            refused.store(true, Ordering::Relaxed);
            closing(json_response(answer_of(refusal)))
        }
    }
}

fn answer_of(refusal: Refusal) -> Answer {
    Answer {
        status: refusal.status,
        body: refusal.body(),
    }
}

/// Only a caller with the token keeps a connection: after a refusal made
/// before the router sees the request, hyper closes it rather than reading the
/// next pipelined request, so a caller without the token cannot hold a slot.
fn closing(mut response: Response<Full<Bytes>>) -> Response<Full<Bytes>> {
    response
        .headers_mut()
        .insert(header::CONNECTION, HeaderValue::from_static("close"));
    response
}

/// The request as the router will see it, or the host's refusal of it.
async fn translate(serving: &Serving, request: Request<Incoming>) -> Result<ApiRequest, Refusal> {
    let (parts, body) = request.into_parts();
    admit(serving, &parts, body.size_hint().exact())?;
    let method = route(parts.method.as_str(), parts.uri.path())?;
    let query = parse_query(parts.uri.query())?;
    let bytes = read_capped(body, serving.gate.max_body).await?;
    Ok(ApiRequest {
        id: next_id(),
        method,
        path: parts.uri.path().to_string(),
        query,
        body: parse_body(&bytes)?,
    })
}

fn admit(serving: &Serving, parts: &Parts, declared_length: Option<u64>) -> Result<(), Refusal> {
    let gate = &serving.gate;
    let token = gate
        .token
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let envelope = Envelope {
        // Absolute form (`GET http://…/v1`) or authority form (`CONNECT …`).
        target_names_host: parts.uri.authority().is_some(),
        host: values_of(&parts.headers, header::HOST),
        origin: values_of(&parts.headers, header::ORIGIN),
        authorization: values_of(&parts.headers, header::AUTHORIZATION),
        declared_length,
    };
    let expected = Expected {
        port: serving.port,
        token: &token,
        max_body: gate.max_body,
    };
    vet(&envelope, &expected)
}

/// Every value sent for the header `name`, as bytes: a repeated header is
/// judged as the repeat it is, not as its first copy.
fn values_of(headers: &HeaderMap, name: HeaderName) -> Vec<&[u8]> {
    headers
        .get_all(name)
        .iter()
        .map(HeaderValue::as_bytes)
        .collect()
}

/// Reads the body without ever holding more than the cap: a body that declared
/// no length, or lied about it, is cut off at the frame that would cross it.
async fn read_capped(body: Incoming, max_body: usize) -> Result<Bytes, Refusal> {
    let collected = tokio::time::timeout(BODY_TIMEOUT, Limited::new(body, max_body).collect())
        .await
        .map_err(|_| Refusal::BODY_UNREADABLE)?;
    match collected {
        Ok(collected) => Ok(collected.to_bytes()),
        Err(error) if error.is::<http_body_util::LengthLimitError>() => Err(Refusal::TOO_LARGE),
        Err(_) => Err(Refusal::BODY_UNREADABLE),
    }
}

async fn forward_and_wait(gate: &Gate, request: &ApiRequest) -> Result<Answer, Refusal> {
    if !gate.router_ready.load(Ordering::SeqCst) {
        return Err(Refusal::STARTING);
    }
    let ticket = gate.broker.register(&request.id);
    (gate.forward)(request).map_err(|error| {
        log::warn!("API request could not be handed to the app: {error}");
        Refusal::INTERNAL
    })?;
    ticket
        .wait(gate.answer_timeout)
        .await
        .ok_or(Refusal::TIMEOUT)
}

/// The app's answer, as JSON, with no CORS headers — no page may read it.
fn json_response(answer: Answer) -> Response<Full<Bytes>> {
    let (status, body) = match StatusCode::from_u16(answer.status) {
        Ok(status) if (200..600).contains(&answer.status) => (status, answer.body),
        _ => {
            log::warn!("the app answered with status {}", answer.status);
            (StatusCode::INTERNAL_SERVER_ERROR, Refusal::INTERNAL.body())
        }
    };
    // Serialising a `Value` cannot fail: every key is already a string.
    let bytes = serde_json::to_vec(&body).unwrap_or_default();
    let mut response = Response::new(Full::new(Bytes::from(bytes)));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    response
}
