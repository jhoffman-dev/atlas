//! Why a call to embed was refused, in a shape the chunker can act on: which
//! text, and for what, besides the sentence a person reads.

use std::fmt;

use serde::Serialize;

/// Why one text was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RefusalReason {
    /// More tokens than the model reads; split it.
    TooLong,
    /// Nothing but the model's markers and unknown-word tokens: empty,
    /// whitespace, control or zero-width characters, or a script it lacks.
    NothingReadable,
    /// A stretch the model reads as one unknown word, longer than it lets
    /// through: an unspaced script or a pasted blob of data.
    UnreadableRun,
}

/// A refused call. `text_index` (from 0) and `reason` are set when one text
/// was the cause, and absent when the call as a whole was refused or failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedFailure {
    pub message: String,
    pub text_index: Option<usize>,
    pub reason: Option<RefusalReason>,
}

impl EmbedFailure {
    /// The text at `index` (from 0) of `count`, refused for `reason`; `why`
    /// finishes the sentence "text 2 of 5 …".
    pub fn of_text(index: usize, count: usize, reason: RefusalReason, why: &str) -> Self {
        Self {
            message: format!("text {} of {count} {why}", index + 1),
            text_index: Some(index),
            reason: Some(reason),
        }
    }
}

impl From<String> for EmbedFailure {
    fn from(message: String) -> Self {
        Self {
            message,
            text_index: None,
            reason: None,
        }
    }
}

impl fmt::Display for EmbedFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}
