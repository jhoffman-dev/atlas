//! Every test here runs against folders made in a temporary directory and
//! secret stores in memory: never the real `~/Library` or the real Keychain.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use super::{
    copy_folder_once, copy_secrets, folders_under, migrate, Copied, FolderPair, Migration,
    IDENTIFIER, LEGACY_IDENTIFIER,
};
use crate::secrets::{MemoryStore, SecretStore};

fn pair(root: &Path) -> FolderPair {
    FolderPair {
        from: root.join("old"),
        to: root.join("new"),
    }
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

fn store_with(entries: &[(&str, &str)]) -> MemoryStore {
    let store = MemoryStore::default();
    for (account, value) in entries {
        store.set(account, value).unwrap();
    }
    store
}

/// A store whose reads of one account fail, as a Keychain item does when the
/// person denies access to it.
struct DeniesOne {
    inner: MemoryStore,
    denied: &'static str,
}

impl SecretStore for DeniesOne {
    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        self.inner.set(account, value)
    }
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        if account == self.denied {
            return Err("the keychain refused access".into());
        }
        self.inner.get(account)
    }
    fn delete(&self, account: &str) -> Result<(), String> {
        self.inner.delete(account)
    }
    fn accounts(&self) -> Result<Vec<String>, String> {
        self.inner.accounts()
    }
}

#[test]
fn copies_the_old_folder_when_the_new_one_is_missing() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("vault.json"), r#"{"absolutePath":"/v"}"#);
    write(&folders.from.join("activity/2026-10.jsonl"), "line\n");
    write(&folders.from.join("api.json"), r#"{"port":1}"#);
    fs::set_permissions(
        folders.from.join("api.json"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();

    assert_eq!(copy_folder_once(&folders).unwrap(), Copied::Folder);

    assert_eq!(
        read(&folders.to.join("vault.json")),
        r#"{"absolutePath":"/v"}"#
    );
    assert_eq!(read(&folders.to.join("activity/2026-10.jsonl")), "line\n");
    let mode = fs::metadata(folders.to.join("api.json"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o600, "the token file stays owner-only");
}

#[test]
fn never_deletes_or_changes_the_old_folder() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("vault.json"), "old");

    copy_folder_once(&folders).unwrap();
    write(&folders.to.join("vault.json"), "changed in the new app");

    assert_eq!(read(&folders.from.join("vault.json")), "old");
}

#[test]
fn leaves_a_new_folder_that_already_exists_as_it_is() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("vault.json"), "old");
    write(&folders.from.join("only-in-old.json"), "old");
    write(&folders.to.join("vault.json"), "newer");

    assert_eq!(copy_folder_once(&folders).unwrap(), Copied::AlreadyThere);

    assert_eq!(read(&folders.to.join("vault.json")), "newer");
    assert!(
        !folders.to.join("only-in-old.json").exists(),
        "nothing is merged into a folder the new app already has"
    );
}

#[test]
fn copies_nothing_and_makes_nothing_when_there_is_no_old_folder() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());

    assert_eq!(copy_folder_once(&folders).unwrap(), Copied::NothingThere);

    assert!(!folders.to.exists());
}

#[test]
fn a_second_run_changes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("vault.json"), "old");

    copy_folder_once(&folders).unwrap();
    write(&folders.to.join("vault.json"), "newer");
    write(
        &folders.from.join("vault.json"),
        "old, changed by the old app",
    );

    assert_eq!(copy_folder_once(&folders).unwrap(), Copied::AlreadyThere);
    assert_eq!(read(&folders.to.join("vault.json")), "newer");
}

#[test]
fn a_failed_copy_leaves_no_half_made_folder_and_the_next_launch_copies() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("a.json"), "a");
    let locked = folders.from.join("locked.json");
    write(&locked, "b");
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();

    let failed = copy_folder_once(&folders);
    fs::set_permissions(&locked, fs::Permissions::from_mode(0o600)).unwrap();

    assert!(failed.is_err());
    assert!(!folders.to.exists(), "a failed copy is not left half done");
    let siblings: Vec<_> = fs::read_dir(root.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(siblings, vec!["old"], "its staging folder is gone too");

    assert_eq!(copy_folder_once(&folders).unwrap(), Copied::Folder);
    assert_eq!(read(&folders.to.join("locked.json")), "b");
}

