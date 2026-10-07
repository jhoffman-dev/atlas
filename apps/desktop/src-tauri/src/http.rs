//! Fetching text from outside the vault.
//!
//! This module fetches bytes over http and hands back text. It does not know
//! what a feed is, which format it is in, or what should be written because of
//! it — that is decided in TypeScript, like every other rule (ADR-0005).
//!
//! A request may name secrets. They are filled in here, from the Keychain, as
//! the request leaves, and every value that went out is struck from whatever
//! comes back — the body and any error alike — so none reaches the webview.

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::{redirect, Client, Response, Url};
use serde::Deserialize;
use tauri::State;

use crate::secrets::{
    check_bound, describe, fill, redact, vault_scope, SecretState, SecretStore, TemplatePart,
};
use crate::vault::{root_for_write, VaultState};

/// A feed is text. Anything this large is a mistake or an attack, and holding it
/// in memory would take the app down with it.
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// Long enough for a calendar server having a slow morning, short enough that a
/// host that never answers does not leave a refresh hanging for good.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Redirects are followed, but not forever, and never off the scheme asked for.
const MAX_REDIRECTS: usize = 5;

/// Plain and honest. Nothing about the vault or the machine goes out with it.
const USER_AGENT: &str = concat!("Atlas/", env!("CARGO_PKG_VERSION"));

const TOO_LARGE: &str = "the feed is larger than Atlas will read";

/// The schemes a source may be fetched over.
///
/// `file:` and `data:` are deliberately absent. Reading a file goes through the
/// vault's own scoped access, which checks that the file is inside the vault;
/// letting a URL reach the filesystem here would step around that check
/// entirely, and a source note is ordinary text that anything could have written.
///
/// `shown` is the URL as written, secrets as references: a refusal names that,
/// never the filled URL, which may hold a secret in a form `redact` would miss.
fn checked_url(raw: &str, shown: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|error| format!("{shown} is not a URL: {error}"))?;

    match url.scheme() {
        "http" | "https" => Ok(url),
        scheme => Err(format!(
            "a source can only be fetched over http or https, not {scheme}:"
        )),
    }
}

/// A request as TypeScript sends it: every value split into text and the
/// names of secrets. It holds no secret's value.
#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    pub url: Vec<TemplatePart>,
    #[serde(default)]
    pub headers: Vec<RequestHeader>,
}

#[derive(Debug, Deserialize)]
pub struct RequestHeader {
    pub name: String,
    pub value: Vec<TemplatePart>,
}

/// A request ready to send: secrets filled in, and remembered so that they can
/// be struck from what comes back.
pub(crate) struct Prepared {
    pub(crate) url: Url,
    pub(crate) headers: HeaderMap,
    /// Each secret that went out, by name.
    pub(crate) used: Vec<(String, String)>,
    /// The URL as written, secrets as references — what may be logged.
    shown: String,
}

fn client(scheme: &str, pinned: Option<Url>) -> Result<Client, String> {
    let scheme = scheme.to_owned();

    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(redirect::Policy::custom(move |attempt| {
            // A redirect that changes scheme is refused rather than followed: an
            // https feed that answers with an http location is a downgrade, and
            // any other scheme is not something this command may fetch at all.
            // A request carrying a secret stays on its origin — scheme, host
            // and port — as well: reqwest drops `Authorization` on the way to
            // another host, but not a secret in a header of any other name, and
            // not on the way to another port of the same host, which may be
            // another program altogether.
            let moved = pinned
                .as_ref()
                .is_some_and(|first| attempt.url().origin() != first.origin());
            if attempt.url().scheme() != scheme
                || moved
                || attempt.previous().len() >= MAX_REDIRECTS
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|error| format!("cannot prepare the request: {error}"))
}

/// Fills in a request's secrets and checks it can go. Every error it returns
/// has already had those secrets struck out.
pub(crate) fn prepare(
    store: &dyn SecretStore,
    scope: Option<&str>,
    request: &HttpRequest,
) -> Result<Prepared, String> {
    let mut used = Vec::new();
    let mut filled = |parts: &[TemplatePart]| -> Result<String, String> {
        let needs_vault = parts
            .iter()
            .any(|part| matches!(part, TemplatePart::Secret { .. }));
        let scope = match scope {
            Some(scope) => scope,
            None if needs_vault => return Err("no vault is open to read its secrets".into()),
            None => "",
        };
        let value = fill(store, scope, parts)?;
        used.extend(value.used);
        Ok(value.text)
    };

    let url_text = filled(&request.url)?;
    let mut headers = HeaderMap::new();
    for header in &request.headers {
        let name = HeaderName::from_bytes(header.name.as_bytes())
            .map_err(|_| format!("{:?} is not a header name", header.name))?;
        let secret = header
            .value
            .iter()
            .any(|part| matches!(part, TemplatePart::Secret { .. }));
        let mut value = HeaderValue::from_str(&filled(&header.value)?)
            .map_err(|_| format!("the {name} header holds a character no header may carry"))?;
        // Kept out of reqwest's own Debug output, should anything print it.
        value.set_sensitive(secret);
        headers.append(name, value);
    }

    let shown = describe(&request.url);
    let url = checked_url(&url_text, &shown).map_err(|error| redact(&error, &used))?;
    if let (false, Some(scope)) = (used.is_empty(), scope) {
        // A secret sent in the clear is a secret given to every network on the way.
        if url.scheme() != "https" {
            return Err("a secret is only ever sent over https".into());
        }
        // The origin may itself hold a secret, if the host was written as one.
        let origin = url.origin().ascii_serialization();
        check_bound(store, scope, &used, &origin).map_err(|error| redact(&error, &used))?;
    }
    Ok(Prepared {
        url,
        headers,
        used,
        shown,
    })
}

/// Adds what has just arrived to what has been read, refusing to grow past the
/// cap. Checked chunk by chunk because a server is free to lie about, or simply
/// not declare, how much it is about to send.
fn take_chunk(body: &mut Vec<u8>, chunk: &[u8]) -> Result<(), String> {
    if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
        return Err(TOO_LARGE.to_string());
    }
    body.extend_from_slice(chunk);
    Ok(())
}

pub(crate) async fn read_capped(mut response: Response) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(TOO_LARGE.to_string());
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("the feed stopped sending: {}", error.without_url()))?
    {
        take_chunk(&mut body, &chunk)?;
    }
    Ok(body)
}

