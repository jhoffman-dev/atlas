//! A local stand-in for Google, for the tests: an authorization server that
//! checks PKCE as Google does, a token endpoint, revocation, and enough of the
//! Calendar API to list and make calendars. It runs over real TCP on
//! 127.0.0.1, so the host's requests are the ones the app sends. No test
//! reaches Google.

use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};

use http_body_util::{BodyExt, Full};
use hyper::body::{Bytes, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{header, Request, Response};
use hyper_util::rt::TokioIo;
use reqwest::Url;
use tokio::net::TcpListener;

use super::pkce::challenge_of;
use super::Endpoints;

pub const CLIENT_ID: &str = "1234-fictional.apps.googleusercontent.com";
pub const SCOPE: &str = "https://www.googleapis.com/auth/calendar.app.created";

/// How the token endpoint answers a code.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CodeAnswer {
    Tokens,
    WithoutRefreshToken,
    WithoutTheScope,
    NotJson,
}

/// What the person does on the consent screen, and what comes back.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Browser {
    Allows,
    Denies,
    /// Another program hits the loopback first, with a code and a wrong state.
    AllowsAfterAStranger,
    /// Comes back with this sign-in's state and nothing else.
    ComesBackEmpty,
    /// Never comes back.
    Abandons,
}

/// One authorization the fake granted, waiting to be traded for tokens.
struct Pending {
    challenge: String,
    client_id: String,
    redirect_uri: String,
}

#[derive(Default)]
pub struct Google {
    pending: HashMap<String, Pending>,
    refresh_tokens: HashSet<String>,
    access_tokens: HashMap<String, String>,
    issued: u32,
    /// Every code and token it ever made, live or not.
    pub ever_issued: Vec<String>,
    pub code_answer: Option<CodeAnswer>,
    /// The client secret the token endpoint insists on, as Google does for a
    /// Desktop client; None for a client that needs none.
    pub client_secret: Option<String>,
    /// The API answers with the request's Authorization header in its body.
    pub api_echoes: bool,
    pub revoke_unreachable: bool,
    /// Every code the token endpoint was sent, in order.
    pub codes_sent: Vec<String>,
    /// Every form the token endpoint was sent.
    pub token_forms: Vec<HashMap<String, String>>,
    pub revoked: Vec<String>,
    /// What the browser's tab said once the loopback answered it, in order.
    pub pages: Vec<String>,
    pub calendars: Vec<String>,
}

impl Google {
    fn issue(&mut self, prefix: &str) -> String {
        self.issued += 1;
        let made = format!("{prefix}{}", self.issued);
        self.ever_issued.push(made.clone());
        made
    }

    /// Ends every token: what a person removing Atlas from their account does.
    pub fn revoke_everything(&mut self) {
        self.refresh_tokens.clear();
        self.access_tokens.clear();
    }

    /// Ends the access tokens alone, as their hour running out does.
    pub fn expire_access_tokens(&mut self) {
        self.access_tokens.clear();
    }
}

pub struct FakeGoogle {
    pub endpoints: Endpoints,
    pub google: Arc<Mutex<Google>>,
}

type Answer = Response<Full<Bytes>>;

fn json(status: u16, body: String) -> Answer {
    let mut response = Response::new(Full::new(Bytes::from(body)));
    *response.status_mut() = hyper::StatusCode::from_u16(status).unwrap();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("application/json"),
    );
    response
}

fn form_of(body: &[u8]) -> HashMap<String, String> {
    let text = String::from_utf8_lossy(body);
    Url::parse(&format!("http://form.example/?{text}"))
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect()
}