#[test]
fn a_staging_folder_left_by_a_crash_is_started_again() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("vault.json"), "old");
    write(&root.path().join("new.migrating/half.json"), "half");

    assert_eq!(copy_folder_once(&folders).unwrap(), Copied::Folder);

    assert_eq!(read(&folders.to.join("vault.json")), "old");
    assert!(!folders.to.join("half.json").exists());
    assert!(!root.path().join("new.migrating").exists());
}

#[test]
fn a_link_is_copied_as_a_link() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("real.json"), "x");
    std::os::unix::fs::symlink("real.json", folders.from.join("link.json")).unwrap();

    copy_folder_once(&folders).unwrap();

    let link = fs::read_link(folders.to.join("link.json")).unwrap();
    assert_eq!(link, Path::new("real.json"));
}

#[test]
fn the_folders_moved_are_the_app_support_and_webkit_ones() {
    let home = Path::new("/Users/sam");

    let folders = folders_under(home);

    let support = home.join("Library/Application Support");
    let webkit = home.join("Library/WebKit");
    assert_eq!(
        folders,
        vec![
            FolderPair {
                from: support.join(LEGACY_IDENTIFIER),
                to: support.join(IDENTIFIER),
            },
            FolderPair {
                from: webkit.join(LEGACY_IDENTIFIER),
                to: webkit.join(IDENTIFIER),
            },
            FolderPair {
                from: webkit.join("atlas"),
                to: webkit.join("dfai"),
            },
        ]
    );
    assert_eq!(IDENTIFIER, "com.dailyflowai.dfai");
    assert_eq!(LEGACY_IDENTIFIER, "dev.jhoffman.atlas");
}

#[test]
fn copies_every_old_secret_to_the_new_service() {
    let old = store_with(&[("v1/github", "ghp_A"), ("v1:oauth/google", "refresh")]);
    let new = MemoryStore::default();

    let copied = copy_secrets(&old, &new).unwrap();

    assert_eq!(copied.copied, 2);
    assert_eq!(new.get("v1/github").unwrap().as_deref(), Some("ghp_A"));
    assert_eq!(
        new.get("v1:oauth/google").unwrap().as_deref(),
        Some("refresh")
    );
}

#[test]
fn never_overwrites_a_secret_the_new_service_already_has() {
    let old = store_with(&[("v1/github", "old token")]);
    let new = store_with(&[("v1/github", "newer token")]);

    let copied = copy_secrets(&old, &new).unwrap();

    assert_eq!(copied.copied, 0);
    assert_eq!(copied.already_there, 1);
    assert_eq!(
        new.get("v1/github").unwrap().as_deref(),
        Some("newer token")
    );
}

#[test]
fn never_removes_the_old_secrets() {
    let old = store_with(&[("v1/github", "ghp_A")]);
    let new = MemoryStore::default();

    copy_secrets(&old, &new).unwrap();

    assert_eq!(old.get("v1/github").unwrap().as_deref(), Some("ghp_A"));
}

#[test]
fn a_secret_that_cannot_be_read_is_named_and_the_rest_still_copy() {
    let old = DeniesOne {
        inner: store_with(&[("v1/github", "ghp_A"), ("v1/linear", "lin_B")]),
        denied: "v1/github",
    };
    let new = MemoryStore::default();

    let copied = copy_secrets(&old, &new).unwrap();

    assert_eq!(copied.copied, 1);
    assert_eq!(copied.failed, vec!["v1/github".to_string()]);
    assert_eq!(new.get("v1/linear").unwrap().as_deref(), Some("lin_B"));
    assert_eq!(new.get("v1/github").unwrap(), None);
}

#[test]
fn a_failure_never_puts_a_value_into_words() {
    let old = DeniesOne {
        inner: store_with(&[("v1/github", "ghp_SECRET")]),
        denied: "v1/github",
    };
    let home = tempfile::tempdir().unwrap();

    let said = migrate(&Migration {
        home: home.path(),
        legacy_secrets: &old,
        secrets: &MemoryStore::default(),
    });

    assert!(said.iter().all(|line| !line.contains("ghp_SECRET")));
}

fn support(home: &Path, identifier: &str) -> std::path::PathBuf {
    home.join("Library/Application Support").join(identifier)
}

