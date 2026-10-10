//! Where Google sends the browser back to: a listener on 127.0.0.1 (RFC 8252
//! §7.3), on a port the system picks, for one sign-in.
//!
//! Only a redirect carrying this sign-in's `state` is acted on. Any other
//! request — a favicon, a stray page, another program on this Mac guessing —
//! is answered and ignored, so it can neither end the sign-in nor slip a code
//! of its own into it. The pages it answers with are fixed text: nothing from
//! the request is written back into them.
//!
//! The browser's tab is answered only once the sign-in has ended — the code
//! traded and the grant kept, or not — so it never says connected for a
//! sign-in that then failed. Another program flooding the listener can delay
//! the sign-in but not end it: a failed accept (out of file descriptors, a
//! connection reset before it was taken) is waited out, and connections past
//! a handful are closed as soon as they are taken.

use std::convert::Infallible;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::Duration;

use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{header, Method, Request, Response, StatusCode, Uri};
use hyper_util::rt::{TokioIo, TokioTimer};
use reqwest::Url;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinSet;

use super::failure::{FailureKind, GoogleFailure};
use super::pkce::same;

const HEADER_TIMEOUT: Duration = Duration::from_secs(10);

/// How long the page that ends a sign-in is given to reach the browser
/// before the listener is closed under it.
const FLUSH_TIMEOUT: Duration = Duration::from_secs(1);

/// How long a failed accept is waited out before listening again.
const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

/// Connections served at once. A browser opens a few; more is a flood.
const MAX_CONNECTIONS: usize = 16;

const SIGNED_IN: &str = "Atlas is connected to Google Calendar. You can close this tab.";
const NOT_SIGNED_IN: &str =
    "Atlas was not connected to Google Calendar. You can close this tab; Atlas says why in Settings.";
const RETURN_TO_ATLAS: &str = "You can close this tab and return to Atlas.";
const NOT_THIS_SIGN_IN: &str = "This is not the sign-in Atlas is waiting for.";
const NOTHING_HERE: &str = "Nothing here.";

/// What Google sent the browser back with.
#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    Code(String),
    /// The OAuth error code, such as `access_denied`.
    Refused(String),
}

/// How the sign-in ended, as the browser's tab is told.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ending {
    Connected,
    NotConnected,
}

/// What one request to the listener was.
#[derive(Debug, PartialEq)]
enum Heard {
    /// Not the redirect at all.
    Elsewhere,
    /// The redirect, for some other sign-in or none.
    Stranger,
    Ours(Result<Callback, GoogleFailure>),
}

pub struct Loopback {
    listener: TcpListener,
    redirect_uri: String,
}

impl Loopback {
    pub async fn bind() -> Result<Self, GoogleFailure> {
        let refused = |error: std::io::Error| {
            GoogleFailure::new(
                FailureKind::Unreachable,
                format!("cannot listen for Google's answer: {error}"),
            )
        };
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(refused)?;
        let port = listener.local_addr().map_err(refused)?.port();
        Ok(Self {
            listener,
            redirect_uri: format!("http://127.0.0.1:{port}/"),
        })
    }

    /// The address Google is told to send the browser back to.
    pub fn redirect_uri(&self) -> &str {
        &self.redirect_uri
    }

    /// Serves the listener until the redirect for `state` arrives. The tab
    /// that brought it waits for `Answering::finish`.
    pub async fn wait(self, state: String) -> (Outcome, Answering) {
        until_redirect(&self.listener, state).await
    }
}

/// Where connections come from: the listener, or in a test a stand-in that
/// fails to accept the way a process out of file descriptors does.
trait Accepts: Sync {
    fn accept_one(&self) -> impl std::future::Future<Output = std::io::Result<TcpStream>> + Send;
}

impl Accepts for TcpListener {
    async fn accept_one(&self) -> std::io::Result<TcpStream> {
        self.accept().await.map(|(stream, _)| stream)
    }
}

async fn until_redirect(listener: &impl Accepts, state: String) -> (Outcome, Answering) {
    let (sender, mut received) = mpsc::channel(1);
    let state = Arc::new(state);
    let mut connections = JoinSet::new();
    let (outcome, reply) = loop {
        tokio::select! {
            accepted = listener.accept_one() => match accepted {
                Ok(stream) => {
                    while connections.try_join_next().is_some() {}
                    // Past the cap the connection is dropped, which closes it.
                    if connections.len() < MAX_CONNECTIONS {
                        connections.spawn(serve(stream, state.clone(), sender.clone()));
                    }
                }
                // Out of descriptors, or a connection reset before it was
                // taken: both pass, and the sign-in is still waiting.
                Err(error) => {
                    log::debug!("the sign-in listener could not accept: {error}");
                    tokio::time::sleep(ACCEPT_BACKOFF).await;
                }
            },
            Some(heard) = received.recv() => break heard,
        }
    };
    let answering = Answering {
        connections,
        reply: Some(reply),
    };
    (outcome, answering)
}