fn oauth_error(code: &str) -> Answer {
    json(
        400,
        format!(r#"{{"error":"{code}","error_description":"fake"}}"#),
    )
}

fn token_answer(google: &mut Google, form: &HashMap<String, String>) -> Answer {
    let field = |name: &str| form.get(name).cloned().unwrap_or_default();
    if google.client_secret.is_some() && form.get("client_secret") != google.client_secret.as_ref()
    {
        return oauth_error("invalid_client");
    }
    match field("grant_type").as_str() {
        "authorization_code" => {
            google.codes_sent.push(field("code"));
            let Some(pending) = google.pending.remove(&field("code")) else {
                return oauth_error("invalid_grant");
            };
            let proven = challenge_of(&field("code_verifier")) == pending.challenge
                && field("client_id") == pending.client_id
                && field("redirect_uri") == pending.redirect_uri;
            if !proven {
                return oauth_error("invalid_grant");
            }
            code_tokens(google)
        }
        "refresh_token" => {
            if !google.refresh_tokens.contains(&field("refresh_token")) {
                return oauth_error("invalid_grant");
            }
            let access = google.issue("ya29.ACCESS-");
            google
                .access_tokens
                .insert(access.clone(), field("refresh_token"));
            json(
                200,
                format!(r#"{{"access_token":"{access}","expires_in":3599,"token_type":"Bearer"}}"#),
            )
        }
        _ => oauth_error("unsupported_grant_type"),
    }
}

fn code_tokens(google: &mut Google) -> Answer {
    let answer = google.code_answer.unwrap_or(CodeAnswer::Tokens);
    if answer == CodeAnswer::NotJson {
        return json(200, "<html>Sign in</html>".into());
    }
    let refresh = google.issue("1//REFRESH-");
    let access = google.issue("ya29.ACCESS-");
    google.refresh_tokens.insert(refresh.clone());
    google.access_tokens.insert(access.clone(), refresh.clone());
    let scope = if answer == CodeAnswer::WithoutTheScope {
        "openid"
    } else {
        SCOPE
    };
    let refresh_field = if answer == CodeAnswer::WithoutRefreshToken {
        String::new()
    } else {
        format!(r#""refresh_token":"{refresh}","#)
    };
    json(
        200,
        format!(
            r#"{{"access_token":"{access}","expires_in":3599,{refresh_field}"scope":"{scope}","token_type":"Bearer"}}"#
        ),
    )
}

fn revoke_answer(google: &mut Google, form: &HashMap<String, String>) -> Answer {
    let token = form.get("token").cloned().unwrap_or_default();
    if !google.refresh_tokens.remove(&token) {
        return json(400, r#"{"error":"invalid_token"}"#.into());
    }
    google.access_tokens.retain(|_, refresh| *refresh != token);
    google.revoked.push(token);
    json(200, "{}".into())
}

fn api_answer(google: &mut Google, method: &str, path: &str, authorization: &str) -> Answer {
    let bearer = authorization.strip_prefix("Bearer ").unwrap_or_default();
    if !google.access_tokens.contains_key(bearer) {
        return json(
            401,
            r#"{"error":{"code":401,"message":"Invalid Credentials"}}"#.into(),
        );
    }
    let echo = if google.api_echoes {
        format!(r#","authorization":"{authorization}""#)
    } else {
        String::new()
    };
    match (method, path) {
        ("GET", "/calendar/v3/users/me/calendarList") => {
            let items: Vec<String> = google
                .calendars
                .iter()
                .map(|name| {
                    let id = calendar_id(name);
                    format!(r#"{{"id":"{id}","summary":"{name}","accessRole":"owner"}}"#)
                })
                .collect();
            json(200, format!(r#"{{"items":[{}]{echo}}}"#, items.join(",")))
        }
        ("POST", "/calendar/v3/calendars") => {
            google.calendars.push("Atlas blocks".into());
            let id = calendar_id("Atlas blocks");
            json(200, format!(r#"{{"id":"{id}","summary":"Atlas blocks"}}"#))
        }
        _ => json(404, r#"{"error":{"code":404}}"#.into()),
    }
}

fn calendar_id(name: &str) -> String {
    format!(
        "{}@group.calendar.example.com",
        name.to_lowercase().replace(' ', "-")
    )
}

async fn answer(google: Arc<Mutex<Google>>, request: Request<Incoming>) -> Answer {
    let method = request.method().to_string();
    let path = request.uri().path().to_string();
    let authorization = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let body = request.into_body().collect().await.unwrap().to_bytes();
    let mut google = google.lock().unwrap();
    match path.as_str() {
        "/token" => {
            let form = form_of(&body);
            google.token_forms.push(form.clone());
            token_answer(&mut google, &form)
        }
        "/revoke" if google.revoke_unreachable => json(503, "unavailable".into()),
        "/revoke" => revoke_answer(&mut google, &form_of(&body)),
        _ => api_answer(&mut google, &method, &path, &authorization),
    }
}

impl FakeGoogle {
    pub async fn start() -> Self {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
        let base = format!(
            "http://127.0.0.1:{}/",
            listener.local_addr().unwrap().port()
        );
        let google = Arc::new(Mutex::new(Google::default()));
        let serving = google.clone();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let google = serving.clone();
                let service = service_fn(move |request| {
                    let google = google.clone();
                    async move { Ok::<_, Infallible>(answer(google, request).await) }
                });
                tokio::spawn(http1::Builder::new().serve_connection(TokioIo::new(stream), service));
            }
        });
        let at = |path: &str| Url::parse(&base).unwrap().join(path).unwrap();
        Self {
            endpoints: Endpoints {
                authorize: at("/auth"),
                token: at("/token"),
                revoke: at("/revoke"),
                api: at("/"),
            },
            google,
        }
    }

    /// A browser that does what `person` does with the consent screen at `url`:
    /// Google's side of it is recording the challenge against a new code, as
    /// the real authorization server does, and redirecting to the loopback.
    pub fn browser(&self, person: Browser) -> impl Fn(&Url) -> Result<(), String> + Sync {
        let google = self.google.clone();
        move |url: &Url| {
            let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
            let redirect = query["redirect_uri"].clone();
            let state = query["state"].clone();
            let code = {
                let mut google = google.lock().unwrap();
                let code = google.issue("4/0A-CODE-");
                google.pending.insert(
                    code.clone(),
                    Pending {
                        challenge: query["code_challenge"].clone(),
                        client_id: query["client_id"].clone(),
                        redirect_uri: redirect.clone(),
                    },
                );
                code
            };
            tokio::spawn(come_back(google.clone(), person, redirect, state, code));
            Ok(())
        }
    }
}

async fn come_back(
    google: Arc<Mutex<Google>>,
    person: Browser,
    redirect: String,
    state: String,
    code: String,
) {
    let visit = |query: String| {
        let url = format!("{redirect}?{query}");
        let google = google.clone();
        async move {
            let answer = reqwest::get(url).await?;
            let status = answer.status().as_u16();
            let page = answer.text().await?;
            google.lock().unwrap().pages.push(page);
            Ok::<_, reqwest::Error>(status)
        }
    };
    match person {
        Browser::Allows => {
            visit(format!("state={state}&code={code}&scope={SCOPE}"))
                .await
                .unwrap();
        }
        Browser::Denies => {
            visit(format!("error=access_denied&state={state}"))
                .await
                .unwrap();
        }
        Browser::AllowsAfterAStranger => {
            let stranger = visit("state=GUESSED&code=4/0A-STRANGER".into())
                .await
                .unwrap();
            assert_eq!(
                stranger, 400,
                "the loopback took a redirect with the wrong state"
            );
            visit(format!("state={state}&code={code}")).await.unwrap();
        }
        Browser::ComesBackEmpty => {
            visit(format!("state={state}")).await.unwrap();
        }
        Browser::Abandons => {}
    }
}