#[test]
fn a_launch_copies_folders_and_secrets() {
    let home = tempfile::tempdir().unwrap();
    write(
        &support(home.path(), LEGACY_IDENTIFIER).join("vault.json"),
        "v",
    );
    write(
        &home
            .path()
            .join("Library/WebKit/atlas/WebsiteData/LocalStorage/x.sqlite3"),
        "ls",
    );
    let old = store_with(&[("v1/github", "ghp_A")]);
    let new = MemoryStore::default();

    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &old,
        secrets: &new,
    });

    assert_eq!(
        read(&support(home.path(), IDENTIFIER).join("vault.json")),
        "v"
    );
    assert_eq!(
        read(
            &home
                .path()
                .join("Library/WebKit/dfai/WebsiteData/LocalStorage/x.sqlite3")
        ),
        "ls"
    );
    assert_eq!(new.get("v1/github").unwrap().as_deref(), Some("ghp_A"));
}

#[test]
fn secrets_are_copied_once_so_one_removed_in_the_new_app_stays_removed() {
    let home = tempfile::tempdir().unwrap();
    let old = store_with(&[("v1/github", "ghp_A")]);
    let new = MemoryStore::default();
    let migration = Migration {
        home: home.path(),
        legacy_secrets: &old,
        secrets: &new,
    };

    migrate(&migration);
    new.delete("v1/github").unwrap();
    migrate(&migration);

    assert_eq!(new.get("v1/github").unwrap(), None);
}

#[test]
fn a_secret_that_failed_is_tried_again_on_the_next_launch() {
    let home = tempfile::tempdir().unwrap();
    let denied = DeniesOne {
        inner: store_with(&[("v1/github", "ghp_A")]),
        denied: "v1/github",
    };
    let new = MemoryStore::default();

    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &denied,
        secrets: &new,
    });

    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &denied.inner,
        secrets: &new,
    });
    assert_eq!(new.get("v1/github").unwrap().as_deref(), Some("ghp_A"));
}

#[test]
fn a_first_install_with_nothing_old_copies_nothing() {
    let home = tempfile::tempdir().unwrap();
    let new = MemoryStore::default();

    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &MemoryStore::default(),
        secrets: &new,
    });

    assert!(new.accounts().unwrap().is_empty());
    assert!(!home.path().join("Library/WebKit/dfai").exists());
}

#[test]
fn the_identifier_is_the_one_the_app_is_bundled_with() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();

    assert_eq!(config["identifier"], IDENTIFIER);
}

// --- Adversarial tests for PR #485 (attack-485). Each names the invariant it holds the migration to.

/// Makes `path` unreadable for the length of a test, and readable again after,
/// so the temp folder can always be removed.
struct Unreadable<'a>(&'a Path, u32);

impl<'a> Unreadable<'a> {
    fn new(path: &'a Path, restore: u32) -> Self {
        fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
        Self(path, restore)
    }
}

impl Drop for Unreadable<'_> {
    fn drop(&mut self) {
        let _ = fs::set_permissions(self.0, fs::Permissions::from_mode(self.1));
    }
}

