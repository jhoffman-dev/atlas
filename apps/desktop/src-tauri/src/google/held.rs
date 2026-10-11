//! Each vault's sign-in as the host holds it between calls: the access token
//! in memory, and a generation that every connect and disconnect moves on.
//!
//! A refresh takes seconds, and the person can disconnect, or connect again,
//! while one is out. Whatever it brings back is kept only if the vault's
//! sign-in is still the one it started from — checked and written under one
//! lock — so a late refresh can neither put a removed sign-in back in the
//! Keychain, overwrite a newer one, nor leave an access token held after a
//! disconnect.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tokio::time::Instant;

use super::failure::GoogleFailure;

/// An access token is renewed this long before Google says it expires, so a
/// call never leaves with one that dies on the way.
pub const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

/// Google's access tokens last an hour. A longer `expires_in` is not believed
/// past a day, and one past the clock's range cannot take the host down.
const LONGEST_LIFETIME: Duration = Duration::from_secs(24 * 60 * 60);

/// Which sign-in a refresh started from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Generation(u64);

/// An access token as the token endpoint gave it.
pub struct Access<'a> {
    pub value: &'a str,
    pub expires_in: u64,
}

struct AccessToken {
    value: String,
    expires_at: Instant,
}

#[derive(Default)]
struct Held {
    generation: u64,
    access: Option<AccessToken>,
}

/// Every vault's sign-in, by its Keychain scope.
#[derive(Default)]
pub struct HeldSignIns(Mutex<HashMap<String, Held>>);

fn usable(token: &AccessToken) -> bool {
    Instant::now()
        .checked_add(EXPIRY_MARGIN)
        .is_some_and(|soon| soon < token.expires_at)
}

fn token_of(access: &Access) -> Option<AccessToken> {
    let lifetime = Duration::from_secs(access.expires_in).min(LONGEST_LIFETIME);
    Instant::now()
        .checked_add(lifetime)
        .map(|expires_at| AccessToken {
            value: access.value.to_string(),
            expires_at,
        })
}

impl HeldSignIns {
    /// A lock on whole values, so a thread that panicked holding it cannot
    /// have left one half-changed (as `VaultState`).
    fn locked(&self) -> MutexGuard<'_, HashMap<String, Held>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The vault's sign-in as it is now, and its access token while it lasts.
    pub fn current(&self, scope: &str) -> (Generation, Option<String>) {
        let held = self.locked();
        let Some(vault) = held.get(scope) else {
            return (Generation(0), None);
        };
        let access = vault
            .access
            .as_ref()
            .filter(|token| usable(token))
            .map(|token| token.value.clone());
        (Generation(vault.generation), access)
    }

    /// Writes what a refresh brought back — `write`, then its access token —
    /// only if the vault's sign-in is still `seen`. False when it moved on,
    /// and then nothing is written or held.
    pub fn settle(
        &self,
        scope: &str,
        seen: Generation,
        write: impl FnOnce() -> Result<(), GoogleFailure>,
        access: &Access,
    ) -> Result<bool, GoogleFailure> {
        let mut held = self.locked();
        let vault = held.entry(scope.to_string()).or_default();
        if Generation(vault.generation) != seen {
            return Ok(false);
        }
        write()?;
        vault.access = token_of(access);
        Ok(true)
    }

    /// Replaces the vault's sign-in — `change` writes the new one, or removes
    /// it — and starts a new generation, holding `access` or nothing. A
    /// refresh still out from before is then discarded when it lands.
    pub fn replace(
        &self,
        scope: &str,
        change: impl FnOnce() -> Result<(), GoogleFailure>,
        access: Option<&Access>,
    ) -> Result<(), GoogleFailure> {
        let mut held = self.locked();
        let vault = held.entry(scope.to_string()).or_default();
        // Moved on before the change, so even a change that fails half-way
        // leaves no refresh from before able to settle.
        vault.generation += 1;
        vault.access = None;
        change()?;
        vault.access = access.and_then(token_of);
        Ok(())
    }

    /// Drops the held access token, as a 401 says it is no good. The sign-in
    /// is unchanged, so a refresh already out may still settle.
    pub fn forget_access(&self, scope: &str) {
        if let Some(vault) = self.locked().get_mut(scope) {
            vault.access = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Access, HeldSignIns};

    const VAULT: &str = "v1";

    fn access(value: &str, expires_in: u64) -> Access<'_> {
        Access { value, expires_in }
    }

    #[tokio::test]
    async fn an_access_token_is_held_only_while_it_has_more_than_the_margin_left() {
        let held = HeldSignIns::default();
        held.replace(VAULT, || Ok(()), Some(&access("ya29.SHORT", 59)))
            .unwrap();
        assert_eq!(held.current(VAULT).1, None);
        held.replace(VAULT, || Ok(()), Some(&access("ya29.LONG", 61)))
            .unwrap();
        assert_eq!(held.current(VAULT).1.as_deref(), Some("ya29.LONG"));
        assert_eq!(held.current("v2").1, None);
    }

    #[tokio::test]
    async fn a_refresh_from_a_sign_in_since_replaced_writes_and_holds_nothing() {
        let held = HeldSignIns::default();
        let (seen, _) = held.current(VAULT);
        held.replace(VAULT, || Ok(()), None).unwrap();

        let mut wrote = false;
        let kept = held
            .settle(
                VAULT,
                seen,
                || {
                    wrote = true;
                    Ok(())
                },
                &access("ya29.LATE", 3599),
            )
            .unwrap();

        assert!(!kept);
        assert!(!wrote);
        assert_eq!(held.current(VAULT).1, None);
    }

    #[tokio::test]
    async fn a_refresh_from_the_current_sign_in_writes_and_holds_its_token() {
        let held = HeldSignIns::default();
        let (seen, _) = held.current(VAULT);
        let kept = held
            .settle(VAULT, seen, || Ok(()), &access("ya29.FRESH", 3599))
            .unwrap();
        assert!(kept);
        assert_eq!(held.current(VAULT).1.as_deref(), Some("ya29.FRESH"));
    }

    #[tokio::test]
    async fn a_replacement_that_fails_still_drops_the_held_token_and_moves_on() {
        let held = HeldSignIns::default();
        held.replace(VAULT, || Ok(()), Some(&access("ya29.OLD", 3599)))
            .unwrap();
        let (seen, _) = held.current(VAULT);

        let failed = held.replace(
            VAULT,
            || {
                Err(super::GoogleFailure::new(
                    super::super::failure::FailureKind::Keychain,
                    "locked",
                ))
            },
            None,
        );

        assert!(failed.is_err());
        assert_eq!(held.current(VAULT), (held.current(VAULT).0, None));
        assert_ne!(held.current(VAULT).0, seen);
    }

    #[tokio::test]
    async fn an_expiry_past_the_clocks_range_is_held_for_a_day_at_most() {
        let held = HeldSignIns::default();
        held.replace(VAULT, || Ok(()), Some(&access("ya29.FAR", u64::MAX)))
            .unwrap();
        assert_eq!(held.current(VAULT).1.as_deref(), Some("ya29.FAR"));

        tokio::time::pause();
        tokio::time::advance(std::time::Duration::from_secs(24 * 60 * 60)).await;
        assert_eq!(held.current(VAULT).1, None);
    }
}
