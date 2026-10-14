//! Striking every secret that went out from whatever came back.
//!
//! A server that echoes its request rarely echoes it byte for byte. It builds a
//! `next` link from the query it was sent, percent-encoding some characters and
//! not others, in upper or lower case, and sometimes twice; it form-encodes a
//! space as `+`; it quotes a header in JSON, escaping `"` and `\`, or every
//! character; it hands back a whole header — `Bearer <key>`, the credentials of
//! a Basic one — as base64. Each character of a secret is looked for as itself,
//! as `%XX` or `%25XX` in either case of hex, as a JSON `\uXXXX` or short
//! escape, and a space as `+`, so a value written in any mixture of those is
//! still found; so is its base64, in both alphabets, padded or not, at each of
//! the three alignments it can sit at.
//!
//! What is deliberately not looked for, and why that is acceptable:
//!
//! - hex, HTML entities, `\x` and `\u{…}` escapes, a case-folded or
//!   NFD-normalised copy, base64 wrapped across lines, base64 of the
//!   percent-encoded value, and an echo cut short.
//!
//! Each is a server going out of its way to transform what it was sent, and
//! every form added makes every secret's matcher larger and slower. The
//! redactor is defence in depth: what keeps a secret safe is that it is only
//! ever sent where it is pinned or bound to go (ADR-0017), so a server that
//! could echo it in one of these forms is one the person chose to give it to.
//!
//! Every match of every secret is collected before anything is replaced, and
//! matches that overlap are struck as one span: replacing a shorter secret first
//! would break up a longer one that contains it, and leave its remainder in the
//! clear.

use std::cmp::Reverse;
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::BuildHasher;
use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

use base64::engine::general_purpose::{
    GeneralPurpose, STANDARD, STANDARD_NO_PAD, URL_SAFE, URL_SAFE_NO_PAD,
};
use base64::Engine;
use regex::{Regex, RegexBuilder};

/// Handed back in place of a response that could not be checked. Nothing is
/// better than something that might hold a secret.
const UNCHECKED: &str = "[the response could not be checked for secrets, so it is not shown]";

/// What one secret's matcher may take, which bounds what building it costs
/// and so how long a secret Atlas keeps may be: a value whose matcher will
/// not build within it is refused when it is saved, and never sent. Every
/// character may be written several ways, so what fits depends on which
/// characters they are — some 2.2 KB of printable ASCII in no order, and
/// 3.7 KB of a signed token's letters, digits, `-`, `_` and `.`.
const MATCHER_SIZE_LIMIT: usize = 12 * 1024 * 1024;

/// A value longer than this is refused without trying to build its matcher.
/// Building one tries the whole pattern first, which for a value of megabytes
/// is gigabytes of text; and no value of more than some 4.3 KB (of `€`, the
/// cheapest character per byte) has been seen to fit `MATCHER_SIZE_LIMIT`, so
/// this refuses nothing that would build.
const NEVER_BUILDS_PAST: usize = 16 * 1024;

/// A secret whose matcher would not build within `MATCHER_SIZE_LIMIT`: it
/// could not be struck from what comes back, so it is neither kept nor sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TooLongToProtect;

/// A secret shorter than this is not looked for as base64: the base64 of one
/// or two bytes is a character or two, which ordinary text is full of.
const SHORTEST_FOR_BASE64: usize = 8;