#[test]
fn attack_485_a_failed_app_support_copy_is_retried_even_though_the_secrets_copied() {
    let home = tempfile::tempdir().unwrap();
    let old_support = support(home.path(), LEGACY_IDENTIFIER);
    write(&old_support.join("vault.json"), r#"{"absolutePath":"/v"}"#);
    let locked = old_support.join("grants.json");
    write(&locked, "g");
    let old = store_with(&[("v1/github", "ghp_A")]);
    let new = MemoryStore::default();
    let migration = Migration {
        home: home.path(),
        legacy_secrets: &old,
        secrets: &new,
    };

    {
        let _locked = Unreadable::new(&locked, 0o600);
        migrate(&migration);
    }
    // The file is readable again: the next launch should finish the copy.
    migrate(&migration);

    assert_eq!(
        fs::read_to_string(support(home.path(), IDENTIFIER).join("vault.json")).ok(),
        Some(r#"{"absolutePath":"/v"}"#.to_string()),
        "the secrets' marker made the new app-support folder, so the failed folder copy was never retried"
    );
}

#[test]
fn attack_485_a_failed_folder_copy_is_not_forgotten_once_the_app_has_made_its_folder() {
    let home = tempfile::tempdir().unwrap();
    let old_webkit = home.path().join("Library/WebKit").join(LEGACY_IDENTIFIER);
    let locked = old_webkit.join("WebsiteData/LocalStorage/localstorage.sqlite3");
    write(&locked, "sync id");
    let none = MemoryStore::default();
    let migration = Migration {
        home: home.path(),
        legacy_secrets: &none,
        secrets: &none,
    };

    let first = {
        let _locked = Unreadable::new(&locked, 0o600);
        migrate(&migration)
    };
    assert!(
        !first.is_empty(),
        "the first launch reports the failed copy"
    );
    // The app then starts as usual and WebKit files fresh, empty storage.
    write(
        &home
            .path()
            .join("Library/WebKit")
            .join(IDENTIFIER)
            .join("WebsiteData/LocalStorage/localstorage.sqlite3"),
        "",
    );
    let second = migrate(&migration);

    let copied = fs::read_to_string(
        home.path()
            .join("Library/WebKit")
            .join(IDENTIFIER)
            .join("WebsiteData/LocalStorage/localstorage.sqlite3"),
    )
    .unwrap();
    assert!(
        copied == "sync id" || !second.is_empty(),
        "a copy that failed is neither retried nor reported again: Atlas's storage is silently dropped"
    );
}

#[test]
fn attack_485_a_secret_removed_in_dfai_stays_removed_while_another_is_still_denied() {
    let home = tempfile::tempdir().unwrap();
    let denied = DeniesOne {
        inner: store_with(&[("v1/github", "ghp_A"), ("v1/openai", "sk_B")]),
        denied: "v1/openai",
    };
    let new = MemoryStore::default();
    let migration = Migration {
        home: home.path(),
        legacy_secrets: &denied,
        secrets: &new,
    };

    migrate(&migration);
    assert_eq!(new.get("v1/github").unwrap().as_deref(), Some("ghp_A"));
    new.delete("v1/github").unwrap();
    migrate(&migration);

    assert_eq!(
        new.get("v1/github").unwrap(),
        None,
        "the person removed it in DFAI, and the retry for the denied item brought it back"
    );
}

#[test]
fn attack_485_a_leftover_staging_folder_holding_a_read_only_folder_does_not_block_the_copy() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("vault.json"), "old");
    // What a crashed copy leaves when it had finished a read-only folder:
    // `copy_tree` sets a folder's permissions after filling it.
    let read_only = root.path().join("new.migrating/model");
    write(&read_only.join("weights.bin"), "w");
    fs::set_permissions(&read_only, fs::Permissions::from_mode(0o500)).unwrap();

    let copied = copy_folder_once(&folders);
    let _ = fs::set_permissions(&read_only, fs::Permissions::from_mode(0o700));

    assert_eq!(
        copied,
        Ok(Copied::Folder),
        "a staging folder the next launch cannot clear blocks the migration on every launch"
    );
}

#[test]
fn attack_485_an_old_folder_that_is_a_link_is_copied_so_dfai_never_writes_into_atlas() {
    let root = tempfile::tempdir().unwrap();
    let real = root.path().join("elsewhere");
    write(&real.join("vault.json"), "old");
    let folders = pair(root.path());
    std::os::unix::fs::symlink(&real, &folders.from).unwrap();

    copy_folder_once(&folders).unwrap();

    assert!(
        !fs::symlink_metadata(&folders.to)
            .unwrap()
            .file_type()
            .is_symlink(),
        "the new folder is a link to Atlas's data, so every DFAI write changes Atlas's copy"
    );
}

#[test]
fn attack_485_a_link_loop_inside_the_old_folder_is_copied_as_links_and_ends() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("vault.json"), "old");
    std::os::unix::fs::symlink("b", folders.from.join("a")).unwrap();
    std::os::unix::fs::symlink("a", folders.from.join("b")).unwrap();
    std::os::unix::fs::symlink(".", folders.from.join("self")).unwrap();

    assert_eq!(copy_folder_once(&folders).unwrap(), Copied::Folder);
    assert_eq!(read(&folders.to.join("vault.json")), "old");
    assert_eq!(
        fs::read_link(folders.to.join("self")).unwrap(),
        Path::new(".")
    );
}

#[test]
fn attack_485_many_files_in_deep_folders_all_arrive() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    for at in 0..2000 {
        write(
            &folders
                .from
                .join(format!("d{}/e{}/f{at}.json", at % 7, at % 13)),
            &at.to_string(),
        );
    }
    let deep = (0..60).fold(folders.from.clone(), |path, at| path.join(format!("n{at}")));
    write(&deep.join("leaf"), "leaf");

    assert_eq!(copy_folder_once(&folders).unwrap(), Copied::Folder);
    assert_eq!(read(&folders.to.join("d4/e10/f1999.json")), "1999");
    let copied_deep = (0..60).fold(folders.to.clone(), |path, at| path.join(format!("n{at}")));
    assert_eq!(read(&copied_deep.join("leaf")), "leaf");
}