/// The browser's tab, waiting to be told how the sign-in ended.
pub struct Answering {
    connections: JoinSet<()>,
    reply: Option<oneshot::Sender<Ending>>,
}

impl Answering {
    /// Tells the tab how the sign-in ended, and gives the page a moment to
    /// reach it before the listener closes.
    pub async fn finish(mut self, ending: Ending) {
        if let Some(reply) = self.reply.take() {
            // A tab already closed has no one to tell.
            let _ = reply.send(ending);
        }
        // Whether every connection finished in time does not change the
        // outcome; one that did not is dropped with the listener.
        let _ = tokio::time::timeout(FLUSH_TIMEOUT, async {
            while self.connections.join_next().await.is_some() {}
        })
        .await;
    }
}

type Outcome = Result<Callback, GoogleFailure>;

/// The redirect, and where to say how the sign-in it started ended.
type Redirect = (Outcome, oneshot::Sender<Ending>);

/// The page for this sign-in's redirect, once it has ended. A redirect that
/// is not acted on — a second one — is told nothing it could take for the
/// outcome.
async fn ending_page(outcome: Outcome, sender: &mpsc::Sender<Redirect>) -> &'static str {
    let (reply, ended) = oneshot::channel();
    if sender.try_send((outcome, reply)).is_err() {
        return RETURN_TO_ATLAS;
    }
    match ended.await {
        Ok(Ending::Connected) => SIGNED_IN,
        Ok(Ending::NotConnected) => NOT_SIGNED_IN,
        Err(_) => RETURN_TO_ATLAS,
    }
}

async fn serve(stream: TcpStream, state: Arc<String>, sender: mpsc::Sender<Redirect>) {
    let service = service_fn(move |request: Request<Incoming>| {
        let (state, sender) = (state.clone(), sender.clone());
        async move {
            let (status, page) = match heard(request.method(), request.uri(), &state) {
                Heard::Elsewhere => (StatusCode::NOT_FOUND, NOTHING_HERE),
                Heard::Stranger => (StatusCode::BAD_REQUEST, NOT_THIS_SIGN_IN),
                // Only the first redirect for a sign-in is acted on; a second
                // finds the channel full or closed.
                Heard::Ours(outcome) => (StatusCode::OK, ending_page(outcome, &sender).await),
            };
            Ok::<_, Infallible>(page_response(status, page))
        }
    });
    let served = http1::Builder::new()
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_TIMEOUT)
        .serve_connection(TokioIo::new(stream), service)
        .await;
    if let Err(error) = served {
        log::debug!("sign-in listener connection ended: {error}");
    }
}

fn page_response(status: StatusCode, text: &'static str) -> Response<Full<Bytes>> {
    let page = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>Atlas</title>\
         <body style=\"font:16px system-ui;margin:3em\"><p>{text}</p>"
    );
    let mut response = Response::new(Full::new(Bytes::from(page)));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(
        header::CONNECTION,
        header::HeaderValue::from_static("close"),
    );
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        header::HeaderValue::from_static("no-referrer"),
    );
    response
}

