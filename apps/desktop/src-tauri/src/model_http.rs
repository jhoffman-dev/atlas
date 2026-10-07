//! The chat's fallback provider: a model's API, called with a key the person
//! keeps as a secret (ADR-0021).
//!
//! This sends one POST and hands back the status and body. It decides nothing
//! about what is sent or what the answer means — that is TypeScript's, as
//! every rule is (ADR-0005). What it does hold is the secrets' rules, which it
//! shares with `http.rs`: a secret is filled in here, goes over https only, to
//! a site it is bound to, and is struck from everything that comes back.
//!
//! It also refuses a request that names no secret. The webview is the
//! untrusted side (ADR-0017), and a POST it could aim anywhere would be a way
//! for a script in it to send the vault's text to any site; a request that
//! must carry a bound secret can only go where the person said that secret
//! may go. Even that is too wide — a person binds a secret for GET fetches,
//! not for POSTs — so the host pins the POST to the Messages API and the
//! `anthropic` key (ADR-0021).

use std::time::Duration;

use reqwest::{redirect, Client};
use serde::Serialize;
use tauri::State;

use crate::http::{prepare, read_capped, HttpRequest, Prepared};
use crate::secrets::{redact, vault_scope, SecretState, SecretStore};
use crate::vault::{root_for_write, VaultState};

/// A model can take minutes to answer a long question.
const MODEL_TIMEOUT: Duration = Duration::from_secs(300);

const USER_AGENT: &str = concat!("Atlas/", env!("CARGO_PKG_VERSION"));

/// What came back, with every secret that went out struck from the body.
#[derive(Debug, Serialize, PartialEq)]
pub struct ModelAnswer {
    pub status: u16,
    pub body: String,
}

/// The one place this POST may go. A secret's binding is the person's to
/// widen, so it cannot be what limits a POST whose body the webview writes.
const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
/// The one secret it may carry: the key for that API.
const SECRET: &str = "anthropic";

/// Fills in the request's secrets and checks it may go: to `ENDPOINT` only,
/// carrying the `SECRET` key and no other secret.
fn prepare_model_request(
    store: &dyn SecretStore,
    scope: &str,
    request: &HttpRequest,
) -> Result<Prepared, String> {
    let prepared = prepare(store, Some(scope), request)?;
    if prepared.used.is_empty() {
        return Err("a model's API is only ever called with its key, named as a secret".into());
    }
    if prepared.used.iter().any(|(name, _)| name != SECRET) {
        return Err(format!(
            "a model's API is only ever called with the {SECRET} secret"
        ));
    }
    if prepared.url.as_str() != ENDPOINT {
        return Err(format!("a model's API is only ever called at {ENDPOINT}"));
    }
    Ok(prepared)
}

/// The answer as the webview may see it: its status, and its body as text
/// with every secret that went out struck from it.
fn answer_of(status: u16, body: Vec<u8>, used: &[(String, String)]) -> Result<ModelAnswer, String> {
    let text = String::from_utf8(body)
        .map_err(|_| "the model's API did not answer with text".to_string())?;
    Ok(ModelAnswer {
        status,
        body: redact(&text, used),
    })
}

async fn post(prepared: &Prepared, body: String) -> Result<ModelAnswer, String> {
    // No redirect is followed: an API that moves has nothing to say to a
    // request carrying a key, and following it could carry the key elsewhere.
    let client = Client::builder()
        .timeout(MODEL_TIMEOUT)
        .user_agent(USER_AGENT)
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|error| format!("cannot prepare the request: {error}"))?;
    let response = client
        .post(prepared.url.clone())
        .headers(prepared.headers.clone())
        .body(body)
        .send()
        .await
        .map_err(|error| format!("cannot reach the model's API: {}", error.without_url()))?;
    let status = response.status().as_u16();
    let bytes = read_capped(response).await?;
    log::info!("model API answered {status}");
    answer_of(status, bytes, &prepared.used)
}

#[tauri::command]
pub async fn model_http_post(
    state: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    vault: String,
    request: HttpRequest,
    body: String,
) -> Result<ModelAnswer, String> {
    // The key is the vault's the chat is in: a request that lands after a
    // switch is refused, never filled from the other vault's secrets.
    let root = root_for_write(state.root(), Some(&vault))?;
    let scope = vault_scope(&root);
    let prepared = prepare_model_request(secrets.store(), &scope, &request)?;
    post(&prepared, body)
        .await
        .map_err(|error| redact(&error, &prepared.used))
}

#[cfg(test)]
mod tests {
    use super::{answer_of, prepare_model_request, ModelAnswer};
    use crate::http::{HttpRequest, RequestHeader};
    use crate::secrets::{write_secret, MemoryStore, SecretWrite, TemplatePart};

    const KEY: &str = "sk-ant-S3CRET";

    fn store() -> MemoryStore {
        let store = MemoryStore::default();
        let origins = vec!["https://api.anthropic.com".to_string()];
        let write = SecretWrite {
            scope: "v1",
            name: "anthropic",
            value: Some(KEY),
            origins: Some(&origins),
        };
        write_secret(&store, &write, &|_: &str, _: &[String]| true).unwrap();
        store
    }

