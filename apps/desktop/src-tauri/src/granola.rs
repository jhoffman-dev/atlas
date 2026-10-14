//! Granola's public API, reached with an API key the host keeps (P28-10).
//!
//! The person pastes a key once; the host keeps it in the Keychain and adds
//! it to each request. The key is never handed to the webview: what comes
//! back is whether a key is kept, whether Granola last refused it, and an API
//! call's answer with the key struck from it.
//!
//! What is decided in TypeScript, as every rule is (ADR-0005): which calls to
//! make, in what order and how fast, what their answers mean, and what each
//! failure tells the person. What the host holds is where the key may go —
//! Granola's origin and its `/v1/` paths, fixed here rather than named by the
//! webview, the way `google.rs` fixes Google's endpoints — and GET, the only
//! method a read-only API has.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use reqwest::Url;
use serde::Serialize;
use tauri::State;

use crate::secrets::{
    ensure_strikable_off_worker, redact_off_worker, vault_scope, SecretState, SecretStore,
};
use crate::vault::{root_for_write, VaultState};

pub use failure::{FailureKind, GranolaFailure};

const ORIGIN: &str = "https://public-api.granola.ai";

/// What the key is called where it is struck from an answer.
const KEY_NAME: &str = "granola-api-key";

/// What the key is checked with when it is set: the smallest call there is.
const CHECK_PATH: &str = "/v1/notes";

/// The status by which Granola says it does not know the key.
const UNAUTHORIZED: u16 = 401;

/// Whether this vault has a key on this Mac, and 401 if the last answer
/// Granola gave was a 401. A 403 is a call the key may not make, not a key
/// Granola does not know: like every other answer, it clears a refusal.
/// Never a key.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GranolaStatus {
    pub has_key: bool,
    pub last_refusal: Option<u16>,
}

/// What the API answered, with the key struck from the body. A 401 is an
/// answer like any other: what it means is TypeScript's to say.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct GranolaAnswer {
    pub status: u16,
    pub body: String,
}

/// The host's Granola state: the vaults whose last answer from Granola was a
/// 401. Each answer that arrives overwrites it, whichever key its request
/// carried, and setting or forgetting the key clears it. It is a hint for
/// the person, not a guard: nothing is refused because of it. Memory only —
/// a refusal is news about a key, and the Keychain holds only the key.
#[derive(Default)]
pub struct GranolaState {
    refused: Mutex<HashSet<String>>,
}

impl GranolaState {
    /// A lock on a set whose every write is one whole insert or remove, so a
    /// thread that panicked holding it cannot have left it half-changed.
    fn refused(&self) -> MutexGuard<'_, HashSet<String>> {
        self.refused
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn last_refusal(&self, scope: &str) -> Option<u16> {
        self.refused().contains(scope).then_some(UNAUTHORIZED)
    }

    /// Takes Granola's answer as the latest word on the key.
    fn heard(&self, scope: &str, status: u16) {
        if status == UNAUTHORIZED {
            self.refused().insert(scope.to_string());
        } else {
            self.clear(scope);
        }
    }

    fn clear(&self, scope: &str) {
        self.refused().remove(scope);
    }
}

/// Granola, for one vault's key.
pub struct Session<'a> {
    pub origin: &'a Url,
    pub store: &'a dyn SecretStore,
    pub scope: &'a str,
    pub state: &'a GranolaState,
}

fn no_key() -> GranolaFailure {
    GranolaFailure::new(
        FailureKind::NoKey,
        "no Granola API key is kept for this vault on this Mac",
    )
}

/// A key kept before `key::save` refused one Atlas could not strike from an
/// answer: sending it and then withholding the answer would already have
/// given it away, so it is not sent.
fn too_long_to_protect() -> GranolaFailure {
    GranolaFailure::new(
        FailureKind::Invalid,
        "the Granola API key kept is too long for Atlas to protect, so nothing was sent — replace it in Settings",
    )
}

