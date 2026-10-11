//! Secrets a source refers to by name, held in the macOS Keychain.
//!
//! A value goes in through `secret_set` and comes out only inside this process,
//! to be sent: `fill` puts it into an outgoing request, and nothing returns one
//! to the webview. There is deliberately no `secret_get` command. What a
//! reference looks like and which source uses which secret are decided in
//! TypeScript; the request arrives here already split into text and names.
//!
//! Each vault has its own secrets: the Keychain account is `<vault>/<name>`,
//! where `<vault>` is a digest of the vault's path, so two vaults that both say
//! `{{secret:github}}` never read each other's token by accident.
//!
//! Each secret is bound to the origins it may be sent to (`binding`), and a
//! request to any other is refused before anything is sent.

use std::path::Path;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::vault::{root_for_write, VaultState};

pub use binding::{check_bound, entries_in, remove_secret, write_secret, SecretEntry, SecretWrite};

/// The Keychain service every Atlas secret is filed under.
pub const SERVICE: &str = "dev.jhoffman.atlas";

/// Where values live. A trait so that tests run against memory, never the
/// Keychain of the machine running them.
pub trait SecretStore: Send + Sync {
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    /// None when nothing is stored under the account.
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    /// Removing what is not there is not an error.
    fn delete(&self, account: &str) -> Result<(), String>;
    /// Every account filed under `SERVICE`.
    fn accounts(&self) -> Result<Vec<String>, String>;
}

pub struct SecretState(Box<dyn SecretStore>);

impl SecretState {
    pub fn new(store: Box<dyn SecretStore>) -> Self {
        Self(store)
    }

    pub fn store(&self) -> &dyn SecretStore {
        self.0.as_ref()
    }
}

impl Default for SecretState {
    fn default() -> Self {
        Self::new(Box::new(keychain::KeychainStore))
    }
}

/// A stable short name for a vault: the first 16 hex digits of the SHA-256 of
/// its canonical path. Moving the vault gives it a new name, and its secrets
/// have to be set again — the price of never sharing them between two vaults.
pub fn vault_scope(root: &Path) -> String {
    let canonical = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The backstop for a name that TypeScript already checked (`isSecretName`,
/// which this matches: a letter or digit, then letters, digits, `.`, `_` and
/// `-`, at most 64). A slash would let one vault's name reach into another
/// vault's accounts.
fn checked_name(name: &str) -> Result<&str, String> {
    let usable = name.len() <= 64
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if usable {
        Ok(name)
    } else {
        Err(format!("{name:?} is not a usable secret name"))
    }
}

fn account(scope: &str, name: &str) -> Result<String, String> {
    Ok(format!("{scope}/{}", checked_name(name)?))
}

/// Where the host keeps a sign-in it made itself, such as Google's (ADR-0030):
/// `<vault>:oauth/<provider>`. Outside the `<vault>/` accounts, so it is never
/// listed as a name, filled into a source's request, or bound to another site
/// in Settings; only the host's own code for that provider reads it.
pub fn oauth_account(scope: &str, provider: &str) -> String {
    format!("{scope}:oauth/{provider}")
}

/// One piece of a value that may name secrets, as TypeScript split it.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum TemplatePart {
    Text { text: String },
    Secret { secret: String },
}

/// A value with its secrets filled in, and which secrets went into it — so the
/// caller can keep them out of anything it hands back.
pub struct Filled {
    pub text: String,
    pub used: Vec<(String, String)>,
}

/// Fills each named secret into a value, from this vault's accounts.
pub fn fill(
    store: &dyn SecretStore,
    scope: &str,
    parts: &[TemplatePart],
) -> Result<Filled, String> {
    let mut filled = Filled {
        text: String::new(),
        used: Vec::new(),
    };
    for part in parts {
        match part {
            TemplatePart::Text { text } => filled.text.push_str(text),
            TemplatePart::Secret { secret } => {
                let value = store
                    .get(&account(scope, secret)?)?
                    .ok_or_else(|| format!("the secret {secret:?} is not set for this vault"))?;
                filled.text.push_str(&value);
                filled.used.push((secret.clone(), value));
            }
        }
    }
    Ok(filled)
}

/// A value as it was written, secrets as references. What may be logged.
pub fn describe(parts: &[TemplatePart]) -> String {
    parts
        .iter()
        .map(|part| match part {
            TemplatePart::Text { text } => text.clone(),
            TemplatePart::Secret { secret } => format!("{{{{secret:{secret}}}}}"),
        })
        .collect()
}

/// Every secret that went into a request is struck from what came back. A
/// server that echoes its headers — plenty of test endpoints do — would
/// otherwise write the token into a note, and so into the vault and Git.
pub use redact::redact;

fn names_in(accounts: Vec<String>, scope: &str) -> Vec<String> {
    let prefix = format!("{scope}/");
    let mut names: Vec<String> = accounts
        .into_iter()
        .filter_map(|account| account.strip_prefix(&prefix).map(str::to_string))
        .collect();
    names.sort();
    names
}

// The commands below are async so that the Keychain, which can block on a
// prompt, is never asked from the main thread.

/// The open vault's secrets: each name, and where it may be sent. Never a
/// value: this is the one listing the webview gets.
#[tauri::command]
pub async fn secret_list(
    vault: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
) -> Result<Vec<SecretEntry>, String> {
    let root = vault.root().ok_or("no vault is open")?;
    entries_in(secrets.store(), &vault_scope(&root))
}

/// Asks, in a native dialog the webview cannot answer, before a stored value
/// goes somewhere it was not bound to.
fn ask_to_widen(app: &AppHandle, name: &str, added: &[String]) -> bool {
    app.dialog()
        .message(format!(
            "Send the secret “{name}” to {}?\n\nOnly allow a site you would give this token to.",
            added.join(", ")
        ))
        .title("Allow a secret to be sent to a new site")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Allow".into(),
            "Cancel".into(),
        ))
        .blocking_show()
}

