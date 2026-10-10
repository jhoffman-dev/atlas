//! The sign-in the host keeps: the refresh token, and what it was issued to.
//!
//! One Keychain item per vault, under the `SecretStore` every secret uses
//! (ADR-0017), at `<vault>:oauth/google`. The client is kept with the token
//! because a refresh must name the client the token was issued to, whatever
//! the vault's settings say by then.

use serde::{Deserialize, Serialize};

use super::failure::{FailureKind, GoogleFailure};
use crate::secrets::{oauth_account, SecretStore};

const PROVIDER: &str = "google";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    pub client_id: String,
    /// Only for a client Google issued a secret to; see ADR-0030.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    pub refresh_token: String,
    /// The scopes Google granted, as it listed them.
    pub scopes: Vec<String>,
}

fn keychain(error: String) -> GoogleFailure {
    GoogleFailure::new(
        FailureKind::Keychain,
        format!("the Keychain refused: {error}"),
    )
}

pub fn load(store: &dyn SecretStore, scope: &str) -> Result<Option<Grant>, GoogleFailure> {
    let Some(stored) = store
        .get(&oauth_account(scope, PROVIDER))
        .map_err(keychain)?
    else {
        return Ok(None);
    };
    // serde's message can quote the text it choked on, which is the token.
    serde_json::from_str(&stored).map(Some).map_err(|_| {
        GoogleFailure::new(
            FailureKind::Keychain,
            "the Google sign-in kept in the Keychain cannot be read",
        )
    })
}

pub fn save(store: &dyn SecretStore, scope: &str, grant: &Grant) -> Result<(), GoogleFailure> {
    let text = serde_json::to_string(grant).map_err(|_| {
        GoogleFailure::new(
            FailureKind::Keychain,
            "the Google sign-in cannot be written",
        )
    })?;
    store
        .set(&oauth_account(scope, PROVIDER), &text)
        .map_err(keychain)
}

pub fn forget(store: &dyn SecretStore, scope: &str) -> Result<(), GoogleFailure> {
    store
        .delete(&oauth_account(scope, PROVIDER))
        .map_err(keychain)
}

#[cfg(test)]
mod tests {
    use super::{forget, load, save, Grant};
    use crate::secrets::{entries_in, oauth_account, MemoryStore, SecretStore};

    fn grant() -> Grant {
        Grant {
            client_id: "123-abc.apps.googleusercontent.com".into(),
            client_secret: None,
            refresh_token: "1//REFRESH".into(),
            scopes: vec!["https://www.googleapis.com/auth/calendar.app.created".into()],
        }
    }

    #[test]
    fn a_grant_round_trips_through_the_store_for_its_own_vault_only() {
        let store = MemoryStore::default();
        save(&store, "v1", &grant()).unwrap();
        assert_eq!(load(&store, "v1").unwrap(), Some(grant()));
        assert_eq!(load(&store, "v2").unwrap(), None);
        forget(&store, "v1").unwrap();
        assert_eq!(load(&store, "v1").unwrap(), None);
    }

    #[test]
    fn the_grant_is_never_listed_among_the_vaults_secrets() {
        let store = MemoryStore::default();
        save(&store, "v1", &grant()).unwrap();
        assert!(entries_in(&store, "v1").unwrap().is_empty());
    }

    #[test]
    fn a_grant_that_does_not_parse_is_refused_without_quoting_it() {
        let store = MemoryStore::default();
        store
            .set(
                &oauth_account("v1", "google"),
                r#"{"client_id":"x","refresh_token":"r","scopes":"1//SECRET"}"#,
            )
            .unwrap();
        let failure = load(&store, "v1").unwrap_err();
        assert!(!failure.message.contains("SECRET"), "{}", failure.message);
    }
}