/// Replaces every secret that went into a request wherever it appears in what
/// came back, in any of the forms described above.
pub fn redact(text: &str, used: &[(String, String)]) -> String {
    let mut found: Vec<(usize, usize, &str)> = Vec::new();
    for (name, value) in used.iter().filter(|(_, value)| !value.is_empty()) {
        let Ok(matcher) = matchers().for_secret(name, value, matcher) else {
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

/// Builds the matcher that strikes `value` as `name`, unless it is already
/// held, so that a value it cannot be built for is refused before it is kept
/// or sent rather than discovered in an answer that then has to be withheld.
pub fn ensure_strikable(name: &str, value: &str) -> Result<(), TooLongToProtect> {
    matchers().for_secret(name, value, matcher).map(drop)
}

/// Lets go of the matcher held for `name`, whose secret is gone.
pub fn forget_matcher(name: &str) {
    matchers().by_name().remove(name);
}

/// Whether a matcher is held for `name` built for `value`. Asked by value as
/// well as name because tests running at once share the one cache: another
/// test's value under the same name is not this one's.
#[cfg(test)]
pub fn holds_matcher(name: &str, value: &str) -> bool {
    let matchers = matchers();
    let fingerprint = matchers.fingerprints.hash_one(value);
    matchers
        .by_name()
        .get(name)
        .is_some_and(|(held, _)| *held == fingerprint)
}

/// `redact`, on a thread kept for blocking work. Matching a long secret
/// against a large answer built to resemble it takes seconds — two, for a
/// 1,024-byte secret and 16 MB — and on an async worker that would stall
/// every other command, and the local API server, for as long.
pub async fn redact_off_worker(text: String, used: Vec<(String, String)>) -> String {
    tauri::async_runtime::spawn_blocking(move || redact(&text, &used))
        .await
        .unwrap_or_else(|_| UNCHECKED.to_string())
}

/// The matchers built in this run, one per secret name.
fn matchers() -> &'static Matchers {
    static MATCHERS: OnceLock<Matchers> = OnceLock::new();
    MATCHERS.get_or_init(Matchers::default)
}

/// A matcher, or that it would not build, for the value whose fingerprint it
/// is held with.
type Held = (u64, Result<Arc<Regex>, TooLongToProtect>);

/// Each secret's matcher, built once per value and held by the secret's name.
///
/// What is held is the compiled matcher, whose pattern spells the value out
/// in every form it is looked for in: holding it is holding the value, in
/// this process's memory only. It is held until the secret is deleted (or
/// the Granola key forgotten), until its name is used with another value,
/// which replaces it, or until the app quits. A value whose matcher would not
/// build is held as that failure instead, so a request that names it is
/// refused at once rather than building it again.
#[derive(Default)]
struct Matchers {
    by_name: Mutex<HashMap<String, Held>>,
    /// Keyed afresh in each run, so a fingerprint means nothing outside it.
    fingerprints: RandomState,
}

impl Matchers {
    /// Every write is one whole entry, so a thread that panicked holding the
    /// lock cannot have left it half-changed.
    fn by_name(&self) -> MutexGuard<'_, HashMap<String, Held>> {
        self.by_name
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The matcher for `value`, built with `build` only when what is held for
    /// `name` was built for some other value or nothing is held. The build runs
    /// outside the lock, so one secret's build never holds up another's match.
    fn for_secret(
        &self,
        name: &str,
        value: &str,
        build: impl FnOnce(&str) -> Result<Regex, TooLongToProtect>,
    ) -> Result<Arc<Regex>, TooLongToProtect> {
        let fingerprint = self.fingerprints.hash_one(value);
        if let Some((held, matcher)) = self.by_name().get(name) {
            if *held == fingerprint {
                return matcher.clone();
            }
        }
        let built = build(value).map(Arc::new);
        self.by_name()
            .insert(name.to_string(), (fingerprint, built.clone()));
        built
    }
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

/// One secret in any of its forms, each of which may itself be escaped.
fn matcher(value: &str) -> Result<Regex, TooLongToProtect> {
    if value.len() > NEVER_BUILDS_PAST {
        return Err(TooLongToProtect);
    }
    compiled(value).map_err(|_| TooLongToProtect)
}

fn compiled(value: &str) -> Result<Regex, regex::Error> {
    let alternatives: Vec<String> = forms(value).iter().map(|form| spelled(form)).collect();
    RegexBuilder::new(&alternatives.join("|"))
        .size_limit(MATCHER_SIZE_LIMIT)
        .build()
}

/// The text a secret is sent as: as it is, and, when it is long enough to
/// tell from ordinary text, as base64 (standard and URL-safe, padded and not).
/// Each once, and longer forms first, so that where two match at the same
/// place the whole of the secret is struck.
fn forms(value: &str) -> Vec<String> {
    let mut forms = vec![value.to_string()];
    if value.chars().count() >= SHORTEST_FOR_BASE64 {
        forms.extend([STANDARD, URL_SAFE].map(|engine| engine.encode(value)));
        for engine in [STANDARD_NO_PAD, URL_SAFE_NO_PAD] {
            forms.push(engine.encode(value));
            forms.extend(base64_cores(&engine, value));
        }
    }
    forms.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    forms.dedup();
    forms
}

/// The base64 text the value always encodes to, wherever it sits in what was
/// encoded. Base64 writes each 3 bytes as 4 characters, so a value that starts
/// 0, 1 or 2 bytes into a group (`Bearer ` is 7 bytes) is written three
/// different ways; within each, the characters that hold a bit of a byte
/// before or after the value change with those bytes, and the rest do not.
/// Those are the core, and the padding is left outside it.
fn base64_cores(engine: &GeneralPurpose, value: &str) -> Vec<String> {
    const BITS_PER_CHAR: usize = 6;
    (0..3)
        .filter_map(|offset| {
            let mut placed = vec![0u8; offset];
            placed.extend_from_slice(value.as_bytes());
            let encoded = engine.encode(&placed);
            let first = (offset * 8).div_ceil(BITS_PER_CHAR);
            let end = (placed.len() * 8) / BITS_PER_CHAR;
            let core = encoded.get(first..end)?;
            (!core.is_empty()).then(|| core.to_string())
        })
        .collect()
}

/// A pattern for the text written in any mixture of its escaped forms. Any
/// character may be escaped, letters and digits too: `\u0067` is `g` to a JSON
/// parser and `%67` is `g` to a URL decoder.
fn spelled(text: &str) -> String {
    text.chars()
        .map(|c| format!("(?:{})", escapes_of(c).join("|")))
        .collect()
}

/// The ways one character is written: itself, percent-encoded once or twice in
/// either case, JSON-escaped, and a space form-encoded as `+`.
fn escapes_of(c: char) -> Vec<String> {
    let mut bytes = [0u8; 4];
    // `%25` is the `%` itself encoded again, as it is when a URL is put inside
    // another URL's query.
    let percent: String = c
        .encode_utf8(&mut bytes)
        .bytes()
        .map(|byte| format!("%(?:25)?{byte:02X}"))
        .collect();
    let mut forms = vec![regex::escape(&c.to_string()), format!("(?i:{percent})")];
    if c == ' ' {
        forms.push(regex::escape("+"));
    }
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

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::time::{Duration, Instant};

    use super::{
        compiled, forms, matcher, Matchers, TooLongToProtect, MATCHER_SIZE_LIMIT, NEVER_BUILDS_PAST,
    };

    /// Builds with `matcher`, counting each build.
    fn counted<'a>(
        builds: &'a Cell<usize>,
    ) -> impl FnOnce(&str) -> Result<regex::Regex, TooLongToProtect> + 'a {
        move |value| {
            builds.set(builds.get() + 1);
            matcher(value)
        }
    }

    #[test]
    fn a_secret_is_built_once_and_its_matcher_reused() {
        let (matchers, builds) = (Matchers::default(), Cell::new(0));

        let first = matchers
            .for_secret("key", "grn_FirstValue", counted(&builds))
            .unwrap();
        let again = matchers
            .for_secret("key", "grn_FirstValue", counted(&builds))
            .unwrap();

        assert_eq!(builds.get(), 1);
        assert_eq!(first.as_str(), again.as_str());
    }

    #[test]
    fn a_changed_value_is_rebuilt_and_the_matcher_it_replaced_dropped() {
        let (matchers, builds) = (Matchers::default(), Cell::new(0));
        matchers
            .for_secret("key", "grn_FirstValue", counted(&builds))
            .unwrap();

        let changed = matchers
            .for_secret("key", "grn_OtherValue", counted(&builds))
            .unwrap();

        assert_eq!(builds.get(), 2);
        assert!(changed.is_match("grn_OtherValue"));
        assert!(!changed.is_match("grn_FirstValue"));
        assert_eq!(
            matchers.by_name().len(),
            1,
            "the replaced value's matcher is still held"
        );
    }

    #[test]
    fn a_value_that_would_not_build_is_held_as_that_and_not_tried_again() {
        let (matchers, builds) = (Matchers::default(), Cell::new(0));
        let refused = |builds: &Cell<usize>| {
            builds.set(builds.get() + 1);
            Err(TooLongToProtect)
        };

        let first = matchers.for_secret("key", "grn_TooLong", |_| refused(&builds));
        let again = matchers.for_secret("key", "grn_TooLong", |_| refused(&builds));

        assert_eq!(
            (first.err(), again.err()),
            (Some(TooLongToProtect), Some(TooLongToProtect))
        );
        assert_eq!(builds.get(), 1, "the failed build was tried again");
    }

    /// A secret with no `+`, `/` or `?` in its base64 reads the same in both
    /// alphabets, so most of its forms come twice; each is looked for once.
    #[test]
    fn each_form_is_looked_for_once_and_the_longest_first() {
        let made = forms("grn_Larkspur");

        let mut unique = made.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), made.len(), "{made:?}");
        assert!(
            made.windows(2).all(|pair| pair[0].len() >= pair[1].len()),
            "{made:?}"
        );
    }

    /// The size limit is what bounds a build: a signed token of some 3 KB
    /// fits within it, and one four times as long is refused by it rather
    /// than built at whatever cost.
    #[test]
    fn building_a_matcher_is_bounded_by_the_size_limit() {
        let token = super::super::tests::a_signed_token(3_000);

        let started = Instant::now();
        matcher(&token).expect("a 3 KB signed token fits the limit");
        let took = started.elapsed();

        // Well under a second in a debug build; ten seconds is a hang, not a
        // slow machine.
        assert!(took < Duration::from_secs(10), "{took:?}");
        match compiled(&token.repeat(4)) {
            Err(regex::Error::CompiledTooBig(limit)) => assert_eq!(limit, MATCHER_SIZE_LIMIT),
            other => panic!(
                "a secret four times as long was built: {:?}",
                other.map(|_| ())
            ),
        }
    }

    /// A value of megabytes would be a pattern of gigabytes before the size
    /// limit is ever reached, so it is refused before one is written; and the
    /// ceiling refuses nothing that would build — half of it, of the
    /// character cheapest per byte, already does not.
    #[test]
    fn a_value_past_what_could_ever_build_is_refused_without_building() {
        let huge = "k".repeat(256 * 1024);
        let started = Instant::now();
        assert_eq!(matcher(&huge).err(), Some(TooLongToProtect));
        assert!(started.elapsed() < Duration::from_secs(1), "it was built");

        let half = "€".repeat(NEVER_BUILDS_PAST / 2 / '€'.len_utf8());
        assert!(compiled(&half).is_err(), "half the ceiling builds");
    }

    /// Adversarial (P28-10 round 3). The cache drops a matcher only when the
    /// same name is used with another value. A secret deleted — or "renamed",
    /// which is a delete and a set — keeps its matcher, built from its value,
    /// for the rest of the run: some 15 MiB for one of 1,024 bytes
    /// (measured: 40 names took the process from 11 MB to 600 MB resident), and
    /// a pattern the value reads straight back out of.
    #[test]
    fn a_deleted_secret_leaves_no_matcher_behind() {
        use crate::secrets::{account, remove_secret, MemoryStore, SecretStore};

        let (name, value) = ("larkspur-feed-token-deleted", "grn_DeletedLarkspurValue");
        let store = MemoryStore::default();
        store.set(&account("v1", name).unwrap(), value).unwrap();
        let used = [(name.to_string(), value.to_string())];
        assert_eq!(
            super::redact(value, &used),
            format!("[secret {name} removed]")
        );

        remove_secret(&store, "v1", name).unwrap();

        let held = super::matchers().by_name().contains_key(name);
        assert!(!held, "the deleted secret's matcher is still held");
    }
}