/// Stores or replaces a secret, bound to `origins` when they are given.
/// `vault` is the vault the value was typed for: a switch in between refuses
/// the write rather than filing it under the other.
#[tauri::command]
pub async fn secret_set(
    app: AppHandle,
    state: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    vault: String,
    name: String,
    value: String,
    origins: Option<Vec<String>>,
) -> Result<(), String> {
    let root = root_for_write(state.root(), Some(&vault))?;
    let write = SecretWrite {
        scope: &vault_scope(&root),
        name: &name,
        value: Some(&value),
        origins: origins.as_deref(),
    };
    write_secret(secrets.store(), &write, &|name, added| {
        ask_to_widen(&app, name, added)
    })?;
    // The name only. The value is not logged at any level.
    log::info!("secret {name:?} stored");
    Ok(())
}

/// Changes where a stored secret may be sent.
#[tauri::command]
pub async fn secret_bind(
    app: AppHandle,
    state: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    vault: String,
    name: String,
    origins: Vec<String>,
) -> Result<(), String> {
    let root = root_for_write(state.root(), Some(&vault))?;
    let write = SecretWrite {
        scope: &vault_scope(&root),
        name: &name,
        value: None,
        origins: Some(&origins),
    };
    write_secret(secrets.store(), &write, &|name, added| {
        ask_to_widen(&app, name, added)
    })?;
    log::info!("secret {name:?} bound to {}", origins.join(", "));
    Ok(())
}

#[tauri::command]
pub async fn secret_delete(
    state: State<'_, VaultState>,
    secrets: State<'_, SecretState>,
    vault: String,
    name: String,
) -> Result<(), String> {
    let root = root_for_write(state.root(), Some(&vault))?;
    remove_secret(secrets.store(), &vault_scope(&root), &name)?;
    log::info!("secret {name:?} removed");
    Ok(())
}

/// A store in memory, for tests. Never used by the app.
#[cfg(test)]
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<std::collections::BTreeMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "store poisoned")?
            .insert(account.to_string(), value.to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "store poisoned")?
            .get(account)
            .cloned())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.0.lock().map_err(|_| "store poisoned")?.remove(account);
        Ok(())
    }

    fn accounts(&self) -> Result<Vec<String>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "store poisoned")?
            .keys()
            .cloned()
            .collect())
    }
}

mod binding;
mod keychain;
mod redact;

#[cfg(test)]
mod tests;