    fn request(url: &str, header: Vec<TemplatePart>) -> HttpRequest {
        HttpRequest {
            url: vec![TemplatePart::Text { text: url.into() }],
            headers: vec![RequestHeader {
                name: "x-api-key".into(),
                value: header,
            }],
        }
    }

    fn key() -> Vec<TemplatePart> {
        vec![TemplatePart::Secret {
            secret: "anthropic".into(),
        }]
    }

    /// A store whose `anthropic` key the person also bound to another site.
    fn store_bound_to(origins: &[&str]) -> MemoryStore {
        let store = MemoryStore::default();
        let origins: Vec<String> = origins.iter().map(|origin| origin.to_string()).collect();
        let write = SecretWrite {
            scope: "v1",
            name: "anthropic",
            value: Some(KEY),
            origins: Some(&origins),
        };
        write_secret(&store, &write, &|_: &str, _: &[String]| true).unwrap();
        store
    }

    fn refusal(request: &HttpRequest) -> String {
        match prepare_model_request(&store(), "v1", request) {
            Ok(_) => panic!("the request was expected to be refused"),
            Err(error) => error,
        }
    }

    #[test]
    fn the_key_is_filled_in_for_the_site_it_is_bound_to() {
        let prepared = prepare_model_request(
            &store(),
            "v1",
            &request("https://api.anthropic.com/v1/messages", key()),
        )
        .unwrap();
        assert_eq!(prepared.headers["x-api-key"], KEY);
    }

    #[test]
    fn a_request_naming_no_secret_is_refused_so_it_cannot_post_anywhere() {
        let plain = vec![TemplatePart::Text {
            text: "nothing".into(),
        }];
        let error = refusal(&request("https://evil.example/collect", plain));
        assert!(error.contains("only ever called with its key"), "{error}");
    }

    #[test]
    fn the_key_is_refused_for_any_other_site_or_over_http() {
        let elsewhere = refusal(&request("https://evil.example/v1/messages", key()));
        assert!(!elsewhere.contains(KEY));
        let plain = refusal(&request("http://api.anthropic.com/v1/messages", key()));
        assert!(plain.contains("https"), "{plain}");
    }

    #[test]
    fn the_answer_has_the_key_struck_from_it() {
        let used = vec![("anthropic".to_string(), KEY.to_string())];
        let echoed = format!("{{\"error\":\"bad key {KEY}\"}}");
        let answer = answer_of(401, echoed.into_bytes(), &used).unwrap();
        assert_eq!(answer.status, 401);
        assert!(!answer.body.contains(KEY), "{}", answer.body);
    }

    #[test]
    fn an_answer_that_is_not_text_is_refused() {
        assert_eq!(
            answer_of(200, vec![0xff, 0xfe], &[]),
            Err::<ModelAnswer, String>("the model's API did not answer with text".into())
        );
    }

    // Adversarial (P27): the POST is meant for a model's API. Any other secret
    // the person bound for GET fetches (a GitHub token for a source) must not
    // turn this command into a POST, with a body the webview writes, to that
    // secret's site — e.g. a gist holding the vault's text.
    #[test]
    fn a_secret_bound_to_another_site_cannot_carry_a_model_post() {
        let store = store();
        let origins = vec!["https://api.github.com".to_string()];
        let write = SecretWrite {
            scope: "v1",
            name: "github",
            value: Some("ghp_T0KEN"),
            origins: Some(&origins),
        };
        write_secret(&store, &write, &|_: &str, _: &[String]| true).unwrap();
        let github = vec![TemplatePart::Secret {
            secret: "github".into(),
        }];
        let prepared = prepare_model_request(
            &store,
            "v1",
            &request("https://api.github.com/gists", github),
        );
        assert!(
            prepared.is_err(),
            "a POST to api.github.com carrying the github token was prepared"
        );
    }

    #[test]
    fn the_post_goes_only_to_the_messages_endpoint_even_where_the_key_is_bound() {
        // The binding is the person's to widen; the POST's one destination is
        // the host's rule, so a key also bound to another site cannot carry
        // the webview's body there, nor to another path of the same API.
        let store = store_bound_to(&["https://api.anthropic.com", "https://evil.example"]);
        for url in [
            "https://evil.example/v1/messages",
            "https://api.anthropic.com/v1/files",
            "https://api.anthropic.com/v1/messages?beta=true",
        ] {
            let prepared = prepare_model_request(&store, "v1", &request(url, key()));
            assert!(prepared.is_err(), "a POST to {url} was prepared");
        }
    }

    #[test]
    fn no_secret_but_the_anthropic_key_can_carry_the_post() {
        let store = store();
        let origins = vec!["https://api.anthropic.com".to_string()];
        let write = SecretWrite {
            scope: "v1",
            name: "other",
            value: Some("0THER"),
            origins: Some(&origins),
        };
        write_secret(&store, &write, &|_: &str, _: &[String]| true).unwrap();
        let other = vec![TemplatePart::Secret {
            secret: "other".into(),
        }];
        let prepared = prepare_model_request(
            &store,
            "v1",
            &request("https://api.anthropic.com/v1/messages", other),
        );
        assert!(
            prepared.is_err(),
            "a POST carrying another secret was prepared"
        );
    }
}
