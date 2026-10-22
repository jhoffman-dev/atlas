use std::future::Future;
use std::path::Path;

use super::{
    account, binding::bound_origins, describe, entries_in, fill, names_in, redact, remove_secret,
    vault_scope, write_secret, MemoryStore, SecretStore, SecretWrite, TemplatePart,
};

fn text(text: &str) -> TemplatePart {
    TemplatePart::Text { text: text.into() }
}

fn secret(name: &str) -> TemplatePart {
    TemplatePart::Secret {
        secret: name.into(),
    }
}

fn store_with(scope: &str, name: &str, value: &str) -> MemoryStore {
    let store = MemoryStore::default();
    store.set(&account(scope, name).unwrap(), value).unwrap();
    store
}

#[test]
fn fills_a_secret_into_the_text_around_it() {
    let store = store_with("v1", "github", "ghp_TOKEN");

    let filled = fill(&store, "v1", &[text("Bearer "), secret("github")]).unwrap();

    assert_eq!(filled.text, "Bearer ghp_TOKEN");
    assert_eq!(filled.used, vec![("github".into(), "ghp_TOKEN".into())]);
}

#[test]
fn a_secret_that_is_not_set_is_named_in_the_refusal() {
    let store = MemoryStore::default();

    let error = fill(&store, "v1", &[secret("github")]).err().unwrap();

    assert_eq!(error, "the secret \"github\" is not set for this vault");
}

#[test]
fn one_vault_cannot_read_another_vaults_secret_of_the_same_name() {
    let store = store_with("vault-a", "github", "ghp_A");

    assert!(fill(&store, "vault-b", &[secret("github")]).is_err());
    assert_eq!(
        fill(&store, "vault-a", &[secret("github")]).unwrap().text,
        "ghp_A"
    );
}

#[test]
fn a_name_that_climbs_into_another_vaults_accounts_is_refused() {
    let store = store_with("vault-a", "github", "ghp_A");

    // Without the backstop, `../vault-a/github` from vault-b is only a string.
    assert!(fill(&store, "vault-b", &[secret("../vault-a/github")]).is_err());
    assert!(account("v", "a/b").is_err());
    assert!(account("v", "").is_err());
    assert!(account("v", ".hidden").is_err());
    assert!(account("v", &"a".repeat(65)).is_err());
    assert_eq!(account("v", "google.cal_2-x").unwrap(), "v/google.cal_2-x");
}

#[test]
fn a_template_is_described_by_its_references_never_its_values() {
    let parts = [text("https://x.test/"), secret("key"), text("/feed")];

    assert_eq!(describe(&parts), "https://x.test/{{secret:key}}/feed");
}

#[test]
fn every_secret_that_went_out_is_struck_from_what_came_back() {
    let used = vec![
        ("github".to_string(), "ghp_TOKEN".to_string()),
        ("other".to_string(), "s3cr3t".to_string()),
    ];

    let redacted = redact("auth: Bearer ghp_TOKEN; again ghp_TOKEN; s3cr3t", &used);

    assert!(!redacted.contains("ghp_TOKEN"));
    assert!(!redacted.contains("s3cr3t"));
    assert_eq!(
        redacted,
        "auth: Bearer [secret github removed]; again [secret github removed]; [secret other removed]"
    );
}

#[test]
fn an_empty_value_strikes_nothing() {
    let used = vec![("blank".to_string(), String::new())];
    assert_eq!(redact("left alone", &used), "left alone");
}

#[test]
fn the_listing_holds_this_vaults_names_only() {
    let store = MemoryStore::default();
    store.set("v1/zeta", "z").unwrap();
    store.set("v1/github", "ghp_TOKEN").unwrap();
    store.set("v2/other", "o").unwrap();

    let names = names_in(store.accounts().unwrap(), "v1");

    assert_eq!(names, vec!["github", "zeta"]);
    assert!(names.iter().all(|name| !name.contains("ghp_TOKEN")));
}

#[test]
fn a_vault_is_scoped_by_its_path_and_the_same_path_gives_the_same_scope() {
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();

    assert_eq!(vault_scope(first.path()), vault_scope(first.path()));
    assert_ne!(vault_scope(first.path()), vault_scope(second.path()));
    assert_eq!(vault_scope(first.path()).len(), 16);
    // A path that no longer exists still has a scope, rather than an error.
    assert_eq!(vault_scope(Path::new("/nowhere/at/all")).len(), 16);
}

