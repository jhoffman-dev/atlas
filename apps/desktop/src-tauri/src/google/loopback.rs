//! Where Google sends the browser back to: a listener on 127.0.0.1 (RFC 8252
//! §7.3), on a port the system picks, for one sign-in.
//!
//! Only a redirect carrying this sign-in's `state` is acted on. Any other
//! request — a favicon, a stray page, another program on this Mac guessing —
//! is answered and ignored, so it can neither end the sign-in nor slip a code
//! of its own into it. The pages it answers with are fixed text: nothing from
//! the request is written back into them.

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
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::failure::{FailureKind, GoogleFailure};
use super::pkce::same;

const HEADER_TIMEOUT: Duration = Duration::from_secs(10);

/// How long the page that ends a sign-in is given to reach the browser
/// before the listener is closed under it.
const FLUSH_TIMEOUT: Duration = Duration::from_secs(1);

const SIGNED_IN: &str = "Atlas is connected to Google Calendar. You can close this tab.";
const NOT_SIGNED_IN: &str =
    "Atlas was not connected to Google Calendar. You can close this tab; Atlas says why in Settings.";
const NOT_THIS_SIGN_IN: &str = "This is not the sign-in Atlas is waiting for.";
const NOTHING_HERE: &str = "Nothing here.";

/// What Google sent the browser back with.
#[derive(Debug, PartialEq, Eq)]
pub enum Callback {
    Code(String),
    /// The OAuth error code, such as `access_denied`.
    Refused(String),
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

    /// Serves the listener until the redirect for `state` arrives.
    pub async fn wait(self, state: String) -> Result<Callback, GoogleFailure> {
        let (sender, mut received) = mpsc::channel(1);
        let state = Arc::new(state);
        let mut connections = JoinSet::new();
        let outcome = loop {
            tokio::select! {
                accepted = self.listener.accept() => {
                    let (stream, _) = accepted.map_err(|error| GoogleFailure::new(
                        FailureKind::Unreachable,
                        format!("stopped listening for Google's answer: {error}"),
                    ))?;
                    connections.spawn(serve(stream, state.clone(), sender.clone()));
                }
                Some(outcome) = received.recv() => break outcome,
            }
        };
        // Whether every connection finished in time does not change the
        // outcome; one that did not is dropped with the listener.
        let _ = tokio::time::timeout(FLUSH_TIMEOUT, async {
            while connections.join_next().await.is_some() {}
        })
        .await;
        outcome
    }
}

type Outcome = Result<Callback, GoogleFailure>;

async fn serve(stream: TcpStream, state: Arc<String>, sender: mpsc::Sender<Outcome>) {
    let service = service_fn(move |request: Request<Incoming>| {
        let (state, sender) = (state.clone(), sender.clone());
        async move {
            let (status, page) = match heard(request.method(), request.uri(), &state) {
                Heard::Elsewhere => (StatusCode::NOT_FOUND, NOTHING_HERE),
                Heard::Stranger => (StatusCode::BAD_REQUEST, NOT_THIS_SIGN_IN),
                Heard::Ours(outcome) => {
                    let page = match outcome {
                        Ok(Callback::Code(_)) => SIGNED_IN,
                        _ => NOT_SIGNED_IN,
                    };
                    // Only the first redirect for a sign-in is acted on; a
                    // second finds the channel full or closed, and is
                    // answered the same way without changing the outcome.
                    let _ = sender.try_send(outcome);
                    (StatusCode::OK, page)
                }
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
    use hyper::{Method, Uri};

    use super::{heard, Callback, Heard};
    use crate::google::failure::FailureKind;

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
