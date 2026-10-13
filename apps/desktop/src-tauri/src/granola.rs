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

use std::collections::hash_map::RandomState;
use std::collections::{BTreeMap, HashMap};
use std::hash::BuildHasher;
use std::sync::{Mutex, MutexGuard};

use reqwest::Url;
use serde::Serialize;
use tauri::State;

use crate::secrets::{redact, vault_scope, SecretState, SecretStore};
use crate::vault::{root_for_write, VaultState};

pub use failure::{FailureKind, GranolaFailure};

const ORIGIN: &str = "https://public-api.granola.ai";

/// What the key is called where it is struck from an answer.
const KEY_NAME: &str = "granola-api-key";

/// Whether this vault has a key on this Mac, and the status Granola last
/// refused it with (401 or 403), if it has since a key was set. Never a key.
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

/// Which key a vault's standing is about, by its fingerprint.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum Kept {
    /// No key was set or forgotten in this run: the key kept from an earlier
    /// one, if any, is the one the next answer was sent with.
    #[default]
    Unknown,
    Nothing,
    Key(u64),
}

/// How a vault's key stands in this run of the app.
#[derive(Debug, Default, Clone, Copy)]
struct Standing {
    /// The key Granola's word is taken on. An answer is about the key its
    /// request carried, so one sent with any other key says nothing of this.
    kept: Kept,
    refused: Option<u16>,
}

/// The host's Granola state: whether each vault's key was refused. Memory
/// only — a refusal is news about a key, and the Keychain holds only the key.
#[derive(Default)]
pub struct GranolaState {
    standings: Mutex<HashMap<String, Standing>>,
    /// Held while a key is set or forgotten, so that the Keychain and the
    /// standing change together, one change at a time. Requests never take it.
    changing: Mutex<()>,
    /// Keyed afresh in each run, so a fingerprint means nothing outside it.
    fingerprints: RandomState,
}

impl GranolaState {
    /// A lock on state whose every write is one whole value, so a thread that
    /// panicked holding it cannot have left it half-changed (as `GoogleState`).
    fn standings(&self) -> MutexGuard<'_, HashMap<String, Standing>> {
        self.standings
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Guards nothing but its own holding, so a panic under it is no harm.
    fn changing(&self) -> MutexGuard<'_, ()> {
        self.changing
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn standing(&self, scope: &str) -> Standing {
        self.standings().get(scope).copied().unwrap_or_default()
    }

    fn fingerprint(&self, key: &str) -> Kept {
        Kept::Key(self.fingerprints.hash_one(key))
    }

    /// Notes which key is now kept, with no refusal: what Granola said of the
    /// one before says nothing of this one.
    fn now_keeping(&self, scope: &str, kept: Kept) {
        self.standings().insert(
            scope.to_string(),
            Standing {
                kept,
                refused: None,
            },
        );
    }

    /// Takes Granola's answer to a request sent with `sent` as the word on the
    /// key, if that is the key kept: 401 and 403 refuse it, a success clears
    /// that.
    fn heard(&self, scope: &str, sent: &str, status: u16) {
        let sent = self.fingerprint(sent);
        let mut standings = self.standings();
        let standing = standings.entry(scope.to_string()).or_default();
        if standing.kept == Kept::Unknown {
            standing.kept = sent;
        }
        if standing.kept != sent {
            return;
        }
        match status {
            401 | 403 => standing.refused = Some(status),
            200..=299 => standing.refused = None,
            _ => {}
        }
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

impl Session<'_> {
    pub fn status(&self) -> Result<GranolaStatus, GranolaFailure> {
        let has_key = key::load(self.store, self.scope)?.is_some();
        Ok(GranolaStatus {
            has_key,
            last_refusal: self.state.standing(self.scope).refused,
        })
    }

    /// The new key is noted before it is kept, so a refusal of it heard the
    /// moment it is kept stands; an answer to the old key, after the note, is
    /// about a key no longer kept.
    pub fn set_key(&self, key: &str) -> Result<GranolaStatus, GranolaFailure> {
        key::check(key)?;
        let _changing = self.state.changing();
        self.state
            .now_keeping(self.scope, self.state.fingerprint(key));
        key::save(self.store, self.scope, key).inspect_err(|_| self.no_longer_known())?;
        log::info!("Granola API key stored");
        Ok(GranolaStatus {
            has_key: true,
            last_refusal: None,
        })
    }

    pub fn forget_key(&self) -> Result<GranolaStatus, GranolaFailure> {
        let _changing = self.state.changing();
        self.state.now_keeping(self.scope, Kept::Nothing);
        key::forget(self.store, self.scope).inspect_err(|_| self.no_longer_known())?;
        log::info!("Granola API key removed");
        Ok(GranolaStatus {
            has_key: false,
            last_refusal: None,
        })
    }

    /// After the Keychain failed to change, which key it holds is not known;
    /// the next answer heard says.
    fn no_longer_known(&self) {
        self.state.now_keeping(self.scope, Kept::Unknown);
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
        let sent = [(KEY_NAME.to_string(), key)];
        let (status, body) = api::get(&url, &sent[0].1)
            .await
            .map_err(|failure| failure.struck_of(&sent))?;
        self.state.heard(self.scope, &sent[0].1, status);
        log::debug!("Granola answered {status}");
        let text = String::from_utf8(body).map_err(|_| {
            GranolaFailure::new(FailureKind::Malformed, "Granola did not answer with text")
        })?;
        Ok(GranolaAnswer {
            status,
            body: redact(&text, &sent),
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

/// Keeps the key the person pasted, replacing any kept before.
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