#[test]
fn deleting_a_secret_that_is_not_there_is_not_an_error() {
    let store = MemoryStore::default();
    assert!(store.delete("v1/github").is_ok());
    assert_eq!(store.get("v1/github").unwrap(), None);
}

/// Adversarial (P12-06). Two secrets where one value contains the other: the
/// shorter is struck first and breaks up the longer, whose remainder is then
/// handed back in the clear.
#[test]
fn a_secret_containing_another_secret_is_struck_whole() {
    let used = vec![
        ("short".to_string(), "tok_1234".to_string()),
        ("long".to_string(), "tok_1234_PRIVATE_TAIL".to_string()),
    ];

    let redacted = redact("echo: tok_1234_PRIVATE_TAIL", &used);

    assert!(!redacted.contains("PRIVATE_TAIL"), "{redacted}");
}

fn struck(text: &str, value: &str) -> String {
    redact(text, &[("key".to_string(), value.to_string())])
}

#[test]
fn a_secret_echoed_percent_encoded_in_lower_case_is_struck() {
    assert_eq!(
        struck("next=a%2fb%2bc", "a/b+c"),
        "next=[secret key removed]"
    );
}

#[test]
fn a_secret_echoed_with_only_some_characters_encoded_is_struck() {
    assert_eq!(
        struck("next=aB3%2BdE6/gH9%3d&x=1", "aB3+dE6/gH9="),
        "next=[secret key removed]&x=1"
    );
}

#[test]
fn a_secret_echoed_json_escaped_is_struck() {
    assert_eq!(
        struck(r#"{"sent":"pa\"ss\\w\/rd"}"#, r#"pa"ss\w/rd"#),
        r#"{"sent":"[secret key removed]"}"#
    );
}

#[test]
fn a_secret_echoed_as_base64_is_struck() {
    // "hunter2-token" in standard base64, padded, then URL-safe and unpadded.
    let redacted = struck(
        "std=aHVudGVyMi10b2tlbg== url=aHVudGVyMi10b2tlbg",
        "hunter2-token",
    );

    assert!(!redacted.contains("aHVudGVyMi10b2tlbg"), "{redacted}");
    assert!(
        redacted.starts_with("std=[secret key removed]"),
        "{redacted}"
    );
}

/// The padding is struck with the rest, in both alphabets, rather than left
/// beside the strike to say how long the secret was.
#[test]
fn a_secret_echoed_as_padded_base64_is_struck_with_its_padding() {
    let secret = "hunter2-token~";
    for echo in ["aHVudGVyMi10b2tlbn4=", "aHVudGVyMi10b2tlbn4%3D"] {
        assert_eq!(
            struck(&format!("sent={echo};"), secret),
            "sent=[secret key removed];",
            "{echo}"
        );
    }
}

/// A secret sent inside a longer value — `Bearer <key>`, `user:<key>` — sits at
/// any byte offset of what is base64-encoded, and each offset modulo 3 encodes
/// it as different text. Every alignment is struck, in both alphabets, however
/// the value around it begins and ends.
#[test]
fn a_secret_echoed_as_base64_at_any_offset_in_either_alphabet_is_struck() {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE};
    use base64::Engine;
    // `~` and `?` put `+` and `/` (`-` and `_` in the URL-safe alphabet) into
    // every alignment, so the two alphabets differ.
    let secret = "tok~~~???~~~???~~~end";
    for prefix in ["", "B", "Be", "Bearer "] {
        for engine in [STANDARD, URL_SAFE] {
            let echo = engine.encode(format!("{prefix}{secret}\""));
            let alphabet_matters = echo != STANDARD.encode(format!("{prefix}{secret}\""))
                || echo != URL_SAFE.encode(format!("{prefix}{secret}\""));
            assert!(alphabet_matters, "{echo} reads the same in both alphabets");

            let redacted = struck(&format!("echo={echo};"), secret);

            let (before, after) = redacted
                .strip_prefix("echo=")
                .and_then(|rest| rest.split_once("[secret key removed]"))
                .unwrap_or_else(|| panic!("{prefix:?}: {echo} was not struck: {redacted}"));
            // What is left is the prefix's own characters and the few that
            // share a byte with what follows the secret: never a run of it.
            assert!(before.len() <= 4 * prefix.len().div_ceil(3), "{redacted}");
            assert!(after.len() <= "Ig==;".len(), "{redacted}");
        }
    }
}

