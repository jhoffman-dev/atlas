//! A local stand-in for Granola's public API, for the tests. It runs over real
//! TCP on 127.0.0.1, so the host's requests are the ones the app sends, and it
//! records every one it hears. No test reaches Granola.

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

use super::api::MAX_ANSWER_BYTES;

/// How the fake answers a request carrying the key it honours.
#[derive(Clone, PartialEq, Eq)]
pub enum Reply {
    /// A page of notes, as `GET /v1/notes` answers.
    Notes,
    /// This status, with Granola's error body.
    Status(u16),
    /// A redirect to this location.
    Redirect(String),
    /// Bytes that are not text.
    NotText,
    /// As much as the host will read, and no more.
    AtTheCap,
    /// One byte more than the host will read.
    Oversized,
    /// Accepts the request and never answers it.
    Silent,
}

/// One request as the fake heard it.
#[derive(Debug, Clone)]
pub struct Heard {
    pub method: String,
    /// With its query, as it arrived.
    pub target: String,
    pub authorization: String,
}

pub struct Granola {
    /// The key it honours; any other is answered 401.
    pub key: Option<String>,
    pub reply: Reply,
    /// Every answer carries the request's Authorization header in its body,
    /// as plenty of servers echo what they were sent.
    pub echoes: bool,
    /// How an echoed Authorization header is written, when not as it is.
    pub echo_as: Option<fn(&str) -> String>,
    pub heard: Vec<Heard>,
}

impl Default for Granola {
    fn default() -> Self {
        Self {
            key: None,
            reply: Reply::Notes,
            echoes: false,
            echo_as: None,
            heard: Vec::new(),
        }
    }
}

pub struct FakeGranola {
    pub origin: Url,
    pub granola: Arc<Mutex<Granola>>,
}

type Answer = Response<Full<Bytes>>;

fn answer_of(status: u16, body: impl Into<Bytes>) -> Answer {
    let mut response = Response::new(Full::new(body.into()));
    *response.status_mut() = hyper::StatusCode::from_u16(status).unwrap();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    response
}

fn echo_of(granola: &Granola, authorization: &str) -> String {
    if granola.echoes {
        let written = granola
            .echo_as
            .map_or(authorization.to_string(), |form| form(authorization));
        format!(r#","authorization":"{written}""#)
    } else {
        String::new()
    }
}

fn notes(echo: &str) -> String {
    format!(
        r#"{{"notes":[{{"id":"not_1d3tmYTlCICgjy","object":"note","title":"Larkspur Payroll kickoff","owner":{{"name":"Mara Quill","email":"mara@example.com"}},"created_at":"2026-10-01T16:00:00Z","updated_at":"2026-10-01T17:05:00Z"}}],"hasMore":false,"cursor":null{echo}}}"#
    )
}

/// What the fake says to one request, or None when it says nothing at all.
fn reply_to(granola: &Granola, authorization: &str) -> Option<Answer> {
    let echo = echo_of(granola, authorization);
    let honoured = granola
        .key
        .as_ref()
        .is_some_and(|key| authorization == format!("Bearer {key}"));
    if !honoured {
        return Some(answer_of(
            401,
            format!(r#"{{"message":"Unauthorized"{echo}}}"#),
        ));
    }
    Some(match &granola.reply {
        Reply::Notes => answer_of(200, notes(&echo)),
        Reply::Status(status) => answer_of(*status, format!(r#"{{"message":"fake"{echo}}}"#)),
        Reply::Redirect(location) => {
            let mut response = answer_of(302, format!(r#"{{"moved":true{echo}}}"#));
            response.headers_mut().insert(
                header::LOCATION,
                header::HeaderValue::from_str(location).unwrap(),
            );
            response
        }
        Reply::NotText => answer_of(200, vec![0xff, 0xfe, 0x00]),
        Reply::AtTheCap => answer_of(200, vec![b' '; MAX_ANSWER_BYTES]),
        Reply::Oversized => answer_of(200, vec![b' '; MAX_ANSWER_BYTES + 1]),
        Reply::Silent => return None,
    })
}

async fn answer(granola: Arc<Mutex<Granola>>, request: Request<Incoming>) -> Answer {
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let replied = {
        let mut granola = granola.lock().unwrap();
        granola.heard.push(Heard {
            method: request.method().to_string(),
            target: request.uri().to_string(),
            authorization: authorization.clone(),
        });
        reply_to(&granola, &authorization)
    };
    match replied {
        Some(reply) => reply,
        None => std::future::pending().await,
    }
}

impl FakeGranola {
    pub async fn start() -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let origin = Url::parse(&format!(
            "http://127.0.0.1:{}",
            listener.local_addr().unwrap().port()
        ))
        .unwrap();
        let granola = Arc::new(Mutex::new(Granola::default()));
        let serving = granola.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let granola = serving.clone();
                let service = service_fn(move |request| {
                    let granola = granola.clone();
                    async move { Ok::<_, Infallible>(answer(granola, request).await) }
                });
                tokio::spawn(http1::Builder::new().serve_connection(TokioIo::new(stream), service));
            }
        });
        Self { origin, granola }
    }
}
