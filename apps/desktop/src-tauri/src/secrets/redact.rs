//! Striking every secret that went out from whatever came back.
//!
//! A server that echoes its request rarely echoes it byte for byte. It builds a
//! `next` link from the query it was sent, percent-encoding some characters and
//! not others, in upper or lower case; it quotes a header in JSON, escaping `"`
//! and `\`; it hands back the credentials of a Basic header as base64. Each of
//! those forms is looked for, character by character, so a value written in any
//! mixture of them is still found.
//!
//! Every match of every secret is collected before anything is replaced, and
//! matches that overlap are struck as one span: replacing a shorter secret first
//! would break up a longer one that contains it, and leave its remainder in the
//! clear.

use std::cmp::Reverse;

use base64::engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD};
use base64::Engine;
use regex::Regex;

/// Handed back in place of a response that could not be checked. Nothing is
/// better than something that might hold a secret.
const UNCHECKED: &str = "[the response could not be checked for secrets, so it is not shown]";

/// Replaces every secret that went into a request wherever it appears in what
/// came back, in any of the forms described above.
pub fn redact(text: &str, used: &[(String, String)]) -> String {
    let mut found: Vec<(usize, usize, &str)> = Vec::new();
    for (name, value) in used.iter().filter(|(_, value)| !value.is_empty()) {
        let Ok(matcher) = matcher(value) else {
            return UNCHECKED.to_string();
        };
        found.extend(
            matcher
                .find_iter(text)
                .map(|at| (at.start(), at.end(), name.as_str())),
        );
    }
    strike(text, found)
}

/// Replaces each span, merging any that overlap into one. The earliest, longest
/// match names the merged span.
fn strike(text: &str, mut found: Vec<(usize, usize, &str)>) -> String {
    found.sort_by_key(|&(start, end, _)| (start, Reverse(end)));

    let mut struck = String::with_capacity(text.len());
    let mut kept_to = 0;
    let mut spans = found.into_iter().peekable();
    while let Some((start, mut end, name)) = spans.next() {
        while let Some(&(next_start, next_end, _)) = spans.peek() {
            if next_start >= end {
                break;
            }
            end = end.max(next_end);
            spans.next();
        }
        struck.push_str(&text[kept_to..start]);
        struck.push_str(&format!("[secret {name} removed]"));
        kept_to = end;
    }
    struck.push_str(&text[kept_to..]);
    struck
}

/// One secret in any of its forms: as it is, and as base64 (standard and
/// URL-safe; padding is left outside the match, so padded and bare are both
/// found), each of which may itself be percent-encoded or JSON-escaped.
fn matcher(value: &str) -> Result<Regex, regex::Error> {
    let mut forms = vec![
        value.to_string(),
        STANDARD_NO_PAD.encode(value),
        URL_SAFE_NO_PAD.encode(value),
    ];
    forms.dedup();
    let alternatives: Vec<String> = forms.iter().map(|form| spelled(form)).collect();
    Regex::new(&alternatives.join("|"))
}

/// A pattern for the text written in any mixture of its escaped forms. Letters
/// and digits are matched as they are: no encoder escapes them.
fn spelled(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_string()
            } else {
                format!("(?:{})", escapes_of(c).join("|"))
            }
        })
        .collect()
}

/// The ways one character is written: itself, percent-encoded in either case,
/// and JSON-escaped.
fn escapes_of(c: char) -> Vec<String> {
    let mut bytes = [0u8; 4];
    let percent: String = c
        .encode_utf8(&mut bytes)
        .bytes()
        .map(|byte| format!("%{byte:02X}"))
        .collect();
    let mut forms = vec![regex::escape(&c.to_string()), format!("(?i:{percent})")];
    if let Some(short) = json_short_escape(c) {
        forms.push(regex::escape(short));
    }
    // A character past the basic plane is a surrogate pair in JSON, which no
    // echo of a token has been seen to produce; the others are one `\u`.
    if let Ok(unit) = u16::try_from(u32::from(c)) {
        forms.push(format!("(?i:\\\\u{unit:04X})"));
    }
    forms
}

fn json_short_escape(c: char) -> Option<&'static str> {
    match c {
        '"' => Some("\\\""),
        '\\' => Some("\\\\"),
        '/' => Some("\\/"),
        '\n' => Some("\\n"),
        '\r' => Some("\\r"),
        '\t' => Some("\\t"),
        '\u{8}' => Some("\\b"),
        '\u{c}' => Some("\\f"),
        _ => None,
    }
}