fn heard(method: &Method, uri: &Uri, state: &str) -> Heard {
    if method != Method::GET || uri.path() != "/" {
        return Heard::Elsewhere;
    }
    let Ok(url) = Url::parse(&format!("http://127.0.0.1/?{}", uri.query().unwrap_or(""))) else {
        return Heard::Stranger;
    };
    let value = |name: &str| {
        url.query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
    };
    match value("state") {
        Some(sent) if same(&sent, state) => {}
        _ => return Heard::Stranger,
    }
    // An error wins over a code: a redirect carrying both is not one to
    // spend a code from.
    Heard::Ours(match (value("error"), value("code")) {
        (Some(error), _) => Ok(Callback::Refused(error)),
        (None, Some(code)) if !code.is_empty() => Ok(Callback::Code(code)),
        _ => Err(GoogleFailure::new(
            FailureKind::Malformed,
            "Google sent the browser back with neither a code nor an error",
        )),
    })
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    use hyper::{Method, Uri};
    use tokio::io::AsyncReadExt;
    use tokio::net::{TcpListener, TcpStream};

    use super::{heard, until_redirect, Accepts, Callback, Ending, Heard, MAX_CONNECTIONS};
    use crate::google::failure::FailureKind;

    /// A listener whose first accepts fail as they do with no descriptors left.
    struct Exhausted {
        listener: TcpListener,
        failures: AtomicUsize,
    }

    impl Accepts for Exhausted {
        async fn accept_one(&self) -> std::io::Result<TcpStream> {
            let failing = self
                .failures
                .try_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                    left.checked_sub(1)
                });
            if failing.is_ok() {
                return Err(std::io::Error::from_raw_os_error(libc::EMFILE));
            }
            self.accept().await
        }
    }

    impl Exhausted {
        async fn accept(&self) -> std::io::Result<TcpStream> {
            self.listener.accept().await.map(|(stream, _)| stream)
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_failed_accept_is_waited_out_and_the_redirect_still_heard() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let exhausted = Exhausted {
            listener,
            failures: AtomicUsize::new(3),
        };
        let browser = tokio::spawn(async move {
            reqwest::get(format!("http://127.0.0.1:{port}/?state=S7ATE&code=C0DE")).await
        });

        let (outcome, answering) = until_redirect(&exhausted, "S7ATE".into()).await;
        answering.finish(Ending::Connected).await;

        assert_eq!(outcome, Ok(Callback::Code("C0DE".into())));
        assert_eq!(exhausted.failures.load(Ordering::SeqCst), 0);
        assert_eq!(browser.await.unwrap().unwrap().status(), 200);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn connections_past_the_cap_are_closed_as_soon_as_they_are_taken() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let waiting = tokio::spawn(async move { until_redirect(&listener, "S7ATE".into()).await });
        let flood = MAX_CONNECTIONS + 8;
        let mut readers = tokio::task::JoinSet::new();
        for _ in 0..flood {
            let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port))
                .await
                .unwrap();
            // A closed connection reads its end at once; a served one waits
            // for a request it is never sent.
            readers.spawn(async move {
                let mut byte = [0u8; 1];
                let read = tokio::time::timeout(Duration::from_secs(1), stream.read(&mut byte));
                matches!(read.await, Ok(Ok(0)) | Ok(Err(_)))
            });
        }

        let closed = readers
            .join_all()
            .await
            .into_iter()
            .filter(|closed| *closed)
            .count();

        waiting.abort();
        assert_eq!(closed, flood - MAX_CONNECTIONS);
    }

    fn at(path: &str) -> Heard {
        heard(&Method::GET, &path.parse::<Uri>().unwrap(), "S7ATE")
    }

    #[test]
    fn the_redirect_with_this_sign_ins_state_carries_the_code() {
        assert_eq!(
            at("/?state=S7ATE&code=4%2F0Acode&scope=x"),
            Heard::Ours(Ok(Callback::Code("4/0Acode".into())))
        );
    }

    #[test]
    fn a_refusal_with_this_sign_ins_state_ends_it_with_googles_code() {
        assert_eq!(
            at("/?error=access_denied&state=S7ATE"),
            Heard::Ours(Ok(Callback::Refused("access_denied".into())))
        );
    }

    #[test]
    fn an_error_beside_a_code_is_a_refusal() {
        assert_eq!(
            at("/?error=access_denied&code=C&state=S7ATE"),
            Heard::Ours(Ok(Callback::Refused("access_denied".into())))
        );
    }

    #[test]
    fn a_redirect_with_another_state_or_none_is_a_stranger() {
        for path in [
            "/?state=OTHER&code=C",
            "/?code=C",
            "/?state=S7AT&code=C",
            "/?state=S7ATEX&code=C",
        ] {
            assert_eq!(at(path), Heard::Stranger, "{path}");
        }
    }

    #[test]
    fn anything_but_a_get_of_the_root_is_elsewhere() {
        assert_eq!(at("/favicon.ico"), Heard::Elsewhere);
        let posted = heard(
            &Method::POST,
            &"/?state=S7ATE&code=C".parse().unwrap(),
            "S7ATE",
        );
        assert_eq!(posted, Heard::Elsewhere);
    }

    #[test]
    fn this_sign_ins_redirect_with_neither_code_nor_error_is_malformed() {
        let Heard::Ours(Err(failure)) = at("/?state=S7ATE&code=") else {
            panic!("expected a malformed redirect");
        };
        assert_eq!(failure.kind, FailureKind::Malformed);
    }
}
