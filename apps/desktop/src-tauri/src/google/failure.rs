//! What went wrong, as the webview is told it: a kind it can branch on, the
//! code Google gave where it gave one, and a sentence. What the person should
//! do about it is TypeScript's to say (`explainGoogleFailure`).

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureKind {
    /// No sign-in is kept for this vault on this Mac.
    NotConnected,
    /// A sign-in is already waiting in the browser.
    Busy,
    /// Google sent the browser back with an error instead of a code.
    Refused,
    /// The browser never came back.
    Timeout,
    /// The person cancelled the sign-in in Atlas.
    Cancelled,
    /// Google gave a token without every scope Atlas asked for.
    ScopeNotGranted,
    /// Google's token endpoint answered with an OAuth error.
    TokenRefused,
    /// Google answered something that is not what OAuth says it sends.
    Malformed,
    /// Google could not be reached.
    Unreachable,
    /// The request itself cannot be made: no vault, a path off the API.
    Invalid,
    /// The Keychain refused to keep or give back the sign-in.
    Keychain,
}

/// A failure, with no token in it. Every message is written here or is a
/// code Google sent, kept to the characters a code is made of.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GoogleFailure {
    pub kind: FailureKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub message: String,
}

impl GoogleFailure {
    pub fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            code: None,
            message: message.into(),
        }
    }

    /// With an OAuth error code as Google sent it, if it looks like one.
    pub fn with_code(mut self, code: &str) -> Self {
        self.code = Some(oauth_code(code));
        self
    }
}

/// OAuth error codes are lower-case words joined by `_` (RFC 6749 §5.2). Any
/// other text in that place is not passed on: it came from a redirect or a
/// response body, and the webview has no use for it.
fn oauth_code(raw: &str) -> String {
    let usable = !raw.is_empty()
        && raw.len() <= 64
        && raw
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_');
    if usable {
        raw.to_string()
    } else {
        "unrecognised".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{FailureKind, GoogleFailure};

    #[test]
    fn an_oauth_code_is_passed_on_as_google_sent_it() {
        let failure = GoogleFailure::new(FailureKind::Refused, "no").with_code("access_denied");
        assert_eq!(failure.code.as_deref(), Some("access_denied"));
    }

    #[test]
    fn anything_else_in_the_code_is_not() {
        for raw in ["", "<script>", "ya29.TOKEN", &"a".repeat(65)] {
            let failure = GoogleFailure::new(FailureKind::Refused, "no").with_code(raw);
            assert_eq!(failure.code.as_deref(), Some("unrecognised"), "{raw}");
        }
    }

    #[test]
    fn the_webview_reads_the_kind_in_snake_case() {
        let failure = GoogleFailure::new(FailureKind::ScopeNotGranted, "partly");
        let json = serde_json::to_string(&failure).unwrap();
        assert_eq!(json, r#"{"kind":"scope_not_granted","message":"partly"}"#);
    }
}
