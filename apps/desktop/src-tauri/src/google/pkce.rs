//! Proof Key for Code Exchange (RFC 7636) and the sign-in's `state`.
//!
//! The verifier is made here and never leaves the host but to Google's token
//! endpoint, so a code that reaches anyone else — another app listening on
//! the loopback, a browser extension reading the redirect — cannot be turned
//! into a token without it. `state` ties the redirect to this sign-in.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use sha2::{Digest, Sha256};

/// 32 bytes is 43 characters once encoded: RFC 7636's shortest verifier, and
/// as much entropy as its S256 challenge can carry.
const VERIFIER_BYTES: usize = 32;
const STATE_BYTES: usize = 16;

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

impl Pkce {
    pub fn new() -> Result<Self, String> {
        let verifier = random_text(VERIFIER_BYTES)?;
        let challenge = challenge_of(&verifier);
        Ok(Self {
            verifier,
            challenge,
        })
    }
}

/// A fresh `state` for one sign-in.
pub fn new_state() -> Result<String, String> {
    random_text(STATE_BYTES)
}

/// `BASE64URL(SHA256(verifier))`, unpadded: the `S256` method.
pub fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Bytes from the operating system's CSPRNG, base64url without padding.
fn random_text(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).map_err(|error| format!("cannot make a sign-in: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

/// Compares two strings in time that depends on their length only, so a
/// caller guessing `state` learns nothing from how fast it is refused.
pub fn same(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0u8, |differ, (a, b)| differ | (a ^ b))
            == 0
}

#[cfg(test)]
mod tests {
    use super::{challenge_of, new_state, same, Pkce};

    #[test]
    fn the_challenge_is_rfc_7636s_s256_of_the_verifier() {
        // RFC 7636, Appendix B.
        assert_eq!(
            challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn a_verifier_is_43_unreserved_characters_and_never_repeats() {
        let first = Pkce::new().unwrap();
        let second = Pkce::new().unwrap();
        assert_eq!(first.verifier.len(), 43);
        assert!(first
            .verifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'));
        assert_ne!(first.verifier, second.verifier);
        assert_eq!(first.challenge, challenge_of(&first.verifier));
    }

    #[test]
    fn a_state_is_long_enough_not_to_be_guessed_and_never_repeats() {
        let state = new_state().unwrap();
        assert_eq!(state.len(), 22);
        assert_ne!(state, new_state().unwrap());
    }

    #[test]
    fn same_is_true_only_for_equal_strings() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        assert!(!same("abc", "ab"));
        assert!(!same("", "a"));
    }
}