/// An encoder is free to escape a letter or a digit too: `\u0067` is `g` to a
/// JSON parser and `%67` is `g` to a URL decoder, in either case of hex.
#[test]
fn a_secret_echoed_with_letters_and_digits_escaped_is_struck() {
    for echo in [
        r"\u0067\u0072\u006e\u005f\u0031",
        r"\u0067\u0072\u006E\u005F\u0031",
        "%67%72%6E%5F%31",
        "%67%72%6e%5f%31",
        "g%72n%5F1",
    ] {
        assert_eq!(
            struck(&format!("sent={echo}&"), "grn_1"),
            "sent=[secret key removed]&",
            "{echo}"
        );
    }
}

// Host binding (A19-01).

fn owned(origins: &[&str]) -> Vec<String> {
    origins.iter().map(|origin| origin.to_string()).collect()
}

/// Writes to vault `v1`, answering any question about widening with `allow`.
fn write(
    store: &MemoryStore,
    name: &str,
    value: Option<&str>,
    origins: Option<&[&str]>,
    allow: bool,
) -> Result<(), String> {
    let origins = origins.map(owned);
    let write = SecretWrite {
        scope: "v1",
        name,
        value,
        origins: origins.as_deref(),
    };
    write_secret(store, &write, &|_: &str, _: &[String]| allow)
}

#[test]
fn a_secret_is_bound_to_the_origins_it_was_set_for_written_canonically() {
    let store = MemoryStore::default();

    write(
        &store,
        "github",
        Some("ghp_TOKEN"),
        Some(&["https://API.github.com:443/", "https://ghe.test:8443"]),
        false,
    )
    .unwrap();

    assert_eq!(
        bound_origins(&store, "v1", "github").unwrap(),
        vec!["https://api.github.com", "https://ghe.test:8443"]
    );
}

#[test]
fn an_origin_that_is_not_a_bare_https_origin_is_refused() {
    let store = MemoryStore::default();
    for origin in [
        "http://api.test",
        "https://api.test/repos",
        "https://api.test/?q=1",
        "https://api.test/#x",
        "https://me@api.test",
        "api.test",
        "",
    ] {
        let outcome = write(&store, "k", Some("v"), Some(&[origin]), true);
        assert!(outcome.is_err(), "{origin:?} was accepted");
    }
    assert!(write(&store, "k", Some("v"), Some(&[]), true).is_err());
    assert_eq!(
        store.get("v1/k").unwrap(),
        None,
        "a refused write stored the value"
    );
}

#[test]
fn a_secret_that_holds_a_value_is_only_sent_somewhere_new_once_that_is_allowed() {
    let store = MemoryStore::default();
    write(
        &store,
        "github",
        Some("ghp_TOKEN"),
        Some(&["https://api.test"]),
        false,
    )
    .unwrap();

    let refused = write(&store, "github", None, Some(&["https://evil.test"]), false);

    assert!(refused.is_err());
    assert_eq!(
        bound_origins(&store, "v1", "github").unwrap(),
        vec!["https://api.test"]
    );

    write(&store, "github", None, Some(&["https://evil.test"]), true).unwrap();
    assert_eq!(
        bound_origins(&store, "v1", "github").unwrap(),
        vec!["https://evil.test"]
    );
}

#[test]
fn narrowing_a_binding_or_setting_a_new_value_asks_nothing() {
    let store = MemoryStore::default();
    write(
        &store,
        "k",
        Some("v"),
        Some(&["https://a.test", "https://b.test"]),
        false,
    )
    .unwrap();

    write(&store, "k", None, Some(&["https://a.test"]), false).unwrap();
    // A value of the caller's own, typed now, may go wherever it is told.
    write(&store, "k", Some("v2"), Some(&["https://c.test"]), false).unwrap();

    assert_eq!(
        bound_origins(&store, "v1", "k").unwrap(),
        vec!["https://c.test"]
    );
    assert_eq!(store.get("v1/k").unwrap().as_deref(), Some("v2"));
}

#[test]
fn replacing_a_value_without_origins_keeps_the_binding() {
    let store = MemoryStore::default();
    write(&store, "k", Some("v"), Some(&["https://a.test"]), false).unwrap();

    write(&store, "k", Some("v2"), None, false).unwrap();

    assert_eq!(
        bound_origins(&store, "v1", "k").unwrap(),
        vec!["https://a.test"]
    );
}

#[test]
fn a_secret_that_is_not_set_cannot_be_bound() {
    let store = MemoryStore::default();

    let error = write(&store, "ghost", None, Some(&["https://a.test"]), true).unwrap_err();

    assert_eq!(error, "the secret \"ghost\" is not set for this vault");
}

