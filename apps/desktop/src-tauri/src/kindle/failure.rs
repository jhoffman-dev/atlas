//! What went wrong, as the webview is told it: a kind it can branch on and a
//! sentence. An answer Amazon gave — a sign-in redirect, a 503, a page of
//! another shape — is not a failure here: it comes back as that page, for
//! TypeScript to read (`readKindleLibrary`, `readKindleAnnotations`).

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// The Kindle session's data store holds no cookie for the notebook, so
    /// nothing was sent: Connect Kindle was never done, or was undone.
    NotConnected,
    /// The host will not do it: an address off the notebook, a Mac older
    /// than macOS 14 (which has no data store of a session's own), or the
    /// main thread out of reach.
    Refused,
    /// Amazon could not be reached, or stopped sending.
    Unreachable,
    /// Amazon did not answer within the time a page is given.
    Timeout,
    /// The page is larger than DFAI will read.
    TooLarge,
}

/// A failure, with no cookie in it: every message is written here, or is
/// reqwest's account of a connection without its URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct KindleFailure {
    pub kind: FailureKind,
    pub message: String,
}

impl KindleFailure {
    pub fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{FailureKind, KindleFailure};

    #[test]
    fn the_webview_reads_the_kind_in_snake_case() {
        let failure = KindleFailure::new(FailureKind::NotConnected, "no session");
        assert_eq!(
            serde_json::to_value(&failure).unwrap(),
            serde_json::json!({ "kind": "not_connected", "message": "no session" })
        );
        for (kind, written) in [
            (FailureKind::Refused, "refused"),
            (FailureKind::Unreachable, "unreachable"),
            (FailureKind::Timeout, "timeout"),
            (FailureKind::TooLarge, "too_large"),
        ] {
            assert_eq!(serde_json::to_value(kind).unwrap(), written);
        }
    }
}
