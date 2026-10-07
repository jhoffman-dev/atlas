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
