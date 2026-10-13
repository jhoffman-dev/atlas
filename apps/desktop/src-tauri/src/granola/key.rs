//! The Granola API key the host keeps for a vault.
//!
//! One Keychain item per vault, under the `SecretStore` every secret uses
//! (ADR-0017), at `<vault>:apikey/granola`. It goes in through
//! `granola_set_key` and comes out only inside this process, into a request
//! to Granola; it is never named, listed or filled as one of the vault's
//! secrets.

use super::failure::{FailureKind, GranolaFailure};
use crate::secrets::{apikey_account, SecretStore};

const PROVIDER: &str = "granola";

/// Every Granola API key starts with this.
const KEY_PREFIX: &str = "grn_";

fn keychain(error: String) -> GranolaFailure {
    GranolaFailure::new(
        FailureKind::Keychain,
        format!("the Keychain refused: {error}"),
    )
}

/// The backstop for what TypeScript already checked and words for the
/// person: a Granola key, and nothing that could break the header it is
/// written into. The key is never quoted back.
pub fn check(key: &str) -> Result<(), GranolaFailure> {
    let usable = key.len() > KEY_PREFIX.len()
        && key.starts_with(KEY_PREFIX)
        && key.bytes().all(|byte| byte.is_ascii_graphic());
    if usable {
        Ok(())
    } else {
        Err(GranolaFailure::new(
            FailureKind::Invalid,
            "that is not a Granola API key",
        ))
    }
}

pub fn load(store: &dyn SecretStore, scope: &str) -> Result<Option<String>, GranolaFailure> {
    store
        .get(&apikey_account(scope, PROVIDER))
        .map_err(keychain)
}

pub fn save(store: &dyn SecretStore, scope: &str, key: &str) -> Result<(), GranolaFailure> {
    check(key)?;
    store
        .set(&apikey_account(scope, PROVIDER), key)
        .map_err(keychain)
}

pub fn forget(store: &dyn SecretStore, scope: &str) -> Result<(), GranolaFailure> {
    store
        .delete(&apikey_account(scope, PROVIDER))
        .map_err(keychain)
}

#[cfg(test)]
mod tests {
    use super::{check, forget, load, save};
    use crate::granola::failure::FailureKind;
    use crate::secrets::{entries_in, MemoryStore, SecretStore};

    const KEY: &str = "grn_Fict10nalKey";

    #[test]
    fn a_key_round_trips_through_the_store_for_its_own_vault_only() {
        let store = MemoryStore::default();
        save(&store, "v1", KEY).unwrap();
        assert_eq!(load(&store, "v1").unwrap().as_deref(), Some(KEY));
        assert_eq!(load(&store, "v2").unwrap(), None);
        forget(&store, "v1").unwrap();
        assert_eq!(load(&store, "v1").unwrap(), None);
    }

    #[test]
    fn the_key_is_kept_at_the_vaults_granola_apikey_account() {
        let store = MemoryStore::default();
        save(&store, "v1", KEY).unwrap();
        assert_eq!(store.accounts().unwrap(), vec!["v1:apikey/granola"]);
    }

    #[test]
    fn the_key_is_never_listed_among_the_vaults_secrets() {
        let store = MemoryStore::default();
        save(&store, "v1", KEY).unwrap();
        assert!(entries_in(&store, "v1").unwrap().is_empty());
    }

    #[test]
    fn a_granola_key_is_accepted() {
        for key in [KEY, "grn_x", "grn_AbC-123_xyz.~"] {
            assert!(check(key).is_ok(), "{key} was refused");
        }
    }

    #[test]
    fn anything_but_a_granola_key_is_refused_and_never_kept_or_quoted() {
        for key in [
            "",
            "grn_",
            "GRN_abc",
            "sk-ant-abc",
            " grn_abc",
            "grn_ab c",
            "grn_abc\r\nX-Evil: 1",
            "grn_abc\t",
            "grn_ébc",
        ] {
            let store = MemoryStore::default();
            let failure = save(&store, "v1", key).unwrap_err();
            assert_eq!(failure.kind, FailureKind::Invalid, "{key:?}");
            assert!(
                key.is_empty() || !failure.message.contains(key),
                "{key:?} was quoted"
            );
            assert!(store.accounts().unwrap().is_empty(), "{key:?} was kept");
        }
    }
}
