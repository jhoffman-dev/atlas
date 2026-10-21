//! Every test here runs against folders made in a temporary directory and
//! secret stores in memory: never the real `~/Library` or the real Keychain.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use super::{
    copy_folder_once, copy_secrets, folders_under, migrate, Copied, FolderPair, Migration,
    IDENTIFIER, LEGACY_IDENTIFIER, MARKER,
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
fn a_launch_copies_folders_and_secrets_then_marks_it_done() {
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
    assert!(support(home.path(), IDENTIFIER).join(MARKER).is_file());
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
    assert!(!support(home.path(), IDENTIFIER).join(MARKER).exists());

    migrate(&Migration {
        home: home.path(),
        legacy_secrets: &denied.inner,
        secrets: &new,
    });
    assert_eq!(new.get("v1/github").unwrap().as_deref(), Some("ghp_A"));
    assert!(support(home.path(), IDENTIFIER).join(MARKER).is_file());
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