async fn fetch(prepared: &Prepared) -> Result<String, String> {
    let pinned = (!prepared.used.is_empty()).then(|| prepared.url.clone());
    let response = client(prepared.url.scheme(), pinned)?
        .get(prepared.url.clone())
        .headers(prepared.headers.clone())
        .send()
        .await
        // Without the URL, which may hold a secret; the feed is named by the
        // caller, as written.
        .map_err(|error| format!("cannot reach the feed: {}", error.without_url()))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("the feed answered {status}"));
    }

    let body = read_capped(response).await?;
    let read = body.len();
    let text =
        String::from_utf8(body).map_err(|_| "the feed did not answer with text".to_string())?;
    log::info!("fetched {read} bytes from {}", prepared.shown);
    Ok(text)
}

#[tauri::command]
pub async fn http_get(
    state: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    vault: String,
    request: HttpRequest,
) -> Result<String, String> {
    // The secrets are the vault's the refresh ran in: one that finishes after
    // another vault was opened is refused, never filled from the other's.
    let root = root_for_write(state.root(), Some(&vault))?;
    let scope = vault_scope(&root);
    let prepared = prepare(secrets.store(), Some(&scope), &request)?;
    send(&prepared).await
}

/// Fetches, and strikes every secret that went out from what comes back —
/// the text and any error alike — before it can reach the webview.
async fn send(prepared: &Prepared) -> Result<String, String> {
    fetch(prepared)
        .await
        .map(|text| redact(&text, &prepared.used))
        .map_err(|error| redact(&error, &prepared.used))
}

#[cfg(test)]
mod secret_tests;

#[cfg(test)]
mod tests {
    use super::{checked_url, take_chunk, MAX_RESPONSE_BYTES, TOO_LARGE};

    #[test]
    fn accepts_http_and_https() {
        assert!(checked_url("https://example.test/feed.ics", "the url").is_ok());
        assert!(checked_url("http://example.test/feed.ics", "the url").is_ok());
    }

    #[test]
    fn ignores_the_whitespace_around_a_pasted_url() {
        assert!(checked_url("  https://example.test/feed.ics\n", "the url").is_ok());
    }

    #[test]
    fn refuses_a_file_url() {
        assert_eq!(
            checked_url("file:///etc/passwd", "the url").unwrap_err(),
            "a source can only be fetched over http or https, not file:"
        );
    }

    #[test]
    fn refuses_a_data_url() {
        assert!(checked_url("data:text/csv,id%2Cname", "the url").is_err());
    }

    #[test]
    fn refuses_anything_else_that_parses_as_a_url() {
        assert!(checked_url("javascript:alert(1)", "the url").is_err());
        assert!(checked_url("ftp://example.test/feed.csv", "the url").is_err());
        assert!(checked_url("tauri://localhost/feed.csv", "the url").is_err());
    }

    #[test]
    fn refuses_something_that_is_not_a_url_at_all() {
        assert!(checked_url("example.test/feed.ics", "the url").is_err());
        assert!(checked_url("", "the url").is_err());
    }

    #[test]
    fn collects_chunks_that_stay_under_the_cap() {
        let mut body = Vec::new();
        take_chunk(&mut body, b"id,name\n").unwrap();
        take_chunk(&mut body, b"1,Ada\n").unwrap();
        assert_eq!(body, b"id,name\n1,Ada\n");
    }

    #[test]
    fn refuses_the_chunk_that_would_cross_the_cap() {
        let mut body = vec![0; MAX_RESPONSE_BYTES - 1];
        assert_eq!(take_chunk(&mut body, b"xx").unwrap_err(), TOO_LARGE);
        // Nothing past the cap is kept, so a runaway feed cannot grow memory by
        // one chunk more than it was allowed.
        assert_eq!(body.len(), MAX_RESPONSE_BYTES - 1);
    }

    #[test]
    fn accepts_a_chunk_that_exactly_fills_the_cap() {
        let mut body = vec![0; MAX_RESPONSE_BYTES - 2];
        assert!(take_chunk(&mut body, b"xx").is_ok());
        assert_eq!(body.len(), MAX_RESPONSE_BYTES);
    }
}
