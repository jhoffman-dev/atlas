//! The guard on someone else's database, against real files on disk.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use super::{load_grants, locate, query_file, save_grants, sidecar, Grants};

/// A folder holding `app.db`, with a small table of people, in rollback mode.
fn database() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("app.db");
    let connection = Connection::open(&path).unwrap();
    connection
        .execute_batch(
            "CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT, role TEXT);
             INSERT INTO people (name, role) VALUES ('Ada', 'engineer'), ('Grace', NULL);",
        )
        .unwrap();
    drop(connection);
    (dir, path)
}

fn digest(path: &Path) -> Vec<u8> {
    Sha256::digest(fs::read(path).unwrap()).to_vec()
}

/// Every file in the folder, so a test can see nothing appeared beside the database.
fn files_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn reads_rows_with_their_column_names() {
    let (_dir, path) = database();

    let result = query_file(&path, "SELECT id, name, role FROM people ORDER BY id").unwrap();

    assert_eq!(result.columns, vec!["id", "name", "role"]);
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.rows[0][1], serde_json::json!("Ada"));
    assert_eq!(result.rows[1][2], serde_json::Value::Null);
    assert!(!result.truncated);
}

#[test]
fn refuses_every_kind_of_write_and_leaves_the_file_as_it_was() {
    let (dir, path) = database();
    let before = digest(&path);

    for statement in [
        "INSERT INTO people (name) VALUES ('Mallory')",
        "UPDATE people SET name = 'x'",
        "DELETE FROM people",
        "DROP TABLE people",
        "CREATE TABLE more (id)",
        "VACUUM",
        "PRAGMA journal_mode = WAL",
        "PRAGMA user_version = 7",
    ] {
        assert!(
            query_file(&path, statement).is_err(),
            "{statement} was allowed"
        );
    }

    assert_eq!(digest(&path), before);
    assert_eq!(files_in(dir.path()), vec!["app.db"]);
}

#[test]
fn refuses_attach_and_vacuum_into_so_no_other_file_is_reached_or_made() {
    let (dir, path) = database();
    let elsewhere = dir.path().join("copy.db");
    let target = elsewhere.to_string_lossy();

    assert!(query_file(&path, &format!("ATTACH DATABASE '{target}' AS other")).is_err());
    assert!(query_file(&path, &format!("VACUUM INTO '{target}'")).is_err());

    assert!(!elsewhere.exists());
    assert_eq!(files_in(dir.path()), vec!["app.db"]);
}

#[test]
fn refuses_two_statements_in_one() {
    let (_dir, path) = database();
    assert!(query_file(&path, "SELECT 1; DELETE FROM people").is_err());
}

#[test]
fn opens_immutable_so_a_lock_held_by_the_owner_does_not_stop_a_read() {
    let (_dir, path) = database();
    let owner = Connection::open(&path).unwrap();
    // The owning app holding the file exclusively, as some do for their whole
    // session. It has written nothing, so there is no journal to refuse.
    owner
        .execute_batch("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;")
        .unwrap();

    // The lock is real: an ordinary read-only connection is turned away.
    let ordinary =
        Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    // Refused at once rather than after rusqlite's default five-second wait.
    ordinary.busy_timeout(std::time::Duration::ZERO).unwrap();
    assert!(ordinary
        .query_row("SELECT count(*) FROM people", [], |row| row
            .get::<_, i64>(0))
        .is_err());

    let result = query_file(&path, "SELECT count(*) FROM people").unwrap();

    assert_eq!(result.rows[0][0], serde_json::json!(2));
    owner.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn reads_a_wal_database_whose_log_is_checkpointed() {
    let (dir, path) = database();
    let owner = Connection::open(&path).unwrap();
    owner.execute_batch("PRAGMA journal_mode = WAL;").unwrap();
    drop(owner); // Closing the last connection checkpoints and removes the -wal.
    assert!(!sidecar(&path, "-wal").exists());

    let result = query_file(&path, "SELECT name FROM people ORDER BY id").unwrap();

    assert_eq!(result.rows.len(), 2);
    assert_eq!(files_in(dir.path()), vec!["app.db"]);
}

#[test]
fn refuses_a_wal_database_with_rows_still_in_its_log() {
    let (_dir, path) = database();
    let owner = Connection::open(&path).unwrap();
    owner
        .execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;
             INSERT INTO people (name) VALUES ('Only in the log');",
        )
        .unwrap();
    assert!(fs::metadata(sidecar(&path, "-wal")).unwrap().len() > 0);

    let error = query_file(&path, "SELECT name FROM people").unwrap_err();

    assert!(error.contains("write-ahead log"), "{error}");
    drop(owner);
}

#[test]
fn refuses_a_database_with_a_hot_journal() {
    let (_dir, path) = database();
    fs::write(sidecar(&path, "-journal"), b"interrupted write").unwrap();

    let error = query_file(&path, "SELECT 1").unwrap_err();

    assert!(error.contains("part-way through a write"), "{error}");
}

