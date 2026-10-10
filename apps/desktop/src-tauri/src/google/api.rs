//! One call to the Google Calendar API, carrying the access token.
//!
//! The webview says which call — method, path and body, as TypeScript builds
//! them — and the host adds the token and sends it to the one API it may go
//! to. Which calls to make and what their answers mean are TypeScript's
//! (ADR-0005); where the token may go is the host's, because the webview is
//! the untrusted side (ADR-0017).

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Method, Url};
use serde::{Deserialize, Serialize};

use super::failure::{FailureKind, GoogleFailure};
use super::token::{answer_of, client, unreachable};

/// The only paths a call may reach: the Calendar API, version 3.
const CALENDAR_PATH: &str = "/calendar/v3/";

/// A call as TypeScript asks for it. It holds no token.
#[derive(Debug, Clone, Deserialize)]
pub struct ApiCall {
    pub method: String,
    /// From `/calendar/v3/`, with any query.
    pub path: String,
    /// JSON, for a call that sends some.
    #[serde(default)]
    pub body: Option<String>,
}

/// What the API answered, with every token struck from the body.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct GoogleAnswer {
    pub status: u16,
    pub body: String,
}

fn invalid(message: String) -> GoogleFailure {
    GoogleFailure::new(FailureKind::Invalid, message)
}

/// The call's URL, if it stays under the Calendar API. A path that starts
/// with `/` keeps the API's origin when joined to it, so what a path could
/// still change is the path itself, through `..` or its encoded forms — which
/// is why it is checked again once parsing has resolved them.
pub fn call_url(api: &Url, path: &str) -> Result<Url, GoogleFailure> {
    let refused = || invalid(format!("{path:?} is not a Google Calendar API path"));
    if !path.starts_with(CALENDAR_PATH) {
        return Err(refused());
    }
    let url = api.join(path).map_err(|_| refused())?;
    if url.path().starts_with(CALENDAR_PATH) {
        Ok(url)
    } else {
        Err(refused())
    }
}

fn call_method(method: &str) -> Result<Method, GoogleFailure> {
    match method {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        other => Err(invalid(format!(
            "{other:?} is not a method the Calendar API is called with"
        ))),
    }
}

/// A call checked and ready to send, before any token is added.
pub struct Checked {
    method: Method,
    url: Url,
    body: Option<String>,
}

pub fn check(api: &Url, call: &ApiCall) -> Result<Checked, GoogleFailure> {
    Ok(Checked {
        method: call_method(&call.method)?,
        url: call_url(api, &call.path)?,
        body: call.body.clone(),
    })
}

/// Sends the call with `access_token`. The answer's body is raw; the caller
/// strikes the tokens from it.
pub async fn send(checked: &Checked, access_token: &str) -> Result<(u16, Vec<u8>), GoogleFailure> {
    let mut request = client()?
        .request(checked.method.clone(), checked.url.clone())
        .header(AUTHORIZATION, format!("Bearer {access_token}"));
    if let Some(body) = &checked.body {
        request = request
            .header(CONTENT_TYPE, "application/json")
            .body(body.clone());
    }
    let response = request.send().await.map_err(unreachable)?;
    answer_of(response).await
}

#[cfg(test)]
mod tests {
    use reqwest::Url;

    use super::{call_method, call_url};

    fn api() -> Url {
        Url::parse("https://www.googleapis.com/").unwrap()
    }

    #[test]
    fn a_calendar_path_is_sent_to_the_api() {
        let url = call_url(
            &api(),
            "/calendar/v3/users/me/calendarList?minAccessRole=owner",
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner"
        );
    }

    #[test]
    fn a_path_that_leaves_the_calendar_api_or_its_origin_is_refused() {
        for path in [
            "/gmail/v1/users/me/messages",
            "/calendar/v3/../../gmail/v1/users/me/messages",
            "/calendar/v3/%2e%2e/%2e%2e/oauth2/v4/token",
            "//evil.example/calendar/v3/",
            "https://evil.example/calendar/v3/",
            "calendar/v3/calendars",
            "/calendar/v3x/calendars",
        ] {
            assert!(call_url(&api(), path).is_err(), "{path} was allowed");
        }
    }

    #[test]
    fn only_the_apis_methods_are_used() {
        for method in ["GET", "POST", "PUT", "PATCH", "DELETE"] {
            assert!(call_method(method).is_ok(), "{method}");
        }
        for method in ["get", "CONNECT", "TRACE", ""] {
            assert!(call_method(method).is_err(), "{method}");
        }
    }
}
