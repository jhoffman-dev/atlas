//! What went wrong, as the webview is told it: a kind it can branch on and a
//! sentence. An answer Amazon gave — a sign-in redirect, a 503, a page of
//! another shape — is not a failure here: it comes back as that page, for
//! TypeScript to read (`readKindleLibrary`, `readKindleAnnotations`).

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// The Kindle session's data store has no session: Connect Kindle was
    /// never done, or was undone.
    #[cfg_attr(
        not(target_os = "macos"),
        allow(dead_code, reason = "only a Mac has a session to be missing")
    )]
    NotConnected,
    /// This Mac cannot keep a Kindle session apart from the rest of DFAI: it
    /// is older than macOS 14 (which has no data store of a session's own),
    /// or it is not a Mac.
    Unsupported,
    /// The host will not do it: an address off the notebook, or the main
    /// thread out of reach.
    Refused,
    /// Amazon could not be reached, or stopped sending.
    Unreachable,
    /// Amazon did not answer within the time a page is given.
    Timeout,
    /// The page is larger than DFAI will read.
    TooLarge,
}

/// A failure, with no cookie and no URL in it: every message is written here.
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
            (FailureKind::Unsupported, "unsupported"),
            (FailureKind::Refused, "refused"),
            (FailureKind::Unreachable, "unreachable"),
            (FailureKind::Timeout, "timeout"),
            (FailureKind::TooLarge, "too_large"),
        ] {
            assert_eq!(serde_json::to_value(kind).unwrap(), written);
        }
    }
}
