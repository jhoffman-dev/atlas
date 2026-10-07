//! Someone else's SQLite file, read as a source and never written.
//!
//! "Read-only" has to mean more than a flag when the file belongs to another
//! program. The file is opened `mode=ro&immutable=1`: SQLite takes no locks,
//! creates no `-wal`, `-shm` or `-journal` beside it, and writes nothing, ever.
//! The price of `immutable` is that SQLite trusts the file not to change and
//! skips recovery, so three cases are refused rather than read wrongly:
//!
//! - a WAL database whose `-wal` holds pages: those are committed rows that
//!   live only in the log, and an immutable read would not see them. Reading
//!   them properly needs the `-shm` index, which means writing next to the
//!   file. The owning app checkpoints on close; until then this says so.
//! - a hot rollback journal: a write was interrupted, and only recovery — a
//!   write — makes the file whole again.
//! - a file that changed while it was being read: pages from before and after
//!   a write would be mixed in one answer.
//!
//! The statement itself goes through the same guard as the Query page
//! (`index::run_query`): one statement, read-only, no ATTACH or pragma
//! setters, a step budget and a row cap. It runs on a connection of its own,
//! opened for this one query and closed after — never attached to the index.
//!
//! Where the file is: vault-relative paths resolve inside the vault as every
//! other file does. An absolute path outside it is opened only if it was
//! picked with the dialog on this machine, for this vault. A source note is
//! text anyone could have written, and without that rule it could point at any
//! database on the disk and copy it into the vault as notes.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use rusqlite::limits::Limit;
use rusqlite::{Connection, OpenFlags};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::index::{run_query, QueryResult, QUERY_STEP_BUDGET};
use crate::secrets::vault_scope;
use crate::vault::{resolve, VaultState};

const GRANTS_FILE: &str = "sqlite-grants.json";
const HEADER: &[u8; 16] = b"SQLite format 3\0";
/// Header bytes 18 and 19 are the write and read versions: 2 means WAL.
const WAL_VERSION: u8 = 2;

/// The longest single value a query may build: as much as a whole feed may be.
const MAX_VALUE_BYTES: i32 = 8 * 1024 * 1024;

/// Characters a path may hold that a SQLite URI would read as syntax.
const URI_RESERVED: &AsciiSet = &CONTROLS.add(b' ').add(b'?').add(b'#').add(b'%');

/// Files outside a vault that were picked for it, by vault scope.
pub(crate) type Grants = BTreeMap<String, BTreeSet<String>>;

/// The grants, read from disk the first time they are needed.
#[derive(Default)]
pub struct SqliteGrants(Mutex<Option<Grants>>);

/// The grants on disk. A file not written yet is no grants; one that cannot
/// be read or parsed is an error, so that it is reported rather than replaced
/// by a file holding only the next grant — which would revoke all the others.
pub(crate) fn load_grants(file: &Path) -> Result<Grants, String> {
    let json = match fs::read_to_string(file) {
        Ok(json) => json,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Grants::new()),
        Err(error) => return Err(format!("cannot read {}: {error}", file.display())),
    };
    serde_json::from_str(&json).map_err(|error| {
        format!(
            "{} is not readable ({error}); fix or remove it, then choose the file again",
            file.display()
        )
    })
}

/// Writes the grants whole or not at all: to a file beside it, then renamed
/// over it, so a crash part-way leaves the previous grants as they were.
pub(crate) fn save_grants(file: &Path, grants: &Grants) -> Result<(), String> {
    let json = serde_json::to_string_pretty(grants).map_err(|error| error.to_string())?;
    let partial = sidecar(file, ".partial");
    fs::write(&partial, json)
        .and_then(|()| fs::rename(&partial, file))
        .map_err(|error| format!("cannot remember the file: {error}"))
}

fn grants_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("no config directory: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("cannot create config directory: {error}"))?;
    Ok(dir.join(GRANTS_FILE))
}

impl SqliteGrants {
    /// Runs `action` on the grants, read from disk the first time.
    fn with<T>(
        &self,
        app: &AppHandle,
        action: impl FnOnce(&mut Grants) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut guard = self.0.lock().map_err(|_| "grants poisoned")?;
        let grants = match guard.as_mut() {
            Some(grants) => grants,
            None => guard.insert(load_grants(&grants_file(app)?)?),
        };
        action(grants)
    }

    fn grant(&self, app: &AppHandle, scope: String, file: String) -> Result<(), String> {
        let path = grants_file(app)?;
        // Written while the lock is held, so two picks cannot interleave their files.
        self.with(app, |grants| {
            let mut granted = grants.clone();
            granted.entry(scope).or_default().insert(file);
            save_grants(&path, &granted)?;
            *grants = granted;
            Ok(())
        })
    }

    fn granted(&self, app: &AppHandle, scope: &str) -> Result<BTreeSet<String>, String> {
        self.with(app, |grants| {
            Ok(grants.get(scope).cloned().unwrap_or_default())
        })
    }
}