#[test]
fn the_listing_names_each_secret_with_its_origins_and_nothing_else() {
    let store = MemoryStore::default();
    write(
        &store,
        "github",
        Some("ghp_TOKEN"),
        Some(&["https://api.test"]),
        false,
    )
    .unwrap();
    store.set("v1/legacy", "old").unwrap();
    store.set("v2/other", "o").unwrap();

    let listed = entries_in(&store, "v1").unwrap();

    let summary: Vec<(String, Vec<String>)> = listed
        .into_iter()
        .map(|entry| (entry.name, entry.origins))
        .collect();
    assert_eq!(
        summary,
        vec![
            ("github".to_string(), owned(&["https://api.test"])),
            ("legacy".to_string(), vec![]),
        ]
    );
}

#[test]
fn removing_a_secret_removes_its_binding() {
    let store = MemoryStore::default();
    write(&store, "k", Some("v"), Some(&["https://a.test"]), false).unwrap();

    remove_secret(&store, "v1", "k").unwrap();

    assert_eq!(store.accounts().unwrap(), Vec::<String>::new());
}

#[test]
fn a_name_starts_with_a_letter_or_digit_as_typescript_says() {
    assert!(account("v", "_x").is_err());
    assert!(account("v", "-x").is_err());
    assert!(account("v", "x_-.1").is_ok());
}

#[test]
fn text_that_only_resembles_a_secret_is_left_alone() {
    // The same letters, with `-` where the secret has `+`.
    assert_eq!(struck("aB3-dE6", "aB3+dE6"), "aB3-dE6");
}

/// Every character of a secret may be escaped, so its pattern grows with it;
/// a long secret of the printable characters whose pattern is largest is
/// still looked for rather than the answer withheld as unchecked.
#[test]
fn a_long_secret_is_struck_rather_than_the_answer_withheld() {
    let secret = drawn_from(&(b' '..=b'~').map(char::from).collect::<Vec<_>>(), 1_024);
    assert_eq!(
        struck(&format!("echo={secret};"), &secret),
        "echo=[secret key removed];"
    );
}

/// `len` characters drawn from `alphabet` in no order, the same each time.
fn drawn_from(alphabet: &[char], len: usize) -> String {
    let mut seed = 1u64;
    (0..len)
        .map(|_| {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            alphabet[(seed >> 33) as usize % alphabet.len()]
        })
        .collect()
}

/// `len` bytes of what a signed token (a JWT) is written in: base64url's
/// letters, digits, `-` and `_`, and the `.` between its parts.
pub(crate) fn a_signed_token(len: usize) -> String {
    let alphabet: Vec<char> = ('A'..='Z')
        .chain('a'..='z')
        .chain('0'..='9')
        .chain(['-', '_', '.'])
        .collect();
    drawn_from(&alphabet, len)
}

/// Past the 1,024 bytes DFAI once capped a secret at: a signed token is
/// kept, and struck from what comes back.
#[test]
fn a_signed_token_of_some_kilobytes_is_kept_and_struck() {
    let store = MemoryStore::default();
    let token = a_signed_token(2_700);

    write(
        &store,
        "jwt",
        Some(&token),
        Some(&["https://a.test"]),
        false,
    )
    .unwrap();

    assert_eq!(
        store.get("v1/jwt").unwrap().as_deref(),
        Some(token.as_str())
    );
    assert_eq!(
        struck(&format!("echo={token};"), &token),
        "echo=[secret key removed];"
    );
}

#[test]
fn a_secret_too_long_to_protect_is_refused_and_not_stored() {
    let store = MemoryStore::default();
    let too_long = a_signed_token(8 * 1024);

    let refused = write(
        &store,
        "k",
        Some(&too_long),
        Some(&["https://a.test"]),
        false,
    );

    assert_eq!(
        refused.unwrap_err(),
        "the secret \"k\" is too long to protect: DFAI could not strike it from what comes back, so it is not kept"
    );
    assert_eq!(store.accounts().unwrap(), Vec::<String>::new());
}

/// Base64 is looked for from eight characters on: shorter, its text is too
/// little to tell from the rest of an answer.
#[test]
fn a_secret_is_looked_for_as_base64_from_eight_characters_on() {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    let (seven, eight) = ("pin-123", "pin-1234");

    assert_eq!(
        struck(&STANDARD.encode(seven), seven),
        STANDARD.encode(seven)
    );
    assert_eq!(
        struck(&STANDARD.encode(eight), eight),
        "[secret key removed]"
    );
}

