//! One notebook page, fetched with the session's cookies and handed back raw.
//!
//! It follows a redirect only to another notebook page; any other redirect —
//! Amazon's sign-in, above all — comes back as where it pointed, origin and
//! path only (a sign-in URL's query carries where to return and more), with
//! nothing sent there. What any answer means is TypeScript's to read.

use std::time::Duration;

use reqwest::header::{ACCEPT, COOKIE, LOCATION};
use reqwest::{redirect, Client, Response, Url};
use serde::Serialize;

use super::cookies::{cookie_header, strike, SessionCookie};
use super::failure::{FailureKind, KindleFailure};
use super::notebook_url::is_notebook_page;
use crate::http::{self, ReadFailure};

/// A Mac that sleeps mid-sync, or an Amazon that never answers, ends the
/// request rather than holding it open; the next sync tries again.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// A notebook page of a few hundred highlights is well under a megabyte.
/// Anything this large is a mistake, and holding it would take the app down.
pub const MAX_PAGE_BYTES: usize = 8 * 1024 * 1024;

/// Notebook-to-notebook hops, such as `/notebook` to `/kp/notebook`. More is a loop.
const MAX_HOPS: usize = 5;

/// Amazon serves the notebook to a browser; this says which one, honestly.
const USER_AGENT: &str = concat!(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) DFAI/",
    env!("CARGO_PKG_VERSION")
);

/// A page as the webview reads it: its status, its HTML (cookie values
/// struck), and where a redirect off the notebook pointed.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindlePage {
    pub status: u16,
    pub html: String,
    pub redirected_to: Option<String>,
}

fn client(timeout: Duration) -> Result<Client, KindleFailure> {
    Client::builder()
        .timeout(timeout)
        .user_agent(USER_AGENT)
        // Followed here, one hop at a time, so that each is checked.
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|error| {
            KindleFailure::new(
                FailureKind::Unreachable,
                format!("cannot prepare the request: {error}"),
            )
        })
}

/// Without the URL, as everywhere a request may go wrong (ADR-0017): a
/// book page's URL is harmless, but the rule is kept the same everywhere.
fn failed(error: reqwest::Error) -> KindleFailure {
    let kind = if error.is_timeout() {
        FailureKind::Timeout
    } else {
        FailureKind::Unreachable
    };
    KindleFailure::new(
        kind,
        format!("cannot reach Amazon: {}", error.without_url()),
    )
}

/// Where a redirect points, as an origin and a path: never its query.
fn shown_target(target: &Url) -> String {
    format!("{}{}", target.origin().ascii_serialization(), target.path())
}

/// A redirect's next stop: Some(notebook page) to follow, or Err(shown target) to hand back.
fn next_stop(origin: &Url, from: &Url, response: &Response) -> Result<Url, String> {
    let location = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(String::new)?;
    let target = from.join(location).map_err(|_| String::new())?;
    if is_notebook_page(origin, &target) {
        Ok(target)
    } else {
        Err(shown_target(&target))
    }
}

async fn read_page(response: Response, cookies: &[SessionCookie]) -> Result<String, KindleFailure> {
    let bytes =
        http::read_capped(response, MAX_PAGE_BYTES)
            .await
            .map_err(|failure| match failure {
                ReadFailure::TooLarge => KindleFailure::new(
                    FailureKind::TooLarge,
                    "Amazon's page is larger than DFAI will read",
                ),
                ReadFailure::Stopped(error) => failed(error),
            })?;
    Ok(strike(
        String::from_utf8_lossy(&bytes).into_owned(),
        cookies,
    ))
}

/// What a fetch is given: the notebook's origin, the page and the session.
pub struct Fetch<'a> {
    pub origin: &'a Url,
    pub url: Url,
    pub cookies: &'a [SessionCookie],
    pub timeout: Duration,
}

/// GETs the page with the session's cookies, following notebook-to-notebook
/// redirects only.
pub async fn fetch_page(fetch: Fetch<'_>) -> Result<KindlePage, KindleFailure> {
    let client = client(fetch.timeout)?;
    let mut url = fetch.url;
    for _ in 0..=MAX_HOPS {
        let mut request = client.get(url.clone()).header(ACCEPT, "text/html");
        if let Some(header) = cookie_header(fetch.cookies, &url) {
            request = request.header(COOKIE, header);
        }
        let response = request.send().await.map_err(failed)?;
        let status = response.status().as_u16();
        if !response.status().is_redirection() {
            let html = read_page(response, fetch.cookies).await?;
            return Ok(KindlePage {
                status,
                html,
                redirected_to: None,
            });
        }
        match next_stop(fetch.origin, &url, &response) {
            Ok(next) => url = next,
            Err(shown) => {
                return Ok(KindlePage {
                    status,
                    html: String::new(),
                    redirected_to: (!shown.is_empty()).then_some(shown),
                })
            }
        }
    }
    Err(KindleFailure::new(
        FailureKind::Unreachable,
        "Amazon's notebook redirects in a loop",
    ))
}