#[test]
fn attack_485_an_unreadable_old_folder_fails_loudly_and_makes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let folders = pair(root.path());
    write(&folders.from.join("sub/vault.json"), "old");
    let sub = folders.from.join("sub");

    let copied = {
        let _locked = Unreadable::new(&sub, 0o700);
        copy_folder_once(&folders)
    };

    assert!(copied.is_err());
    assert!(!folders.to.exists());
    assert!(!root.path().join("new.migrating").exists());
}

// --- The fix round for PR #485: state outside the folders, set-aside, block, give-up.

fn state_of(home: &Path) -> serde_json::Value {
    serde_json::from_str(&read(
        &home.join("Library/Application Support/.dfai-rename-migration.json"),
    ))
    .unwrap()
}

#[test]
fn what_is_finished_is_kept_outside_every_folder_it_copies() {
    let home = tempfile::tempdir().unwrap();
    write(
        &support(home.path(), LEGACY_IDENTIFIER).join("vault.json"),
        "v",
    );

    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &MemoryStore::default(),
        secrets: &MemoryStore::default(),
    });

    let state = home
        .path()
        .join("Library/Application Support/.dfai-rename-migration.json");
    assert!(state.is_file());
    for pair in folders_under(home.path()) {
        assert!(!state.starts_with(&pair.to));
    }
    assert_eq!(
        state_of(home.path())["foldersDone"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
}

#[test]
fn a_new_folder_made_before_the_copy_is_set_aside_never_deleted() {
    let home = tempfile::tempdir().unwrap();
    let webkit = home.path().join("Library/WebKit");
    write(&webkit.join("atlas/LocalStorage/ls.sqlite3"), "sync id");
    write(
        &webkit.join("dfai/LocalStorage/ls.sqlite3"),
        "empty, from WebKit",
    );

    let outcome = migrate(&Migration {
        home: home.path(),
        legacy_secrets: &MemoryStore::default(),
        secrets: &MemoryStore::default(),
    });

    assert_eq!(
        read(&webkit.join("dfai/LocalStorage/ls.sqlite3")),
        "sync id"
    );
    assert_eq!(
        read(&webkit.join("dfai.pre-dfai-1/LocalStorage/ls.sqlite3")),
        "empty, from WebKit"
    );
    assert!(outcome.iter().any(|line| line.contains("aside")));
}

#[test]
fn a_folder_finished_once_is_never_set_aside_or_copied_again() {
    let home = tempfile::tempdir().unwrap();
    write(
        &support(home.path(), LEGACY_IDENTIFIER).join("vault.json"),
        "old",
    );
    let migration = Migration {
        home: home.path(),
        legacy_secrets: &MemoryStore::default(),
        secrets: &MemoryStore::default(),
    };

    migrate(&migration);
    write(
        &support(home.path(), IDENTIFIER).join("vault.json"),
        "newer",
    );
    migrate(&migration);

    assert_eq!(
        read(&support(home.path(), IDENTIFIER).join("vault.json")),
        "newer"
    );
    assert!(!home
        .path()
        .join("Library/Application Support")
        .join(format!("{IDENTIFIER}.pre-dfai-1"))
        .exists());
}

#[test]
fn a_failed_folder_copy_blocks_the_launch_skips_the_secrets_and_makes_no_new_folder() {
    let home = tempfile::tempdir().unwrap();
    let locked = support(home.path(), LEGACY_IDENTIFIER).join("grants.json");
    write(&locked, "g");
    let old = store_with(&[("v1/github", "ghp_A")]);
    let new = MemoryStore::default();

    let outcome = {
        let _locked = Unreadable::new(&locked, 0o600);
        migrate(&Migration {
            home: home.path(),
            legacy_secrets: &old,
            secrets: &new,
        })
    };

    assert!(outcome.blocked.is_some());
    assert_eq!(
        new.get("v1/github").unwrap(),
        None,
        "secrets wait for the folders"
    );
    assert!(!support(home.path(), IDENTIFIER).exists());
}

#[test]
fn a_secret_that_cannot_be_read_is_given_up_after_three_launches_and_told_once() {
    let home = tempfile::tempdir().unwrap();
    let denied = DeniesOne {
        inner: store_with(&[("v1/openai", "sk_B")]),
        denied: "v1/openai",
    };
    let new = MemoryStore::default();
    let migration = Migration {
        home: home.path(),
        legacy_secrets: &denied,
        secrets: &new,
    };

    let launches: Vec<_> = (0..4).map(|_| migrate(&migration).gave_up).collect();

    assert_eq!(
        launches,
        vec![vec![], vec![], vec!["v1/openai".to_string()], vec![]]
    );
    assert_eq!(
        state_of(home.path())["accounts"]["v1/openai"]["state"],
        "gaveUp"
    );
    // Readable now, but given up: it is not asked for again.
    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &denied.inner,
        secrets: &new,
    });
    assert_eq!(new.get("v1/openai").unwrap(), None);
}

