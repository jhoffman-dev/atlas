//! A local stand-in for Amazon's Kindle notebook, for the tests. It runs over
//! real TCP on 127.0.0.1, so the host's requests are the ones the app sends,
//! serves the parser's hand-made fixtures, and records every request it
//! hears. No test reaches Amazon.

use std::collections::HashMap;
use std::convert::Infallible;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};

use http_body_util::Full;
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{header, Request, Response};
use hyper_util::rt::TokioIo;
use reqwest::Url;
use tokio::net::TcpListener;

use super::fetch::MAX_PAGE_BYTES;

pub const LIBRARY: &str =
    include_str!("../../../../../packages/domain/src/kindle/fixtures/library.html");
pub const LIBRARY_EMPTY: &str =
    include_str!("../../../../../packages/domain/src/kindle/fixtures/library-empty.html");
pub const ANNOTATIONS: &str =
    include_str!("../../../../../packages/domain/src/kindle/fixtures/annotations-page-1.html");
pub const SIGN_IN: &str =
    include_str!("../../../../../packages/domain/src/kindle/fixtures/sign-in.html");
pub const UNRECOGNISED: &str =
    include_str!("../../../../../packages/domain/src/kindle/fixtures/unrecognised.html");

/// How the fake answers one request.
#[derive(Clone)]
pub enum Reply {
    /// 200, with this HTML.
    Page(&'static str),
    /// This status, with a short body.
    Status(u16),
    /// A 302 to this location, as given (absolute or relative).
    Redirect(String),
    /// A 302 with no Location at all.
    RedirectNowhere,
    /// 200, with bytes that are not UTF-8 around a word that is.
    NotText,
    /// 200, one byte more than the host will read.
    Oversized,
    /// 200, a page that writes the request's Cookie header into itself.
    EchoCookie,
    /// Accepts the request and never answers it.
    Silent,
}

/// One request as the fake heard it.
#[derive(Debug, Clone)]
pub struct Heard {
    /// Path and query, as they arrived.
    pub target: String,
    pub cookie: Option<String>,
}

pub struct Amazon {
    /// By path and query; anything not named here gets `otherwise`.
    pub replies: HashMap<String, Reply>,
    pub otherwise: Reply,
    pub heard: Vec<Heard>,
}

pub struct FakeAmazon {
    pub origin: Url,
    pub amazon: Arc<Mutex<Amazon>>,
}

type Answer = Response<Full<Bytes>>;

fn answer_of(status: u16, body: impl Into<Bytes>) -> Answer {
    let mut response = Response::new(Full::new(body.into()));
    *response.status_mut() = hyper::StatusCode::from_u16(status).unwrap();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("text/html; charset=utf-8"),
    );
    response
}

fn redirect(location: Option<&str>) -> Answer {
    let mut response = answer_of(302, "");
    if let Some(location) = location {
        response.headers_mut().insert(
            header::LOCATION,
            header::HeaderValue::from_str(location).unwrap(),
        );
    }
    response
}

/// What the fake says, or None when it says nothing at all.
fn reply_to(reply: &Reply, cookie: Option<&str>) -> Option<Answer> {
    Some(match reply {
        Reply::Page(html) => answer_of(200, *html),
        Reply::Status(status) => answer_of(*status, "<p>fake error</p>"),
        Reply::Redirect(location) => redirect(Some(location)),
        Reply::RedirectNowhere => redirect(None),
        Reply::NotText => answer_of(200, b"\xff\xfe<p>word</p>\xff".to_vec()),
        Reply::Oversized => answer_of(200, vec![b' '; MAX_PAGE_BYTES + 1]),
        Reply::EchoCookie => answer_of(
            200,
            format!(
                r#"<div id="kp-notebook-library"><input value="{}"></div>"#,
                cookie.unwrap_or_default()
            ),
        ),
        Reply::Silent => return None,
    })
}

async fn answer(amazon: Arc<Mutex<Amazon>>, request: Request<Incoming>) -> Answer {
    let target = request
        .uri()
        .path_and_query()
        .map(|target| target.to_string())
        .unwrap_or_default();
    let cookie = request
        .headers()
        .get(header::COOKIE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let replied = {
        let mut amazon = amazon.lock().unwrap();
        amazon.heard.push(Heard {
            target: target.clone(),
            cookie: cookie.clone(),
        });
        let reply = amazon
            .replies
            .get(&target)
            .unwrap_or(&amazon.otherwise)
            .clone();
        reply_to(&reply, cookie.as_deref())
    };
    match replied {
        Some(reply) => reply,
        None => std::future::pending().await,
    }
}

impl FakeAmazon {
    pub async fn start(otherwise: Reply) -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let origin = Url::parse(&format!(
            "http://127.0.0.1:{}",
            listener.local_addr().unwrap().port()
        ))
        .unwrap();
        let amazon = Arc::new(Mutex::new(Amazon {
            replies: HashMap::new(),
            otherwise,
            heard: Vec::new(),
        }));
        let serving = amazon.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let amazon = serving.clone();
                let service = service_fn(move |request| {
                    let amazon = amazon.clone();
                    async move { Ok::<_, Infallible>(answer(amazon, request).await) }
                });
                tokio::spawn(http1::Builder::new().serve_connection(TokioIo::new(stream), service));
            }
        });
        Self { origin, amazon }
    }

    pub fn reply(&self, target: &str, reply: Reply) {
        self.amazon
            .lock()
            .unwrap()
            .replies
            .insert(target.to_string(), reply);
    }

    pub fn heard(&self) -> Vec<Heard> {
        self.amazon.lock().unwrap().heard.clone()
    }

    /// A page of the fake's notebook, as the webview would name it.
    pub fn url(&self, path_and_query: &str) -> String {
        self.origin.join(path_and_query).unwrap().to_string()
    }
}