/// A secret too short to be told from text by its base64 is looked for as
/// itself and its escapes only.
#[test]
fn a_one_character_secret_is_struck_where_it_appears() {
    assert_eq!(struck("a-b", "a"), "[secret key removed]-b");
}

/// Adversarial (P28-10 fix). A server that puts the request URL inside
/// another URL's query — `return_to`, `login_url`, `redirect` — encodes it
/// twice, so a `+` the secret held reaches the answer as `%252B`. Each
/// character is matched as itself, `%XX` or `\uXXXX`, never `%25XX`, so the
/// letters and digits match and the rest do not: the whole secret is in the
/// answer, two URL decodes from the clear.
#[test]
fn a_secret_echoed_percent_encoded_twice_is_struck() {
    let secret = "aB3+dE6/gH9=";
    let echo = r#"{"login_url":"https://feeds.example/login?return_to=https%3A%2F%2Ffeeds.example%2Fcal%3Ftoken%3DaB3%252BdE6%252FgH9%253D"}"#;

    let redacted = struck(echo, secret);

    assert!(
        redacted.contains("[secret key removed]"),
        "the secret survives as aB3%252BdE6%252FgH9%253D: {redacted}"
    );
}

/// Adversarial (P28-10 fix). A server that rebuilds a `next` link with form
/// encoding (Python's `urlencode`, Java's `URLEncoder`) writes a space as `+`.
/// A secret holding a space is matched against ` `, `%20` and ` ` only.
#[test]
fn a_secret_echoed_form_encoded_with_plus_for_space_is_struck() {
    let secret = "correct horse battery staple";

    let redacted = struck(
        "next=/feed?page=2&pass=correct+horse+battery+staple",
        secret,
    );

    assert_eq!(redacted, "next=/feed?page=2&pass=[secret key removed]");
}

/// Adversarial (P28-10 fix). The base64 "cores" of a one- or two-byte secret
/// are one or two characters long, and are struck wherever they occur in the
/// answer: a secret of `a` strikes every `Y`, one of `ab` every `Fi`. Text
/// that is not the secret in any form is changed, and the answer the webview
/// reads is corrupted.
#[test]
fn a_short_secret_strikes_only_itself_and_not_text_its_base64_shares() {
    assert_eq!(struck("Yes", "a"), "Yes");
    assert_eq!(struck("Final", "ab"), "Final");
}

/// Uses eight values no test keeps. The redactor holds the matchers of the
/// eight values used most recently, so any value used before these is no
/// longer among them, whatever other tests use meanwhile.
pub(crate) fn use_eight_other_values() {
    for n in 0..8 {
        super::ensure_strikable(&format!("grn_Displacing{n}")).unwrap();
    }
}

/// Runs `work` and checks it built a matcher, and built none on this
/// thread — the async worker every other command shares — but on a thread
/// kept for blocking work. Counted, not timed: a loaded machine slows both
/// alike, and a build on the worker is caught however quick it was (#403).
pub(crate) async fn assert_never_stalls_the_worker<T>(work: impl Future<Output = T>) -> T {
    let on_this_thread = || super::redact::BUILT_ON_THIS_THREAD.with(std::cell::Cell::get);
    let anywhere = || super::redact::BUILT_ANYWHERE.load(std::sync::atomic::Ordering::SeqCst);
    let (worker_before, anywhere_before) = (on_this_thread(), anywhere());
    let done = work.await;
    assert_eq!(
        on_this_thread() - worker_before,
        0,
        "a matcher was built on the async worker"
    );
    // Other tests build meanwhile, so this only shows the work built at all.
    assert!(anywhere() > anywhere_before, "the work built no matcher");
    done
}

/// Adversarial (P28-10 round 3, after 0d51773), rewritten for round 4. The
/// matcher is built before anything else about the write is checked, and
/// held whether or not the value is then kept: a write refused for its
/// origins (or a Keychain that would not take it) leaves a matcher spelling a
/// value DFAI never kept. That is accepted, within a bound: it is let go
/// once eight other values have been used.
#[test]
fn a_secret_refused_at_saving_is_let_go_once_eight_other_values_are_used() {
    let store = MemoryStore::default();
    let (name, value) = ("larkspur-refused-token", "grn_RefusedLarkspurValue");

    let refused = write(
        &store,
        name,
        Some(value),
        Some(&["http://plain.test"]),
        true,
    );
    assert!(refused.is_err());
    assert!(store.accounts().unwrap().is_empty(), "the value was kept");

    use_eight_other_values();

    assert!(
        !super::holds_matcher(value),
        "the refused value's matcher outlived eight others"
    );
}
