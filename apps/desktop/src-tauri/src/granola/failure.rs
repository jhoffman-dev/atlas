//! What went wrong, as the webview is told it: a kind it can branch on and a
//! sentence. What the person should do about it is TypeScript's to say
//! (`explainGranolaFailure`). An answer Granola gave — a 401, a 404, a 429 —
//! is not a failure here: it comes back as that answer, for TypeScript to read.

use serde::Serialize;

use crate::secrets::redact;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// No Granola key is kept for this vault on this Mac.
    NoKey,
    /// The request itself cannot be made: no vault, a path off the API, a key
    /// that is not a Granola key.
    Invalid,
    /// Granola could not be reached, or stopped sending.
    Unreachable,
    /// Granola did not answer within the time a request is given.
    Timeout,
    /// The answer is larger than Atlas will read.
    TooLarge,
    /// Granola answered with something that is not text.
    Malformed,
    /// The Keychain refused to keep, give back or remove the key.
    Keychain,
}

/// A failure, with no key in it. Every message is written here, or is
/// reqwest's account of a connection without its URL, struck of the key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GranolaFailure {
    pub kind: FailureKind,
    pub message: String,
}

impl GranolaFailure {
    pub fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// The same failure with every key that went out struck from its message.
    pub fn struck_of(self, sent: &[(String, String)]) -> Self {
        Self {
            message: redact(&self.message, sent),
            ..self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{FailureKind, GranolaFailure};

    #[test]
    fn the_webview_reads_the_kind_in_snake_case() {
        let failure = GranolaFailure::new(FailureKind::TooLarge, "big");
        let json = serde_json::to_string(&failure).unwrap();
        assert_eq!(json, r#"{"kind":"too_large","message":"big"}"#);
    }

    #[test]
    fn a_key_in_the_message_is_struck() {
        let sent = [("granola-api-key".to_string(), "grn_S3CRET".to_string())];
        let failure =
            GranolaFailure::new(FailureKind::Unreachable, "refused grn_S3CRET").struck_of(&sent);
        assert!(
            !failure.message.contains("grn_S3CRET"),
            "{}",
            failure.message
        );
        assert_eq!(failure.kind, FailureKind::Unreachable);
    }
}