#[test]
fn a_state_file_that_cannot_be_read_redoes_nothing() {
    let home = tempfile::tempdir().unwrap();
    write(
        &support(home.path(), LEGACY_IDENTIFIER).join("vault.json"),
        "old",
    );
    write(
        &support(home.path(), IDENTIFIER).join("vault.json"),
        "newer",
    );
    write(
        &home
            .path()
            .join("Library/Application Support/.dfai-rename-migration.json"),
        "{ not json",
    );
    let new = MemoryStore::default();

    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &store_with(&[("v1/github", "ghp_A")]),
        secrets: &new,
    });

    assert_eq!(
        read(&support(home.path(), IDENTIFIER).join("vault.json")),
        "newer"
    );
    assert_eq!(new.get("v1/github").unwrap(), None);
    assert_eq!(state_of(home.path())["keychainClosed"], true);
    assert!(home
        .path()
        .join("Library/Application Support/.dfai-rename-migration.json.pre-dfai-1")
        .is_file());
}

#[test]
fn the_report_in_dfais_folder_says_what_moved_and_never_a_value() {
    let home = tempfile::tempdir().unwrap();
    write(
        &support(home.path(), LEGACY_IDENTIFIER).join("vault.json"),
        "v",
    );
    let denied = DeniesOne {
        inner: store_with(&[("v1/github", "ghp_SECRET"), ("v1/linear", "lin_SECRET")]),
        denied: "v1/github",
    };

    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &denied,
        secrets: &MemoryStore::default(),
    });

    let report = read(&support(home.path(), IDENTIFIER).join(super::REPORT));
    assert!(report.contains("copied"));
    assert!(report.contains("v1/github"));
    assert!(!report.contains("SECRET"));
}

#[test]
fn a_folder_is_pending_only_while_atlas_has_one_not_yet_copied() {
    let home = tempfile::tempdir().unwrap();
    let migration = Migration {
        home: home.path(),
        legacy_secrets: &MemoryStore::default(),
        secrets: &MemoryStore::default(),
    };
    assert!(!super::folders_pending(home.path()));

    write(
        &support(home.path(), LEGACY_IDENTIFIER).join("vault.json"),
        "v",
    );
    assert!(super::folders_pending(home.path()));

    migrate(&migration);
    assert!(!super::folders_pending(home.path()));
}

#[test]
fn atlas_is_known_by_its_executable_not_by_any_tool_called_atlas() {
    use super::launch::is_atlas_executable;

    for atlas in [
        "/Applications/Atlas.app/Contents/MacOS/Atlas",
        "/Applications/Atlas.app/Contents/MacOS/atlas",
        "/Users/sam/atlas/apps/desktop/src-tauri/target/debug/atlas",
        "/Users/sam/atlas/apps/desktop/src-tauri/target/release/atlas",
    ] {
        assert!(is_atlas_executable(Path::new(atlas)), "{atlas}");
    }
    for other in [
        "/opt/homebrew/bin/atlas",
        "/Applications/DFAI.app/Contents/MacOS/DFAI",
        "/Users/sam/atlas/apps/desktop/src-tauri/target/debug/dfai",
        "/Applications/Atlas.app/Contents/MacOS/atlas-helper",
    ] {
        assert!(!is_atlas_executable(Path::new(other)), "{other}");
    }
}

