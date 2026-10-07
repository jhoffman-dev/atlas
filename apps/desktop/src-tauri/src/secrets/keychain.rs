//! The real store: generic passwords in the login Keychain.
//!
//! `keyring-core` with its Apple store, which is what the keyring-rs
//! maintainers point applications at (the `keyring` crate itself is now their
//! sample and CLI glue). A keyring error is never formatted as it stands: one
//! of its variants carries the bytes it could not decode, which would be the
//! secret itself, so only the kind of failure is ever put into words.

use super::SecretStore;

pub struct KeychainStore;

#[cfg(target_os = "macos")]
mod platform {
    use std::collections::HashMap;
    use std::sync::Arc;

    use apple_native_keyring_store::keychain::Store;
    use keyring_core::api::CredentialStoreApi;
    use keyring_core::{Entry, Error};

    use crate::secrets::SERVICE;

    fn store() -> Result<Arc<Store>, String> {
        Store::new().map_err(|error| describe(&error))
    }

    pub fn entry(account: &str) -> Result<Entry, String> {
        store()?
            .build(SERVICE, account, None)
            .map_err(|error| describe(&error))
    }

    pub fn accounts() -> Result<Vec<String>, String> {
        let spec = HashMap::from([("service", SERVICE)]);
        let entries = store()?.search(&spec).map_err(|error| describe(&error))?;
        Ok(entries
            .iter()
            .filter_map(Entry::get_specifiers)
            .map(|(_, account)| account)
            .collect())
    }

    /// What went wrong, in words that cannot carry a value.
    pub fn describe(error: &Error) -> String {
        match error {
            Error::NoStorageAccess(_) => "the keychain refused access".into(),
            Error::NoEntry => "no such secret".into(),
            Error::BadEncoding(_) | Error::BadDataFormat(..) => {
                "the keychain holds something that is not text under this name".into()
            }
            Error::TooLong(attribute, limit) => format!("{attribute} is longer than {limit}"),
            Error::Invalid(parameter, _) => format!("the keychain refused the {parameter}"),
            _ => "the keychain could not be used".into(),
        }
    }

    pub use keyring_core::Error as KeyringError;
}

#[cfg(target_os = "macos")]
impl SecretStore for KeychainStore {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        platform::entry(account)?
            .set_password(value)
            .map_err(|error| platform::describe(&error))
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match platform::entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(platform::KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(platform::describe(&error)),
        }
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match platform::entry(account)?.delete_credential() {
            Ok(()) | Err(platform::KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(platform::describe(&error)),
        }
    }

    fn accounts(&self) -> Result<Vec<String>, String> {
        platform::accounts()
    }
}

/// Atlas ships for macOS only; elsewhere there is no keychain to use, and a
/// source that names a secret says so rather than sending nothing.
#[cfg(not(target_os = "macos"))]
impl SecretStore for KeychainStore {
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    fn get(&self, _: &str) -> Result<Option<String>, String> {
        Err(UNAVAILABLE.into())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    fn accounts(&self) -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }
}

#[cfg(not(target_os = "macos"))]
const UNAVAILABLE: &str = "secrets need the macOS Keychain";

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::KeychainStore;
    use crate::secrets::SecretStore;

    /// Touches the real login Keychain, so it is run by hand, never by the gate:
    /// `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --ignored keychain`.
    #[test]
    #[ignore = "writes to the login Keychain of whoever runs it"]
    fn keychain_round_trip() {
        let store = KeychainStore;
        let account = "atlas-test/round-trip";

        store.set(account, "first").unwrap();
        store.set(account, "second").unwrap();
        assert_eq!(store.get(account).unwrap().as_deref(), Some("second"));
        assert!(store
            .accounts()
            .unwrap()
            .iter()
            .any(|found| found == account));

        store.delete(account).unwrap();
        assert_eq!(store.get(account).unwrap(), None);
        // Deleting what is gone is not an error.
        store.delete(account).unwrap();
    }
}