#[test]
fn refuses_a_file_that_is_not_a_database() {
    let dir = tempfile::tempdir().unwrap();
    let text = dir.path().join("notes.db");
    fs::write(&text, "id,name\n1,Ada\n").unwrap();
    let empty = dir.path().join("empty.db");
    fs::write(&empty, "").unwrap();

    assert_eq!(
        query_file(&text, "SELECT 1").unwrap_err(),
        "this is not a SQLite database"
    );
    assert!(query_file(&empty, "SELECT 1").is_err());
    // Refused before SQLite could turn the empty file into a database.
    assert_eq!(fs::metadata(&empty).unwrap().len(), 0);
}

#[test]
fn opens_a_path_with_characters_a_uri_would_read_as_syntax() {
    let dir = tempfile::tempdir().unwrap();
    let odd = dir.path().join("my data?#%.db");
    fs::copy(database().1, &odd).unwrap();

    assert!(query_file(&odd, "SELECT count(*) FROM people").is_ok());
}

#[test]
fn a_vault_file_is_resolved_inside_the_vault() {
    let (dir, _path) = database();

    let found = locate(dir.path(), "app.db", &BTreeSet::new()).unwrap();

    assert_eq!(found, dir.path().canonicalize().unwrap().join("app.db"));
    assert!(locate(dir.path(), "../app.db", &BTreeSet::new()).is_err());
}

#[test]
fn a_file_outside_the_vault_opens_only_once_it_was_picked() {
    let vault = tempfile::tempdir().unwrap();
    let (_elsewhere, path) = database();
    let absolute = path.canonicalize().unwrap().to_string_lossy().into_owned();

    let refused = locate(vault.path(), &absolute, &BTreeSet::new()).unwrap_err();
    assert!(refused.contains("picked"), "{refused}");

    let granted = BTreeSet::from([absolute.clone()]);
    assert_eq!(
        locate(vault.path(), &absolute, &granted).unwrap(),
        PathBuf::from(&absolute)
    );
}

#[test]
fn a_grant_is_for_the_file_picked_not_whatever_a_link_points_at_later() {
    let vault = tempfile::tempdir().unwrap();
    let (elsewhere, path) = database();
    let link = elsewhere.path().join("link.db");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    // The link was granted by name; it resolves to a file that was not.
    let granted = BTreeSet::from([link.to_string_lossy().into_owned()]);

    assert!(locate(vault.path(), &link.to_string_lossy(), &granted).is_err());
}

/// Adversarial (P12-06). The query is written in a source note, which anyone
/// could have written. One cheap statement builds a value far larger than the
/// 8 MB a feed may be, and all of it is held and handed to the webview: a
/// SQLite source is capped on rows and steps, never on size.
#[test]
fn a_query_that_builds_an_enormous_value_is_refused() {
    let (_dir, path) = database();

    let outcome = query_file(&path, "SELECT printf('%.*c', 64000000, 'x') AS huge");

    assert!(
        outcome.is_err(),
        "a 64 MB value was read into memory for the webview"
    );
}

/// Each value under any per-value limit, but 4,000 rows of them come to 20 MB.
#[test]
fn a_query_whose_rows_add_up_to_too_much_is_refused() {
    let (_dir, path) = database();
    let sql = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 4000)
               SELECT printf('%.*c', 5000, 'x') AS wide FROM n";

    let error = query_file(&path, sql).expect_err("20 MB of rows were read");

    assert!(error.contains("larger than Atlas will read"), "{error}");
}

/// The control: the same query, a tenth the size, is read whole.
#[test]
fn a_query_whose_rows_stay_under_the_cap_is_read() {
    let (_dir, path) = database();
    let sql = "WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 400)
               SELECT printf('%.*c', 5000, 'x') AS wide FROM n";

    assert_eq!(query_file(&path, sql).unwrap().rows.len(), 400);
}

// The grants file (A19-01).

fn grants_with(scope: &str, file: &str) -> Grants {
    Grants::from([(scope.to_string(), BTreeSet::from([file.to_string()]))])
}

#[test]
fn grants_round_trip_and_leave_no_temporary_file_behind() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("sqlite-grants.json");

    save_grants(&file, &grants_with("v1", "/Users/me/app.db")).unwrap();

    assert_eq!(
        load_grants(&file).unwrap(),
        grants_with("v1", "/Users/me/app.db")
    );
    assert_eq!(files_in(dir.path()), vec!["sqlite-grants.json"]);
}

#[test]
fn no_grants_file_yet_is_no_grants() {
    let dir = tempfile::tempdir().unwrap();

    assert_eq!(
        load_grants(&dir.path().join("absent.json")).unwrap(),
        Grants::new()
    );
}

/// A file that does not parse is refused and left as it is: overwriting it with
/// the one grant being added would silently revoke every other.
#[test]
fn a_corrupt_grants_file_is_reported_and_never_overwritten() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("sqlite-grants.json");
    fs::write(&file, "{ not json").unwrap();

    let error = load_grants(&file).unwrap_err();

    assert!(error.contains("sqlite-grants.json"), "{error}");
    assert_eq!(fs::read_to_string(&file).unwrap(), "{ not json");
}