#[test]
fn what_the_person_is_told_names_the_reason_and_what_to_do() {
    use super::launch::{blocked_message, gave_up_message, ATLAS_RUNNING};

    assert_eq!(
        blocked_message("could not copy x: Permission denied"),
        "DFAI couldn't move your Atlas data: could not copy x: Permission denied. Quit Atlas and open DFAI again."
    );
    assert_eq!(ATLAS_RUNNING, "Quit Atlas, then open DFAI again.");
    let gave_up = gave_up_message(&["v1/github".into()]);
    assert!(gave_up.contains("v1/github") && gave_up.contains("Settings → Secrets"));
}

#[test]
fn a_leftover_staging_folder_with_a_read_only_folder_is_cleared_in_a_full_launch() {
    let home = tempfile::tempdir().unwrap();
    write(
        &support(home.path(), LEGACY_IDENTIFIER).join("vault.json"),
        "v",
    );
    let staging = home
        .path()
        .join("Library/Application Support")
        .join(format!("{IDENTIFIER}.migrating"));
    let read_only = staging.join("model");
    write(&read_only.join("weights.bin"), "w");
    fs::set_permissions(&read_only, fs::Permissions::from_mode(0o500)).unwrap();

    let outcome = migrate(&Migration {
        home: home.path(),
        legacy_secrets: &MemoryStore::default(),
        secrets: &MemoryStore::default(),
    });

    assert!(outcome.blocked.is_none());
    assert!(!staging.exists());
    assert_eq!(
        read(&support(home.path(), IDENTIFIER).join("vault.json")),
        "v"
    );
}

// --- Verification tests for PR #485 (verify-485).

fn state_path(home: &Path) -> std::path::PathBuf {
    home.join("Library/Application Support/.dfai-rename-migration.json")
}

/// A launch blocked by a failed copy saves a state with that pair not done.
/// If that file is then damaged (a power cut before an unsynced save reached
/// the disk), the next launch must still copy Atlas's folder into a DFAI
/// folder that does not exist yet: there is nothing of DFAI's to protect, and
/// "finished" leaves the person with an empty app for good.
#[test]
fn verify_485_a_damaged_state_after_a_blocked_launch_still_copies_into_a_missing_folder() {
    let home = tempfile::tempdir().unwrap();
    let grants = support(home.path(), LEGACY_IDENTIFIER).join("grants.json");
    write(&grants, "g");
    write(
        &support(home.path(), LEGACY_IDENTIFIER).join("vault.json"),
        "old",
    );
    let migration = Migration {
        home: home.path(),
        legacy_secrets: &MemoryStore::default(),
        secrets: &MemoryStore::default(),
    };
    let blocked = {
        let _locked = Unreadable::new(&grants, 0o600);
        migrate(&migration)
    };
    assert!(blocked.blocked.is_some());
    let saved = read(&state_path(home.path()));
    fs::write(state_path(home.path()), &saved[..saved.len() / 2]).unwrap();

    let next = migrate(&migration);

    assert!(next.blocked.is_none());
    assert_eq!(
        fs::read_to_string(support(home.path(), IDENTIFIER).join("vault.json")).ok(),
        Some("old".to_string()),
        "Atlas's folder was never copied; said: {:?}",
        next.said
    );
}

/// The state names finished folders by absolute path. Renaming the home
/// folder (System Settings → Users, or Migration Assistant under a new short
/// name) must not make a finished folder look unfinished: DFAI's own data
/// would be set aside and Atlas's older copy put in its place.
#[test]
fn verify_485_a_renamed_home_folder_never_sets_dfais_own_folder_aside() {
    let root = tempfile::tempdir().unwrap();
    let before = root.path().join("olduser");
    write(
        &support(&before, LEGACY_IDENTIFIER).join("vault.json"),
        "old",
    );
    migrate(&Migration {
        home: &before,
        legacy_secrets: &MemoryStore::default(),
        secrets: &MemoryStore::default(),
    });
    write(&support(&before, IDENTIFIER).join("vault.json"), "newer");
    let after = root.path().join("newuser");
    fs::rename(&before, &after).unwrap();

    migrate(&Migration {
        home: &after,
        legacy_secrets: &MemoryStore::default(),
        secrets: &MemoryStore::default(),
    });

    assert_eq!(
        read(&support(&after, IDENTIFIER).join("vault.json")),
        "newer"
    );
    assert!(!after
        .join("Library/Application Support")
        .join(format!("{IDENTIFIER}.pre-dfai-1"))
        .exists());
}