/// Where a source's file is, or why it may not be opened.
fn locate(root: &Path, file: &str, granted: &BTreeSet<String>) -> Result<PathBuf, String> {
    if !file.starts_with('/') {
        return resolve(root, file);
    }
    let canonical = Path::new(file)
        .canonicalize()
        .map_err(|error| format!("no such file: {error}"))?;
    if granted.contains(&canonical.to_string_lossy().into_owned()) {
        Ok(canonical)
    } else {
        Err(
            "a file outside the vault opens only once it is picked on this Mac — choose it again"
                .into(),
        )
    }
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

fn holds_bytes(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.len() > 0)
}

/// Refuses what an immutable read would get wrong. See the module comment.
fn check_readable(path: &Path) -> Result<(), String> {
    let mut header = [0u8; 20];
    let mut file =
        fs::File::open(path).map_err(|error| format!("cannot read the file: {error}"))?;
    if file.read_exact(&mut header).is_err() || &header[..16] != HEADER {
        return Err("this is not a SQLite database".into());
    }

    let wal = header[18] == WAL_VERSION || header[19] == WAL_VERSION;
    if wal && holds_bytes(&sidecar(path, "-wal")) {
        return Err(
            "this database has changes waiting in its write-ahead log, which Atlas would \
                    have to write beside it to read. Quit the app that owns it, then refresh."
                .into(),
        );
    }
    if !wal && holds_bytes(&sidecar(path, "-journal")) {
        return Err(
            "this database is part-way through a write. Open it in the app that owns it \
                    first, then refresh."
                .into(),
        );
    }
    Ok(())
}

/// The file's size and modification time, to tell whether it moved under a read.
fn stamp(path: &Path) -> Result<(u64, SystemTime), String> {
    let metadata = fs::metadata(path).map_err(|error| format!("cannot read the file: {error}"))?;
    let modified = metadata
        .modified()
        .map_err(|error| format!("cannot read the file: {error}"))?;
    Ok((metadata.len(), modified))
}

fn open_read_only(path: &Path) -> Result<Connection, String> {
    let encoded = utf8_percent_encode(&path.to_string_lossy(), URI_RESERVED).to_string();
    let uri = format!("file:{encoded}?mode=ro&immutable=1");
    let connection = Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("cannot open the database: {error}"))?;
    // One cheap statement can build a value of a gigabyte before a row is ever
    // counted; SQLite refuses to make one longer than this instead.
    connection
        .set_limit(Limit::SQLITE_LIMIT_LENGTH, MAX_VALUE_BYTES)
        .map_err(|error| format!("cannot limit the query: {error}"))?;
    Ok(connection)
}

/// Runs one read on a file of its own connection, or refuses. Pure of Tauri,
/// so the guard is tested on real files.
pub(crate) fn query_file(path: &Path, sql: &str) -> Result<QueryResult, String> {
    check_readable(path)?;
    let before = stamp(path)?;

    let connection = open_read_only(path)?;
    // Returning true aborts: a runaway statement stops at the budget.
    connection
        .progress_handler(QUERY_STEP_BUDGET, Some(|| true))
        .map_err(|error| format!("cannot limit the query: {error}"))?;
    let result = run_query(&connection, sql, &[])?;
    drop(connection);

    if stamp(path)? != before {
        return Err("the file changed while it was being read. Refresh again.".into());
    }
    Ok(result)
}

#[tauri::command]
pub async fn sqlite_source_query(
    app: AppHandle,
    vault: State<'_, VaultState>,
    grants: State<'_, SqliteGrants>,
    file: String,
    sql: String,
) -> Result<QueryResult, String> {
    let root = vault.root().ok_or("no vault is open")?;
    let granted = grants.granted(&app, &vault_scope(&root))?;
    let path = locate(&root, &file, &granted)?;
    // Reading a file and stepping a statement block; kept off the async
    // runtime's workers, which also serve every other command.
    let result = tauri::async_runtime::spawn_blocking(move || query_file(&path, &sql))
        .await
        .map_err(|error| format!("the query stopped: {error}"))??;
    log::info!("read {} rows from {file}", result.rows.len());
    Ok(result)
}

/// Asks for a database with the system dialog and remembers the choice for this
/// vault, which is what lets a file outside it be opened later.
#[tauri::command]
pub async fn pick_sqlite_file(
    app: AppHandle,
    vault: State<'_, VaultState>,
    grants: State<'_, SqliteGrants>,
) -> Result<Option<String>, String> {
    let root = vault.root().ok_or("no vault is open")?;
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("SQLite database", &["sqlite", "sqlite3", "db", "db3"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|error| format!("unusable file: {error}"))?
        .canonicalize()
        .map_err(|error| format!("unusable file: {error}"))?;
    let file = path.to_string_lossy().into_owned();
    grants.grant(&app, vault_scope(&root), file.clone())?;
    Ok(Some(file))
}

#[cfg(test)]
mod tests;