impl Session<'_> {
    /// A refusal is news about the key kept: with none kept, there is none
    /// to report, even when an answer to a request sent before the key was
    /// forgotten arrived after it.
    pub fn status(&self) -> Result<GranolaStatus, GranolaFailure> {
        let has_key = key::load(self.store, self.scope)?.is_some();
        Ok(GranolaStatus {
            has_key,
            last_refusal: has_key
                .then(|| self.state.last_refusal(self.scope))
                .flatten(),
        })
    }

    /// Keeps the key, then asks Granola once with it, so that a key Granola
    /// does not know is known at once rather than at the next pull. When
    /// Granola cannot be reached the key is still kept, and no refusal is
    /// reported: nothing has been heard about it yet.
    pub async fn set_key(&self, key: &str) -> Result<GranolaStatus, GranolaFailure> {
        key::save(self.store, self.scope, key).await?;
        self.state.clear(self.scope);
        log::info!("Granola API key stored");
        match self.check(key).await {
            Ok(status) => {
                self.state.heard(self.scope, status);
                log::info!("Granola answered {status} to the new key");
            }
            Err(failure) => log::warn!(
                "the new Granola API key could not be checked: {:?}",
                failure.kind
            ),
        }
        Ok(GranolaStatus {
            has_key: true,
            last_refusal: self.state.last_refusal(self.scope),
        })
    }

    /// Granola's status for the first page of one note, asked with `key`.
    /// The body is not read for anything, and so is never handed on.
    async fn check(&self, key: &str) -> Result<u16, GranolaFailure> {
        let query = BTreeMap::from([("page_size".to_string(), "1".to_string())]);
        let url = api::call_url(self.origin, CHECK_PATH, &query)?;
        let (status, _) = api::get(&url, key).await?;
        Ok(status)
    }

    pub fn forget_key(&self) -> Result<GranolaStatus, GranolaFailure> {
        key::forget(self.store, self.scope)?;
        self.state.clear(self.scope);
        log::info!("Granola API key removed");
        Ok(GranolaStatus {
            has_key: false,
            last_refusal: None,
        })
    }

    /// Sends one GET and hands back its answer. A path off the API is refused
    /// before the key is read, and so before anything is sent.
    pub async fn request(
        &self,
        path: &str,
        query: &BTreeMap<String, String>,
    ) -> Result<GranolaAnswer, GranolaFailure> {
        let url = api::call_url(self.origin, path, query)?;
        let key = key::load(self.store, self.scope)?.ok_or_else(no_key)?;
        ensure_strikable_off_worker(key.clone())
            .await
            .map_err(|_| too_long_to_protect())?;
        let sent = [(KEY_NAME.to_string(), key)];
        let (status, body) = match api::get(&url, &sent[0].1).await {
            Ok(answer) => answer,
            Err(failure) => return Err(failure.struck_of(sent.into()).await),
        };
        self.state.heard(self.scope, status);
        log::debug!("Granola answered {status}");
        let text = String::from_utf8(body).map_err(|_| {
            GranolaFailure::new(FailureKind::Malformed, "Granola did not answer with text")
        })?;
        Ok(GranolaAnswer {
            status,
            body: redact_off_worker(text, sent.into()).await,
        })
    }
}

fn pinned_origin() -> Url {
    Url::parse(ORIGIN).expect("Granola's fixed origin parses")
}

/// The vault a command names, checked to be the open one, as its Keychain
/// scope: a call that lands after a switch is refused, never sent with the
/// other vault's key.
fn scope_of(state: &VaultState, vault: &str) -> Result<String, GranolaFailure> {
    let root = root_for_write(state.root(), Some(vault))
        .map_err(|message| GranolaFailure::new(FailureKind::Invalid, message))?;
    Ok(vault_scope(&root))
}

// The commands are async so that the Keychain, which can block on a prompt,
// is never asked from the main thread.

#[tauri::command]
pub async fn granola_status(
    vaults: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    granola: State<'_, GranolaState>,
    vault: String,
) -> Result<GranolaStatus, GranolaFailure> {
    let scope = scope_of(&vaults, &vault)?;
    let origin = pinned_origin();
    Session {
        origin: &origin,
        store: secrets.store(),
        scope: &scope,
        state: &granola,
    }
    .status()
}

/// Keeps the key the person pasted, replacing any kept before, and answers
/// whether Granola refused it when asked once with it.
#[tauri::command]
pub async fn granola_set_key(
    vaults: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    granola: State<'_, GranolaState>,
    vault: String,
    key: String,
) -> Result<GranolaStatus, GranolaFailure> {
    let scope = scope_of(&vaults, &vault)?;
    let origin = pinned_origin();
    Session {
        origin: &origin,
        store: secrets.store(),
        scope: &scope,
        state: &granola,
    }
    .set_key(&key)
    .await
}

#[tauri::command]
pub async fn granola_forget_key(
    vaults: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    granola: State<'_, GranolaState>,
    vault: String,
) -> Result<GranolaStatus, GranolaFailure> {
    let scope = scope_of(&vaults, &vault)?;
    let origin = pinned_origin();
    Session {
        origin: &origin,
        store: secrets.store(),
        scope: &scope,
        state: &granola,
    }
    .forget_key()
}

/// One GET, as TypeScript builds it: a path under `/v1/` and its query, each
/// value a string. The host adds the key.
#[tauri::command]
pub async fn granola_request(
    vaults: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    granola: State<'_, GranolaState>,
    vault: String,
    path: String,
    query: BTreeMap<String, String>,
) -> Result<GranolaAnswer, GranolaFailure> {
    let scope = scope_of(&vaults, &vault)?;
    let origin = pinned_origin();
    Session {
        origin: &origin,
        store: secrets.store(),
        scope: &scope,
        state: &granola,
    }
    .request(&path, &query)
    .await
}

mod api;
mod failure;
#[cfg(test)]
mod fake_granola;
mod key;
#[cfg(test)]
mod tests;
