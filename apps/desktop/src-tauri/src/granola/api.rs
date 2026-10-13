//! One GET to Granola's public API, carrying the key.
//!
//! The webview says which call — a path under `/v1/` and its query, as
//! TypeScript builds them — and the host adds the key and sends it to the one
//! origin it may go to. Which calls to make and what their answers mean are
//! TypeScript's (ADR-0005); where the key may go is the host's, because the
//! webview is the untrusted side (ADR-0017). The API is read-only, so GET is
//! the only method there is.

use std::collections::BTreeMap;
use std::time::Duration;

use reqwest::header::{ACCEPT, AUTHORIZATION};
use reqwest::{redirect, Client, Response, Url};

use super::failure::{FailureKind, GranolaFailure};
use crate::http::{self, ReadFailure};

/// The only paths a call may reach: version 1 of the API.
const API_PATH: &str = "/v1/";

/// A Mac that sleeps mid-pull, or a Granola that never answers, ends the
/// request rather than holding it open; the pull tries again next time.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// A note with a long transcript is large, but not this large. Anything
/// bigger is a mistake or an attack, and holding it would take the app down.
pub const MAX_ANSWER_BYTES: usize = 16 * 1024 * 1024;

const USER_AGENT: &str = concat!("Atlas/", env!("CARGO_PKG_VERSION"));

fn invalid(message: String) -> GranolaFailure {
    GranolaFailure::new(FailureKind::Invalid, message)
}

/// A path segment as Granola's API spells them: `notes`, `not_1d3tmYTlCICgjy`,
/// `transcript`. Nothing that a URL parser reads as a dot segment, a
/// separator, an escape, a query or a fragment.
fn plain_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

/// The call's URL, if it stays under `/v1/` at `origin`. A path made of plain
/// segments cannot leave either, and the URL is checked again once parsed so
/// that it is the parser's reading, not this one's, that is held to it.
pub fn call_url(
    origin: &Url,
    path: &str,
    query: &BTreeMap<String, String>,
) -> Result<Url, GranolaFailure> {
    let refused = || invalid(format!("{path:?} is not a Granola API path"));
    let rest = path.strip_prefix(API_PATH).ok_or_else(refused)?;
    if !rest.split('/').all(plain_segment) {
        return Err(refused());
    }
    let mut url = origin.join(path).map_err(|_| refused())?;
    if url.origin() != origin.origin() || !url.path().starts_with(API_PATH) {
        return Err(refused());
    }
    if !query.is_empty() {
        let mut pairs = url.query_pairs_mut();
        for (name, value) in query {
            pairs.append_pair(name, value);
        }
    }
    Ok(url)
}

fn client() -> Result<Client, GranolaFailure> {
    // No redirect is followed: an API that moves has nothing to say to a
    // request carrying a key, and following it could carry the key elsewhere.
    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|error| {
            GranolaFailure::new(
                FailureKind::Unreachable,
                format!("cannot prepare the request: {error}"),
            )
        })
}

/// Without the URL, as everywhere a request may go wrong (ADR-0017).
fn failed(error: reqwest::Error) -> GranolaFailure {
    let kind = if error.is_timeout() {
        FailureKind::Timeout
    } else {
        FailureKind::Unreachable
    };
    GranolaFailure::new(
        kind,
        format!("cannot reach Granola: {}", error.without_url()),
    )
}

fn too_large() -> GranolaFailure {
    GranolaFailure::new(
        FailureKind::TooLarge,
        "Granola's answer is larger than Atlas will read",
    )
}

async fn read_capped(response: Response) -> Result<Vec<u8>, GranolaFailure> {
    http::read_capped(response, MAX_ANSWER_BYTES)
        .await
        .map_err(|failure| match failure {
            ReadFailure::TooLarge => too_large(),
            ReadFailure::Stopped(error) => failed(error),
        })
}

/// Sends the GET with `key`. The answer's body is raw; the caller strikes the
/// key from it.
pub async fn get(url: &Url, key: &str) -> Result<(u16, Vec<u8>), GranolaFailure> {
    let response = client()?
        .get(url.clone())
        .header(AUTHORIZATION, format!("Bearer {key}"))
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(failed)?;
    let status = response.status().as_u16();
    Ok((status, read_capped(response).await?))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use reqwest::Url;

    use super::call_url;
    use crate::granola::failure::FailureKind;

    fn origin() -> Url {
        Url::parse("https://public-api.granola.ai").unwrap()
    }

    fn no_query() -> BTreeMap<String, String> {
        BTreeMap::new()
    }

    #[test]
    fn a_v1_path_is_sent_to_the_pinned_origin() {
        for (path, expected) in [
            ("/v1/notes", "https://public-api.granola.ai/v1/notes"),
            (
                "/v1/notes/not_1d3tmYTlCICgjy/transcript",
                "https://public-api.granola.ai/v1/notes/not_1d3tmYTlCICgjy/transcript",
            ),
        ] {
            assert_eq!(
                call_url(&origin(), path, &no_query()).unwrap().as_str(),
                expected
            );
        }
    }

    #[test]
    fn the_query_is_encoded_so_a_value_cannot_add_a_parameter() {
        let query = BTreeMap::from([
            (
                "updated_after".to_string(),
                "2026-10-01T00:00:00Z".to_string(),
            ),
            ("cursor".to_string(), "abc&page_size=999#x".to_string()),
        ]);
        let url = call_url(&origin(), "/v1/notes", &query).unwrap();
        let pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        assert_eq!(
            pairs,
            vec![
                ("cursor".to_string(), "abc&page_size=999#x".to_string()),
                (
                    "updated_after".to_string(),
                    "2026-10-01T00:00:00Z".to_string()
                ),
            ]
        );
        assert_eq!(url.fragment(), None);
    }

    #[test]
    fn a_path_that_leaves_v1_or_the_origin_is_refused() {
        for path in [
            "/v1/../v2/notes",
            "/v1/notes/../../admin",
            "/v1/%2e%2e/%2e%2e/admin",
            "/v1/%2E%2E/admin",
            "/v1/.%2e/admin",
            "/v1/./notes",
            "//evil.example/v1/notes",
            "https://evil.example/v1/notes",
            "https://public-api.granola.ai/v1/notes",
            "/v1/notes%2f..%2fadmin",
            "/v1/notes\\..\\admin",
            "/v1//evil.example/notes",
            "/v1/notes?page_size=30",
            "/v1/notes#top",
            "/v1/notes/",
            "/v1/",
            "/v1",
            "v1/notes",
            "/v2/notes",
            "/v1x/notes",
            "/v1/note s",
            "",
        ] {
            let failure = call_url(&origin(), path, &no_query()).unwrap_err();
            assert_eq!(failure.kind, FailureKind::Invalid, "{path}");
        }
    }
}
