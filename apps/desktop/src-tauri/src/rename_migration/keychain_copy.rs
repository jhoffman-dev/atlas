//! Copying the secrets Atlas kept in the Keychain to DFAI's service. Done in
//! Rust, where values stay (ADR-0017); nothing here ever puts a value into words.

use super::state::{AccountState, State, ATTEMPTS};
use crate::secrets::SecretStore;

/// What `copy_secrets` did. Tests check the per-account rule through it; the
/// app copies through `copy_unsettled`, which keeps state between launches.
#[cfg(test)]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct SecretsCopied {
    pub copied: usize,
    pub already_there: usize,
    /// The accounts that could not be read or written. Names, never values.
    pub failed: Vec<String>,
}

/// Copies every secret Atlas kept to DFAI's service, under the same account,
/// unless DFAI already has one there. An account that cannot be read — the
/// person denied the Keychain's prompt — is named in `failed` and the rest
/// still copy.
#[cfg(test)]
pub fn copy_secrets(from: &dyn SecretStore, to: &dyn SecretStore) -> Result<SecretsCopied, String> {
    let mut report = SecretsCopied::default();
    for account in from.accounts()? {
        match copy_secret(from, to, &account) {
            Ok(true) => report.copied += 1,
            Ok(false) => report.already_there += 1,
            Err(_) => report.failed.push(account),
        }
    }
    Ok(report)
}

/// Whether the secret was copied; false when DFAI had one already.
fn copy_secret(
    from: &dyn SecretStore,
    to: &dyn SecretStore,
    account: &str,
) -> Result<bool, String> {
    if to.get(account)?.is_some() {
        return Ok(false);
    }
    match from.get(account)? {
        Some(value) => to.set(account, &value).map(|()| true),
        // Gone between the listing and the read: nothing to copy.
        None => Ok(false),
    }
}

/// What one launch's pass over the Keychain did.
#[derive(Debug, Default)]
pub struct KeychainPass {
    pub said: Vec<String>,
    /// Accounts given up on this launch, to be told about once.
    pub gave_up: Vec<String>,
}

/// Copies each account the state has not settled, and settles it: done when
/// copied (or DFAI had it), given up after `ATTEMPTS` launches that could
/// not read it. A settled account is never asked for again.
pub fn copy_unsettled(
    state: &mut State,
    from: &dyn SecretStore,
    to: &dyn SecretStore,
) -> KeychainPass {
    let mut pass = KeychainPass::default();
    let accounts = match from.accounts() {
        Ok(accounts) => accounts,
        Err(error) => {
            pass.said
                .push(format!("Atlas's secrets could not be listed: {error}"));
            return pass;
        }
    };
    let mut copied = 0;
    for account in accounts {
        let attempts = match state.accounts.get(&account) {
            Some(AccountState::Done | AccountState::GaveUp) => continue,
            Some(AccountState::Trying { attempts }) => *attempts,
            None => 0,
        };
        let settled = match copy_secret(from, to, &account) {
            Ok(was_copied) => {
                copied += usize::from(was_copied);
                AccountState::Done
            }
            Err(_) if attempts + 1 >= ATTEMPTS => {
                pass.gave_up.push(account.clone());
                AccountState::GaveUp
            }
            Err(_) => {
                pass.said.push(format!(
                    "the secret {account} could not be read from Atlas; it is asked for again next launch"
                ));
                AccountState::Trying {
                    attempts: attempts + 1,
                }
            }
        };
        state.accounts.insert(account, settled);
    }
    if copied > 0 {
        pass.said
            .push(format!("copied {copied} secrets from Atlas"));
    }
    for account in &pass.gave_up {
        pass.said.push(format!(
            "gave up on the secret {account}: it could not be read from Atlas in {ATTEMPTS} launches"
        ));
    }
    pass
}
