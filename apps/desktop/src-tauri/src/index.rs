//! The derived index.
//!
//! Everything here is a cache of what the markdown files already say. It can be
//! deleted at any time and rebuilt from the vault, which is the invariant that
//! keeps the files the source of truth rather than this database.
//!
//! This module stores and queries. It decides nothing: what a note's title is,
//! which properties it has and where a link points are all settled in TypeScript
//! and handed here as rows.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::hooks::{AuthAction, AuthContext, Authorization};
use rusqlite::{params, Connection, OpenFlags, Statement};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::vault::VaultState;

/// Bumped whenever the shape below changes, or what TypeScript stores in it
/// does (3: `title` became the page's title rather than the filename; 4: it
/// stopped preferring a leading `# heading`, so lists match the page head; 5:
/// every use of a tag, which TypeScript finds, gained a table; 6: a tag's
/// name may not start or end with `_`, and `F#` no longer closes one; 7:
/// every property written as a wiki link gained a row in `relations`, with the
/// note TypeScript resolved it to; 8: each relation row carries the name
/// TypeScript folded its target to, so stale relations are found without
/// SQLite's ASCII-only lower(); 9: every block with an id, which TypeScript
/// reads, gained a row in `blocks`; 10: templates left the vault's notes
/// (ADR-0026), and a note unchanged since then still held link rows resolved
/// to one, so every note is read again; 11: every checklist box, which
/// TypeScript reads, gained a row in `checks`, and each file the progress
/// TypeScript worked out from them). A mismatch throws the cache away
/// rather than trying to migrate something that can simply be rebuilt.
const SCHEMA_VERSION: i64 = 11;

const CACHE_DIR: &str = ".atlas-cache";
const DATABASE: &str = "index.sqlite";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedProperty {
    pub key: String,
    #[serde(default)]
    pub index: i64,
    pub text: Option<String>,
    pub number: Option<f64>,
    pub date: Option<String>,
    pub json: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedLink {
    /// The link exactly as written.
    pub target: String,
    /// The note it resolves to, or None when it points nowhere yet.
    pub path: Option<String>,
    pub kind: String,
}

/// One link held by a property, and the note TypeScript resolved it to. What
/// counts as one, and where it points, is decided there (ADR-0019).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedRelation {
    /// The property holding the link.
    pub key: String,
    /// Its place in the property's list; 0 for a single value.
    #[serde(default)]
    pub index: i64,
    /// The link's target exactly as written.
    pub target: String,
    /// The target as TypeScript folds link names; stored, never computed here.
    #[serde(default)]
    pub name: String,
    /// The note it resolves to, or None when it points nowhere yet.
    pub path: Option<String>,
}

/// One use of a tag, as TypeScript read it. What counts as a tag is decided there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedTag {
    /// What makes it the same tag as another.
    pub key: String,
    /// As written in this note.
    pub name: String,
}

/// A block with an id (`^abc123`), as TypeScript read it. What counts as one is decided there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedBlock {
    pub id: String,
    /// A line of what the block says.
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedNote {
    pub path: String,
    pub title: String,
    pub modified: u64,
    pub size: u64,
    /// Plain text used for searching; not the markdown source.
    pub body: String,
    /// The opening line, for showing what a note is about without opening it.
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub properties: Vec<IndexedProperty>,
    #[serde(default)]
    pub links: Vec<IndexedLink>,
    #[serde(default)]
    pub tags: Vec<IndexedTag>,
    #[serde(default)]
    pub relations: Vec<IndexedRelation>,
    #[serde(default)]
    pub blocks: Vec<IndexedBlock>,
    #[serde(default)]
    pub checks: Vec<IndexedCheck>,
    /// How far through its checklist the note is, as TypeScript worked it out.
    #[serde(default)]
    pub progress: Option<i64>,
}

/// A checklist box (`- [ ]`), as TypeScript read it. What counts as one is decided there.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedCheck {
    pub done: bool,
    /// The words on its line.
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub path: String,
    pub modified: u64,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub notes: i64,
    pub properties: i64,
    pub links: i64,
}

#[derive(Default)]
pub struct IndexState(Mutex<Option<Connection>>);

/// A second connection to the same file, opened read-only.
///
/// Queries someone writes run on this one. Read-only is enforced by SQLite when
/// the connection is opened — but a read-only connection still runs ATTACH,
/// VACUUM INTO and pragma setters, so `run_query` also has SQLite refuse
/// anything that is not a read of this database (see `prepare_read`).
#[derive(Default)]
pub struct QueryState(Mutex<Option<Connection>>);

/// A view never returns more than this, however the query is written.
const MAX_QUERY_ROWS: usize = 5_000;

/// Nor more text than this, all values together. A row cap alone lets 5,000
/// rows of wide values reach the webview, and a foreign database's query is
/// written in a note anyone could have written.
const MAX_QUERY_BYTES: usize = 16 * 1024 * 1024;

const QUERY_TOO_LARGE: &str = "the result is larger than Atlas will read";

/// How much work a query may do before it is stopped. SQLite counts virtual
/// machine steps, so this is a budget rather than a clock — but it is enough to
/// stop a runaway query from holding the interface.
pub(crate) const QUERY_STEP_BUDGET: i32 = 5_000_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeColumn {
    pub key: String,
    /// text, number, date, or a list kind that holds several values.
    pub kind: String,
    #[serde(default)]
    pub many: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeSpec {
    pub name: String,
    pub columns: Vec<TypeColumn>,
    /// Whether the view carries each note's checklist progress; TypeScript
    /// decides, so a type with a `progress` of its own keeps it.
    #[serde(default)]
    pub progress: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    /// True when the row cap stopped the result short.
    pub truncated: bool,
}

/// Names that may be written into a statement.
///
/// A column or table name cannot be bound as a parameter, so it has to go into
/// the text. Anything that is not a plain identifier is refused rather than
/// escaped. The TypeScript side checks the same thing; this is the backstop.
fn is_identifier(name: &str) -> bool {
    let mut characters = name.chars();
    match characters.next() {
        Some(first) if first.is_ascii_alphabetic() || first == '_' => {}
        _ => return false,
    }
    characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn database_path(root: &Path) -> Result<PathBuf, String> {
    let directory = root.join(CACHE_DIR);
    fs::create_dir_all(&directory).map_err(|error| format!("cannot create cache: {error}"))?;
    Ok(directory.join(DATABASE))
}

fn create_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS files (
                path     TEXT PRIMARY KEY,
                title    TEXT NOT NULL,
                summary  TEXT NOT NULL DEFAULT '',
                modified INTEGER NOT NULL,
                size     INTEGER NOT NULL,
                progress INTEGER
            );

            CREATE TABLE IF NOT EXISTS props (
                path       TEXT NOT NULL,
                key        TEXT NOT NULL,
                idx        INTEGER NOT NULL DEFAULT 0,
                value_text TEXT,
                value_num  REAL,
                value_date TEXT,
                value_json TEXT
            );
            CREATE INDEX IF NOT EXISTS props_path ON props(path);
            CREATE INDEX IF NOT EXISTS props_key ON props(key, value_text);

            CREATE TABLE IF NOT EXISTS links (
                src    TEXT NOT NULL,
                dst    TEXT,
                target TEXT NOT NULL,
                kind   TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS links_src ON links(src);
            CREATE INDEX IF NOT EXISTS links_dst ON links(dst);

            CREATE TABLE IF NOT EXISTS tags (
                path TEXT NOT NULL,
                idx  INTEGER NOT NULL,
                tag  TEXT NOT NULL,
                name TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS tags_path ON tags(path);
            CREATE INDEX IF NOT EXISTS tags_tag ON tags(tag);

            CREATE TABLE IF NOT EXISTS relations (
                src    TEXT NOT NULL,
                key    TEXT NOT NULL,
                idx    INTEGER NOT NULL,
                target TEXT NOT NULL,
                name   TEXT NOT NULL DEFAULT '',
                dst    TEXT
            );
            CREATE INDEX IF NOT EXISTS relations_src ON relations(src, key);
            CREATE INDEX IF NOT EXISTS relations_dst ON relations(dst);

            CREATE TABLE IF NOT EXISTS blocks (
                path TEXT NOT NULL,
                idx  INTEGER NOT NULL,
                id   TEXT NOT NULL,
                text TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS blocks_path ON blocks(path);
            CREATE INDEX IF NOT EXISTS blocks_id ON blocks(id);

            CREATE TABLE IF NOT EXISTS checks (
                path TEXT NOT NULL,
                idx  INTEGER NOT NULL,
                done INTEGER NOT NULL,
                text TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS checks_path ON checks(path);

            CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
                path UNINDEXED,
                title,
                body,
                tokenize = 'unicode61 remove_diacritics 2'
            );
            ",
        )
        .map_err(|error| format!("cannot create index: {error}"))
}

fn open_database(root: &Path) -> Result<Connection, String> {
    let path = database_path(root)?;
    let connection =
        Connection::open(&path).map_err(|error| format!("cannot open index: {error}"))?;

    connection
        .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
        .map_err(|error| format!("cannot configure index: {error}"))?;

    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| format!("cannot read index version: {error}"))?;

    if version != SCHEMA_VERSION {
        // The cache is derived, so an old shape is discarded rather than migrated.
        drop(connection);
        let _ = fs::remove_file(&path);
        let connection =
            Connection::open(&path).map_err(|error| format!("cannot open index: {error}"))?;
        create_schema(&connection)?;
        connection
            .execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))
            .map_err(|error| format!("cannot set index version: {error}"))?;
        return Ok(connection);
    }

    create_schema(&connection)?;
    Ok(connection)
}

fn with_connection<T>(
    state: &State<'_, IndexState>,
    action: impl FnOnce(&mut Connection) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|_| "index state poisoned")?;
    let connection = guard.as_mut().ok_or("the index is not open")?;
    action(connection)
}

#[tauri::command]
pub fn index_open(
    vault: State<'_, VaultState>,
    index: State<'_, IndexState>,
) -> Result<(), String> {
    let root = vault.root().ok_or("no vault is open")?;
    let connection = open_database(&root)?;
    *index.0.lock().map_err(|_| "index state poisoned")? = Some(connection);
    log::info!("index opened");
    Ok(())
}

/// Throws the cache away and starts again. The point of having it.
#[tauri::command]
pub fn index_clear(
    vault: State<'_, VaultState>,
    index: State<'_, IndexState>,
) -> Result<(), String> {
    let root = vault.root().ok_or("no vault is open")?;
    *index.0.lock().map_err(|_| "index state poisoned")? = None;
    let path = database_path(&root)?;
    for suffix in ["", "-wal", "-shm"] {
        let _ = fs::remove_file(format!("{}{suffix}", path.display()));
    }
    let connection = open_database(&root)?;
    *index.0.lock().map_err(|_| "index state poisoned")? = Some(connection);
    log::info!("index cleared");
    Ok(())
}

/// What the index currently holds, so the caller can work out what changed.
fn manifest(connection: &Connection) -> Result<Vec<IndexEntry>, String> {
    {
        let mut statement = connection
            .prepare("SELECT path, modified, size FROM files")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(IndexEntry {
                    path: row.get(0)?,
                    modified: row.get::<_, i64>(1)? as u64,
                    size: row.get::<_, i64>(2)? as u64,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn index_manifest(index: State<'_, IndexState>) -> Result<Vec<IndexEntry>, String> {
    with_connection(&index, |connection| manifest(connection))
}

fn write_note(transaction: &rusqlite::Transaction<'_>, note: &IndexedNote) -> Result<(), String> {
    let stringly = |error: rusqlite::Error| error.to_string();

    transaction
        .execute("DELETE FROM props WHERE path = ?1", params![note.path])
        .map_err(stringly)?;
    transaction
        .execute("DELETE FROM links WHERE src = ?1", params![note.path])
        .map_err(stringly)?;
    transaction
        .execute("DELETE FROM tags WHERE path = ?1", params![note.path])
        .map_err(stringly)?;
    transaction
        .execute("DELETE FROM relations WHERE src = ?1", params![note.path])
        .map_err(stringly)?;
    transaction
        .execute("DELETE FROM blocks WHERE path = ?1", params![note.path])
        .map_err(stringly)?;
    transaction
        .execute("DELETE FROM checks WHERE path = ?1", params![note.path])
        .map_err(stringly)?;
    transaction
        .execute("DELETE FROM fts WHERE path = ?1", params![note.path])
        .map_err(stringly)?;

    transaction
        .execute(
            "INSERT INTO files (path, title, summary, modified, size, progress)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(path) DO UPDATE SET
                 title = ?2, summary = ?3, modified = ?4, size = ?5, progress = ?6",
            params![
                note.path,
                note.title,
                note.summary,
                note.modified as i64,
                note.size as i64,
                note.progress
            ],
        )
        .map_err(stringly)?;

    transaction
        .execute(
            "INSERT INTO fts (path, title, body) VALUES (?1, ?2, ?3)",
            params![note.path, note.title, note.body],
        )
        .map_err(stringly)?;

    for property in &note.properties {
        transaction
            .execute(
                "INSERT INTO props (path, key, idx, value_text, value_num, value_date, value_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    note.path,
                    property.key,
                    property.index,
                    property.text,
                    property.number,
                    property.date,
                    property.json
                ],
            )
            .map_err(stringly)?;
    }

    for link in &note.links {
        transaction
            .execute(
                "INSERT INTO links (src, dst, target, kind) VALUES (?1, ?2, ?3, ?4)",
                params![note.path, link.path, link.target, link.kind],
            )
            .map_err(stringly)?;
    }

    for relation in &note.relations {
        transaction
            .execute(
                "INSERT INTO relations (src, key, idx, target, name, dst) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    note.path,
                    relation.key,
                    relation.index,
                    relation.target,
                    relation.name,
                    relation.path
                ],
            )
            .map_err(stringly)?;
    }

    for (position, tag) in note.tags.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO tags (path, idx, tag, name) VALUES (?1, ?2, ?3, ?4)",
                params![note.path, position as i64, tag.key, tag.name],
            )
            .map_err(stringly)?;
    }

    for (position, block) in note.blocks.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO blocks (path, idx, id, text) VALUES (?1, ?2, ?3, ?4)",
                params![note.path, position as i64, block.id, block.text],
            )
            .map_err(stringly)?;
    }

    for (position, check) in note.checks.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO checks (path, idx, done, text) VALUES (?1, ?2, ?3, ?4)",
                params![note.path, position as i64, check.done, check.text],
            )
            .map_err(stringly)?;
    }

    Ok(())
}

/// Adds or replaces a batch of notes in one transaction.
fn put_notes(connection: &mut Connection, notes: &[IndexedNote]) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for note in notes {
        write_note(&transaction, note)?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn index_put(index: State<'_, IndexState>, notes: Vec<IndexedNote>) -> Result<(), String> {
    with_connection(&index, |connection| {
        put_notes(connection, &notes)?;
        log::debug!("indexed {} notes", notes.len());
        Ok(())
    })
}

fn remove_paths(connection: &mut Connection, paths: &[String]) -> Result<(), String> {
    {
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        for path in paths {
            for statement in [
                "DELETE FROM files WHERE path = ?1",
                "DELETE FROM props WHERE path = ?1",
                "DELETE FROM links WHERE src = ?1",
                "DELETE FROM tags WHERE path = ?1",
                "DELETE FROM relations WHERE src = ?1",
                "DELETE FROM blocks WHERE path = ?1",
                "DELETE FROM checks WHERE path = ?1",
                "DELETE FROM fts WHERE path = ?1",
            ] {
                transaction
                    .execute(statement, params![path])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub fn index_remove(index: State<'_, IndexState>, paths: Vec<String>) -> Result<(), String> {
    with_connection(&index, |connection| remove_paths(connection, &paths))
}

/// Full-text search. `skip_prefix` is handed in by the frontend — the notes
/// under it are left out — and compared against the lower-cased path; which
/// prefix, and when, is decided there (ADR-0014). Rust only obeys it.
fn search(
    connection: &Connection,
    query: &str,
    limit: u32,
    skip_prefix: Option<&str>,
) -> Result<Vec<SearchHit>, String> {
    let mut statement = connection
        .prepare(
            "SELECT path, title, snippet(fts, 2, '<<', '>>', '…', 12)
             FROM fts WHERE fts MATCH ?1
               AND (?3 IS NULL OR lower(substr(path, 1, length(?3))) <> ?3)
             ORDER BY rank LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![query, limit, skip_prefix], |row| {
            Ok(SearchHit {
                path: row.get(0)?,
                title: row.get(1)?,
                snippet: row.get(2)?,
            })
        })
        // A malformed FTS expression is a user typing, not a failure.
        .map_err(|error| format!("bad search: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn index_search(
    index: State<'_, IndexState>,
    query: String,
    limit: u32,
    skip_prefix: Option<String>,
) -> Result<Vec<SearchHit>, String> {
    with_connection(&index, |connection| {
        search(connection, &query, limit, skip_prefix.as_deref())
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypedNote {
    pub path: String,
    pub title: String,
}

/// Notes declaring `type: <name>` in their frontmatter, which is what a relation
/// property is allowed to point at.
fn notes_of_type(connection: &Connection, type_name: &str) -> Result<Vec<TypedNote>, String> {
    let mut statement = connection
        .prepare(
            "SELECT files.path, files.title FROM files
             JOIN props ON props.path = files.path
             WHERE props.key = 'type' AND props.value_text = ?1
             ORDER BY files.title",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![type_name], |row| {
            Ok(TypedNote {
                path: row.get(0)?,
                title: row.get(1)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn index_notes_of_type(
    index: State<'_, IndexState>,
    r#type: String,
) -> Result<Vec<TypedNote>, String> {
    with_connection(&index, |connection| notes_of_type(connection, &r#type))
}

fn backlinks(connection: &Connection, path: &str) -> Result<Vec<String>, String> {
    {
        let mut statement = connection
            .prepare("SELECT DISTINCT src FROM links WHERE dst = ?1 AND src <> ?1 ORDER BY src")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![path], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }
}

#[tauri::command]
pub fn index_backlinks(index: State<'_, IndexState>, path: String) -> Result<Vec<String>, String> {
    with_connection(&index, |connection| backlinks(connection, &path))
}

/// Builds one SQL view per type, with a column per declared property.
///
/// Properties are stored as rows, which is what lets a note have any shape. A
/// view pivots them back into columns so a query can read like a table:
/// `SELECT name, arr FROM v_company WHERE arr > 1000000`.
fn rebuild_views(connection: &Connection, types: &[TypeSpec]) -> Result<(), String> {
    let existing: Vec<String> = {
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE 'v\\_%' ESCAPE '\\'")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?
    };

    for name in existing {
        connection
            .execute_batch(&format!("DROP VIEW IF EXISTS \"{name}\";"))
            .map_err(|error| error.to_string())?;
    }

    for spec in types {
        if !is_identifier(&spec.name) {
            continue;
        }

        let mut columns = String::new();
        for column in &spec.columns {
            if !is_identifier(&column.key) {
                continue;
            }
            let source = match column.kind.as_str() {
                "number" => "props.value_num",
                "date" => "props.value_date",
                _ => "props.value_text",
            };
            // A property holding several values becomes one comma-separated cell,
            // which is what a table can show and what a filter can match against.
            let aggregate = if column.many {
                format!(
                    "group_concat(CASE WHEN props.key = '{}' THEN {source} END, ', ')",
                    column.key
                )
            } else {
                format!(
                    "MAX(CASE WHEN props.key = '{}' THEN {source} END)",
                    column.key
                )
            };
            columns.push_str(&format!(", {aggregate} AS \"{}\"", column.key));
        }
        let progress = if spec.progress {
            ", files.progress AS \"progress\""
        } else {
            ""
        };

        connection
            .execute_batch(&format!(
                "CREATE VIEW \"v_{name}\" AS
                 SELECT files.path AS \"path\",
                        COALESCE(
                            MAX(CASE WHEN props.key = 'title' THEN props.value_text END),
                            files.title
                        ) AS \"title\",
                        files.summary AS \"summary\",
                        files.modified AS \"modified\"{progress}{columns}
                 FROM files
                 JOIN props ON props.path = files.path
                 WHERE files.path IN (
                     SELECT path FROM props WHERE key = 'type' AND value_text = '{name}'
                 )
                 GROUP BY files.path;",
                name = spec.name
            ))
            .map_err(|error| format!("cannot build the view for {}: {error}", spec.name))?;
    }

    Ok(())
}

#[tauri::command]
pub fn index_rebuild_views(
    index: State<'_, IndexState>,
    types: Vec<TypeSpec>,
) -> Result<(), String> {
    with_connection(&index, |connection| {
        rebuild_views(connection, &types)?;
        log::debug!("rebuilt {} views", types.len());
        Ok(())
    })
}

/// Pragmas that take an argument and only report: what describing a table
/// needs. Any other pragma given a value sets something on the connection.
const DESCRIBING_PRAGMAS: &[&str] = &[
    "table_info",
    "table_xinfo",
    "index_list",
    "index_info",
    "index_xinfo",
    "foreign_key_list",
];

/// The pragma that names the file behind each database: the index's absolute
/// path, which says where things sit on this machine.
const LOCATING_PRAGMA: &str = "database_list";

/// What SQLite may do while preparing someone's query. Attaching and detaching
/// reach other database files; a transaction or savepoint left open would pin
/// every later query on the cached connection to one snapshot; a pragma setter
/// changes how the connection behaves for the next query; `database_list`,
/// as a statement or a table, answers with the index's path on disk.
fn reads_only(context: AuthContext<'_>) -> Authorization {
    match context.action {
        AuthAction::Attach { .. }
        | AuthAction::Detach { .. }
        | AuthAction::Transaction { .. }
        | AuthAction::Savepoint { .. } => Authorization::Deny,
        AuthAction::Pragma { pragma_name, .. }
            if pragma_name.eq_ignore_ascii_case(LOCATING_PRAGMA) =>
        {
            Authorization::Deny
        }
        AuthAction::Read { table_name, .. }
            if table_name.eq_ignore_ascii_case(&format!("pragma_{LOCATING_PRAGMA}")) =>
        {
            Authorization::Deny
        }
        AuthAction::Pragma {
            pragma_name,
            pragma_value: Some(_),
        } if !DESCRIBING_PRAGMAS.contains(&pragma_name.to_ascii_lowercase().as_str()) => {
            Authorization::Deny
        }
        _ => Authorization::Allow,
    }
}

/// Prepares one statement that only reads this database, or refuses it.
///
/// The authorizer is held only while preparing, so the indexer's own statements
/// on the same connection are not bound by it. `prepare` already refuses more
/// than one statement, and `readonly` catches every write — VACUUM INTO
/// included — that the authorizer lets through.
fn prepare_read<'c>(connection: &'c Connection, sql: &str) -> Result<Statement<'c>, String> {
    connection
        .authorizer(Some(reads_only))
        .map_err(|error| error.to_string())?;
    let prepared = connection.prepare(sql);
    connection
        .authorizer(None::<fn(AuthContext<'_>) -> Authorization>)
        .map_err(|error| error.to_string())?;

    let statement = prepared.map_err(|error| error.to_string())?;
    if !statement.readonly() {
        return Err("only a statement that reads the index can run here".to_string());
    }
    Ok(statement)
}

pub(crate) fn run_query(
    connection: &Connection,
    sql: &str,
    parameters: &[serde_json::Value],
) -> Result<QueryResult, String> {
    let mut statement = prepare_read(connection, sql)?;

    let columns: Vec<String> = statement
        .column_names()
        .into_iter()
        .map(str::to_string)
        .collect();

    let bound: Vec<Box<dyn rusqlite::ToSql>> = parameters
        .iter()
        .map(|value| -> Box<dyn rusqlite::ToSql> {
            match value {
                serde_json::Value::Number(number) => match number.as_f64() {
                    Some(float) => Box::new(float),
                    None => Box::new(number.to_string()),
                },
                serde_json::Value::Bool(flag) => Box::new(flag.to_string()),
                serde_json::Value::Null => Box::new(rusqlite::types::Null),
                other => Box::new(other.to_string().trim_matches('"').to_string()),
            }
        })
        .collect();

    let mut rows = statement
        .query(rusqlite::params_from_iter(
            bound.iter().map(|value| value.as_ref()),
        ))
        .map_err(|error| error.to_string())?;

    let mut out = Vec::new();
    let mut truncated = false;
    let mut bytes: usize = 0;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        if out.len() >= MAX_QUERY_ROWS {
            truncated = true;
            break;
        }
        let mut values = Vec::with_capacity(columns.len());
        for index in 0..columns.len() {
            let value = row.get_ref(index).map_err(|error| error.to_string())?;
            if let rusqlite::types::ValueRef::Text(text) = value {
                bytes = bytes.saturating_add(text.len());
                if bytes > MAX_QUERY_BYTES {
                    return Err(QUERY_TOO_LARGE.into());
                }
            }
            values.push(match value {
                rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                rusqlite::types::ValueRef::Integer(number) => serde_json::json!(number),
                rusqlite::types::ValueRef::Real(number) => serde_json::json!(number),
                rusqlite::types::ValueRef::Text(text) => {
                    serde_json::json!(String::from_utf8_lossy(text))
                }
                rusqlite::types::ValueRef::Blob(_) => serde_json::Value::Null,
            });
        }
        out.push(values);
    }

    Ok(QueryResult {
        columns,
        rows: out,
        truncated,
    })
}

#[tauri::command]
pub fn index_query(
    vault: State<'_, VaultState>,
    query: State<'_, QueryState>,
    sql: String,
    parameters: Vec<serde_json::Value>,
) -> Result<QueryResult, String> {
    let mut guard = query.0.lock().map_err(|_| "query state poisoned")?;

    if guard.is_none() {
        let root = vault.root().ok_or("no vault is open")?;
        let path = database_path(&root)?;
        let connection = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|error| format!("cannot open the index for reading: {error}"))?;
        // Returning true aborts, so this stops any query that exceeds the budget.
        // A failure to install it is not worth refusing to query over: the row cap
        // and the read-only connection are the guarantees that matter.
        if let Err(error) = connection.progress_handler(QUERY_STEP_BUDGET, Some(|| true)) {
            log::warn!("could not limit query time: {error}");
        }
        *guard = Some(connection);
    }

    let connection = guard.as_ref().ok_or("the index is not open")?;
    run_query(connection, &sql, &parameters)
}

#[tauri::command]
pub fn index_stats(index: State<'_, IndexState>) -> Result<IndexStats, String> {
    with_connection(&index, |connection| {
        let count = |table: &str| -> Result<i64, String> {
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .map_err(|error| error.to_string())
        };
        Ok(IndexStats {
            notes: count("files")?,
            properties: count("props")?,
            links: count("links")?,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_index() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        create_schema(&connection).unwrap();
        connection
    }

    fn note(path: &str, title: &str, body: &str) -> IndexedNote {
        IndexedNote {
            path: path.to_string(),
            title: title.to_string(),
            modified: 100,
            size: body.len() as u64,
            body: body.to_string(),
            summary: body.to_string(),
            properties: Vec::new(),
            links: Vec::new(),
            tags: Vec::new(),
            relations: Vec::new(),
            blocks: Vec::new(),
            checks: Vec::new(),
            progress: None,
        }
    }

    fn relation(key: &str, index: i64, target: &str, path: Option<&str>) -> IndexedRelation {
        IndexedRelation {
            key: key.to_string(),
            index,
            target: target.to_string(),
            name: String::new(),
            path: path.map(str::to_string),
        }
    }

    #[test]
    fn stores_the_name_typescript_folded_a_relation_to_as_given() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        let mut folded = relation("project", 0, "\u{c9}cole.md", None);
        folded.name = "\u{e9}cole".to_string();
        first.relations = vec![folded];
        put_notes(&mut index, &[first]).unwrap();
        let result = run_query(&index, "SELECT target, name FROM relations", &[]).unwrap();
        assert_eq!(
            serde_json::to_value(&result.rows).unwrap(),
            serde_json::json!([["\u{c9}cole.md", "\u{e9}cole"]])
        );
    }

    type RelationRow = (String, String, i64, String, Option<String>);

    fn relation_rows(connection: &Connection) -> Vec<RelationRow> {
        let mut statement = connection
            .prepare("SELECT src, key, idx, target, dst FROM relations ORDER BY src, key, idx")
            .unwrap();
        statement
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn stores_each_relation_with_the_note_it_was_resolved_to() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.relations = vec![
            relation("owner", 0, "Julie", Some("people/Julie.md")),
            relation("owner", 1, "Nobody", None),
        ];
        put_notes(&mut index, &[first]).unwrap();
        assert_eq!(
            relation_rows(&index),
            vec![
                (
                    "a.md".into(),
                    "owner".into(),
                    0,
                    "Julie".into(),
                    Some("people/Julie.md".into())
                ),
                ("a.md".into(), "owner".into(), 1, "Nobody".into(), None),
            ]
        );
    }

    #[test]
    fn replacing_or_removing_a_note_replaces_or_removes_its_relations() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.relations = vec![relation("project", 0, "Old", Some("Old.md"))];
        let mut other = note("b.md", "B", "beta");
        other.relations = vec![relation("project", 0, "Kept", Some("Kept.md"))];
        put_notes(&mut index, &[first, other]).unwrap();

        let mut second = note("a.md", "A", "alpha");
        second.relations = vec![relation("project", 0, "New", Some("New.md"))];
        put_notes(&mut index, &[second]).unwrap();
        let targets: Vec<String> = relation_rows(&index).into_iter().map(|row| row.3).collect();
        assert_eq!(targets, vec!["New".to_string(), "Kept".to_string()]);

        remove_paths(&mut index, &["a.md".to_string()]).unwrap();
        let targets: Vec<String> = relation_rows(&index).into_iter().map(|row| row.3).collect();
        assert_eq!(targets, vec!["Kept".to_string()]);
    }

    #[test]
    fn a_note_sent_without_relations_has_none_and_they_read_through_the_read_only_path() {
        let json = serde_json::json!({
            "path": "a.md", "title": "A", "modified": 1, "size": 1, "body": "b"
        });
        let parsed: IndexedNote = serde_json::from_value(json).unwrap();
        assert!(parsed.relations.is_empty());

        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.relations = vec![relation("owner", 0, "Julie", None)];
        put_notes(&mut index, &[first]).unwrap();
        let result = run_query(&index, "SELECT src, dst FROM relations", &[]).unwrap();
        assert_eq!(result.rows.len(), 1);
    }

    fn tag(key: &str, name: &str) -> IndexedTag {
        IndexedTag {
            key: key.to_string(),
            name: name.to_string(),
        }
    }

    fn tag_rows(connection: &Connection) -> Vec<(String, i64, String, String)> {
        let mut statement = connection
            .prepare("SELECT path, idx, tag, name FROM tags ORDER BY path, idx")
            .unwrap();
        statement
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn row(path: &str, idx: i64, key: &str, name: &str) -> (String, i64, String, String) {
        (path.into(), idx, key.into(), name.into())
    }

    #[test]
    fn stores_each_use_of_a_tag_in_order() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.tags = vec![tag("idea", "Idea"), tag("idea", "idea")];
        put_notes(&mut index, &[first]).unwrap();
        assert_eq!(
            tag_rows(&index),
            vec![
                row("a.md", 0, "idea", "Idea"),
                row("a.md", 1, "idea", "idea")
            ]
        );
    }

    #[test]
    fn replacing_or_removing_a_note_replaces_or_removes_its_tags() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.tags = vec![tag("old", "old")];
        let mut other = note("b.md", "B", "beta");
        other.tags = vec![tag("kept", "kept")];
        put_notes(&mut index, &[first, other]).unwrap();

        let mut second = note("a.md", "A", "alpha");
        second.tags = vec![tag("new", "new")];
        put_notes(&mut index, &[second]).unwrap();
        assert_eq!(
            tag_rows(&index),
            vec![row("a.md", 0, "new", "new"), row("b.md", 0, "kept", "kept")]
        );

        remove_paths(&mut index, &["a.md".to_string()]).unwrap();
        assert_eq!(tag_rows(&index), vec![row("b.md", 0, "kept", "kept")]);
    }

    fn block(id: &str, text: &str) -> IndexedBlock {
        IndexedBlock {
            id: id.to_string(),
            text: text.to_string(),
        }
    }

    fn block_rows(connection: &Connection) -> Vec<(String, i64, String, String)> {
        connection
            .prepare("SELECT path, idx, id, text FROM blocks ORDER BY path, idx")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn stores_each_block_id_typescript_read_in_order() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.blocks = vec![block("f3k9x2", "The plan"), block("q1", "Said once")];
        put_notes(&mut index, &[first]).unwrap();
        assert_eq!(
            block_rows(&index),
            vec![
                row("a.md", 0, "f3k9x2", "The plan"),
                row("a.md", 1, "q1", "Said once")
            ]
        );
    }

    #[test]
    fn replacing_or_removing_a_note_replaces_or_removes_its_block_ids() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.blocks = vec![block("old", "Old")];
        let mut other = note("b.md", "B", "beta");
        other.blocks = vec![block("kept", "Kept")];
        put_notes(&mut index, &[first, other]).unwrap();
        let mut second = note("a.md", "A", "alpha");
        second.blocks = vec![block("new", "New")];
        put_notes(&mut index, &[second]).unwrap();
        assert_eq!(
            block_rows(&index),
            vec![row("a.md", 0, "new", "New"), row("b.md", 0, "kept", "Kept")]
        );
        remove_paths(&mut index, &["a.md".to_string()]).unwrap();
        assert_eq!(block_rows(&index), vec![row("b.md", 0, "kept", "Kept")]);
    }

    #[test]
    fn a_note_sent_without_block_ids_has_none_and_they_read_through_the_read_only_path() {
        let json = serde_json::json!({
            "path": "a.md", "title": "A", "modified": 1, "size": 1, "body": "b"
        });
        let parsed: IndexedNote = serde_json::from_value(json).unwrap();
        assert!(parsed.blocks.is_empty());
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.blocks = vec![block("f3k9x2", "The plan")];
        put_notes(&mut index, &[first]).unwrap();
        let result = run_query(&index, "SELECT path, id FROM blocks", &[]).unwrap();
        assert_eq!(result.rows.len(), 1);
    }

    fn check(done: bool, text: &str) -> IndexedCheck {
        IndexedCheck {
            done,
            text: text.to_string(),
        }
    }

    fn check_rows(connection: &Connection) -> Vec<(String, i64, bool, String)> {
        connection
            .prepare("SELECT path, idx, done, text FROM checks ORDER BY path, idx")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn checked(path: &str, idx: i64, done: bool, text: &str) -> (String, i64, bool, String) {
        (path.to_string(), idx, done, text.to_string())
    }

    #[test]
    fn stores_each_checklist_box_typescript_read_in_order() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.checks = vec![check(true, "Book the hall"), check(false, "Order chairs")];
        put_notes(&mut index, &[first]).unwrap();
        assert_eq!(
            check_rows(&index),
            vec![
                checked("a.md", 0, true, "Book the hall"),
                checked("a.md", 1, false, "Order chairs")
            ]
        );
    }

    #[test]
    fn replacing_or_removing_a_note_replaces_or_removes_its_checklist() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.checks = vec![check(false, "Old")];
        let mut other = note("b.md", "B", "beta");
        other.checks = vec![check(true, "Kept")];
        put_notes(&mut index, &[first, other]).unwrap();
        let mut second = note("a.md", "A", "alpha");
        second.checks = vec![check(true, "New")];
        put_notes(&mut index, &[second]).unwrap();
        assert_eq!(
            check_rows(&index),
            vec![checked("a.md", 0, true, "New"), checked("b.md", 0, true, "Kept")]
        );
        remove_paths(&mut index, &["a.md".to_string()]).unwrap();
        assert_eq!(check_rows(&index), vec![checked("b.md", 0, true, "Kept")]);
    }

    #[test]
    fn a_note_sent_without_a_checklist_has_none_and_it_reads_through_the_read_only_path() {
        let json = serde_json::json!({
            "path": "a.md", "title": "A", "modified": 1, "size": 1, "body": "b"
        });
        let parsed: IndexedNote = serde_json::from_value(json).unwrap();
        assert!(parsed.checks.is_empty());
        assert_eq!(parsed.progress, None);
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.checks = vec![check(true, "Book the hall")];
        put_notes(&mut index, &[first]).unwrap();
        let result = run_query(&index, "SELECT path, done, text FROM checks", &[]).unwrap();
        assert_eq!(result.rows.len(), 1);
    }

    fn task_with_progress(path: &str, progress: Option<i64>) -> IndexedNote {
        let mut task = note(path, path, "body");
        task.properties = vec![property("type", "task")];
        task.progress = progress;
        task
    }

    fn task_spec(progress: bool, columns: Vec<TypeColumn>) -> TypeSpec {
        TypeSpec {
            name: "task".into(),
            columns,
            progress,
        }
    }

    #[test]
    fn a_view_told_to_carries_the_progress_typescript_worked_out() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[
                task_with_progress("a.md", Some(40)),
                task_with_progress("b.md", None),
            ],
        )
        .unwrap();
        rebuild_views(&index, &[task_spec(true, Vec::new())]).unwrap();
        let result =
            run_query(&index, "SELECT path, progress FROM v_task ORDER BY path", &[]).unwrap();
        assert_eq!(result.rows[0][1], serde_json::json!(40));
        assert_eq!(result.rows[1][1], serde_json::Value::Null);

        // Replacing the note replaces its progress, as it does every other row.
        put_notes(&mut index, &[task_with_progress("a.md", Some(100))]).unwrap();
        let result =
            run_query(&index, "SELECT progress FROM v_task WHERE path = 'a.md'", &[]).unwrap();
        assert_eq!(result.rows[0][0], serde_json::json!(100));
    }

    #[test]
    fn a_view_not_told_to_has_no_progress_and_a_declared_one_is_the_notes_own() {
        let mut index = empty_index();
        let mut own = task_with_progress("a.md", Some(40));
        own.properties.push(IndexedProperty {
            key: "progress".into(),
            index: 0,
            text: Some("7".into()),
            number: Some(7.0),
            date: None,
            json: None,
        });
        put_notes(&mut index, &[own]).unwrap();
        rebuild_views(&index, &[task_spec(false, Vec::new())]).unwrap();
        assert!(run_query(&index, "SELECT progress FROM v_task", &[]).is_err());

        let declared = TypeColumn {
            key: "progress".into(),
            kind: "number".into(),
            many: false,
        };
        rebuild_views(&index, &[task_spec(false, vec![declared])]).unwrap();
        let result = run_query(&index, "SELECT progress FROM v_task", &[]).unwrap();
        assert_eq!(result.columns, vec!["progress".to_string()]);
        assert_eq!(result.rows[0][0], serde_json::json!(7.0));
    }

    #[test]
    fn an_index_of_an_older_shape_is_thrown_away_and_rebuilt_with_a_checklist() {
        let vault = tempfile::tempdir().unwrap();
        let path = database_path(vault.path()).unwrap();
        {
            let old = Connection::open(&path).unwrap();
            old.execute_batch(
                "CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL,
                     summary TEXT NOT NULL DEFAULT '', modified INTEGER NOT NULL,
                     size INTEGER NOT NULL);
                 PRAGMA user_version = 10;",
            )
            .unwrap();
        }
        let mut index = open_database(vault.path()).unwrap();
        let version: i64 = index
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let mut first = task_with_progress("a.md", Some(40));
        first.checks = vec![check(true, "Book the hall")];
        put_notes(&mut index, &[first]).unwrap();
        assert_eq!(check_rows(&index), vec![checked("a.md", 0, true, "Book the hall")]);
        let progress: Option<i64> = index
            .query_row("SELECT progress FROM files WHERE path = 'a.md'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(progress, Some(40));
    }

    #[test]
    fn a_note_sent_without_tags_has_none() {
        let json = serde_json::json!({
            "path": "a.md", "title": "A", "modified": 1, "size": 1, "body": "b"
        });
        let note: IndexedNote = serde_json::from_value(json).unwrap();
        assert!(note.tags.is_empty());
    }

    #[test]
    fn tags_can_be_read_through_the_read_only_path() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.tags = vec![tag("idea", "Idea")];
        put_notes(&mut index, &[first]).unwrap();
        let result = run_query(&index, "SELECT tag, name FROM tags", &[]).unwrap();
        assert_eq!(result.rows.len(), 1);
    }

    fn property(key: &str, text: &str) -> IndexedProperty {
        IndexedProperty {
            key: key.to_string(),
            index: 0,
            text: Some(text.to_string()),
            number: None,
            date: None,
            json: None,
        }
    }

    fn link(target: &str, path: Option<&str>) -> IndexedLink {
        IndexedLink {
            target: target.to_string(),
            path: path.map(str::to_string),
            kind: "wikilink".to_string(),
        }
    }

    #[test]
    fn stores_and_lists_notes() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[note("a.md", "A", "alpha"), note("b.md", "B", "beta")],
        )
        .unwrap();

        let mut paths: Vec<String> = manifest(&index)
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        paths.sort();
        assert_eq!(paths, vec!["a.md", "b.md"]);
    }

    #[test]
    fn reports_size_and_modification_time_for_change_detection() {
        let mut index = empty_index();
        put_notes(&mut index, &[note("a.md", "A", "alpha")]).unwrap();

        let entry = manifest(&index).unwrap().pop().unwrap();
        assert_eq!(entry.modified, 100);
        assert_eq!(entry.size, 5);
    }

    #[test]
    fn replacing_a_note_does_not_duplicate_it() {
        let mut index = empty_index();
        put_notes(&mut index, &[note("a.md", "A", "alpha")]).unwrap();
        put_notes(&mut index, &[note("a.md", "A renamed", "alpha again")]).unwrap();

        assert_eq!(manifest(&index).unwrap().len(), 1);
        assert_eq!(stats_of(&index).notes, 1);
        assert_eq!(search(&index, "alpha", 10, None).unwrap().len(), 1);
    }

    fn stats_of(connection: &Connection) -> IndexStats {
        let count = |table: &str| -> i64 {
            connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap()
        };
        IndexStats {
            notes: count("files"),
            properties: count("props"),
            links: count("links"),
        }
    }

    #[test]
    fn replacing_a_note_replaces_its_properties_and_links() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.properties = vec![property("status", "draft")];
        first.links = vec![link("B", Some("b.md"))];
        put_notes(&mut index, &[first]).unwrap();

        let mut second = note("a.md", "A", "alpha");
        second.properties = vec![property("status", "done")];
        put_notes(&mut index, &[second]).unwrap();

        let stats = stats_of(&index);
        assert_eq!(stats.properties, 1);
        assert_eq!(stats.links, 0);
    }

    #[test]
    fn removing_a_note_removes_everything_about_it() {
        let mut index = empty_index();
        let mut first = note("a.md", "A", "alpha");
        first.properties = vec![property("status", "draft")];
        first.links = vec![link("B", Some("b.md"))];
        put_notes(&mut index, &[first]).unwrap();

        remove_paths(&mut index, &["a.md".to_string()]).unwrap();

        let stats = stats_of(&index);
        assert_eq!((stats.notes, stats.properties, stats.links), (0, 0, 0));
        assert!(search(&index, "alpha", 10, None).unwrap().is_empty());
    }

    #[test]
    fn finds_a_note_by_a_word_in_its_body() {
        let mut index = empty_index();
        put_notes(&mut index, &[note("a.md", "A", "the quick brown fox")]).unwrap();

        let hits = search(&index, "brown", 10, None).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "a.md");
        assert!(hits[0].snippet.contains("<<brown>>"));
    }

    #[test]
    fn finds_a_note_by_its_title() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[note("a.md", "Weekly review", "unrelated body")],
        )
        .unwrap();
        assert_eq!(search(&index, "weekly", 10, None).unwrap().len(), 1);
    }

    #[test]
    fn search_ignores_case_and_accents() {
        let mut index = empty_index();
        put_notes(&mut index, &[note("a.md", "A", "Café RÉSUMÉ")]).unwrap();
        assert_eq!(search(&index, "cafe", 10, None).unwrap().len(), 1);
        assert_eq!(search(&index, "resume", 10, None).unwrap().len(), 1);
    }

    #[test]
    fn search_leaves_out_the_prefix_it_is_handed() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[
                note("Live.md", "Live", "shared word"),
                note("Archive/Old.md", "Old", "shared word"),
                note("archive/hand.md", "Hand", "shared word"),
                note("Notes/Archive/kept.md", "Kept", "shared word"),
            ],
        )
        .unwrap();
        let mut paths: Vec<String> = search(&index, "shared", 10, Some("archive/"))
            .unwrap()
            .into_iter()
            .map(|hit| hit.path)
            .collect();
        paths.sort();
        assert_eq!(paths, vec!["Live.md", "Notes/Archive/kept.md"]);
        assert_eq!(search(&index, "shared", 10, None).unwrap().len(), 4);
    }

    #[test]
    fn search_respects_the_limit() {
        let mut index = empty_index();
        let notes: Vec<IndexedNote> = (0..10)
            .map(|i| note(&format!("{i}.md"), "T", "shared word"))
            .collect();
        put_notes(&mut index, &notes).unwrap();
        assert_eq!(search(&index, "shared", 3, None).unwrap().len(), 3);
    }

    #[test]
    fn search_finds_nothing_for_a_word_that_is_not_there() {
        let mut index = empty_index();
        put_notes(&mut index, &[note("a.md", "A", "alpha")]).unwrap();
        assert!(search(&index, "omega", 10, None).unwrap().is_empty());
    }

    #[test]
    fn a_malformed_query_is_an_error_rather_than_a_panic() {
        let mut index = empty_index();
        put_notes(&mut index, &[note("a.md", "A", "alpha")]).unwrap();
        assert!(search(&index, "\"unclosed", 10, None).is_err());
    }

    #[test]
    fn backlinks_come_from_resolved_links_only() {
        let mut index = empty_index();
        let mut source = note("a.md", "A", "body");
        source.links = vec![link("Target", Some("target.md")), link("Ghost", None)];
        put_notes(&mut index, &[source, note("target.md", "Target", "body")]).unwrap();

        assert_eq!(backlinks(&index, "target.md").unwrap(), vec!["a.md"]);
        assert!(backlinks(&index, "ghost.md").unwrap().is_empty());
    }

    #[test]
    fn a_note_linking_to_itself_is_not_its_own_backlink() {
        let mut index = empty_index();
        let mut self_linking = note("a.md", "A", "body");
        self_linking.links = vec![link("A", Some("a.md"))];
        put_notes(&mut index, &[self_linking]).unwrap();

        assert!(backlinks(&index, "a.md").unwrap().is_empty());
    }

    #[test]
    fn several_links_to_the_same_note_count_once() {
        let mut index = empty_index();
        let mut source = note("a.md", "A", "body");
        source.links = vec![link("T", Some("t.md")), link("t", Some("t.md"))];
        put_notes(&mut index, &[source]).unwrap();

        assert_eq!(backlinks(&index, "t.md").unwrap(), vec!["a.md"]);
    }

    #[test]
    fn properties_are_stored_with_their_typed_values() {
        let mut index = empty_index();
        let mut typed = note("a.md", "A", "body");
        typed.properties = vec![
            IndexedProperty {
                key: "arr".into(),
                index: 0,
                text: None,
                number: Some(1_500_000.0),
                date: None,
                json: None,
            },
            IndexedProperty {
                key: "tags".into(),
                index: 1,
                text: Some("project".into()),
                number: None,
                date: None,
                json: None,
            },
        ];
        put_notes(&mut index, &[typed]).unwrap();

        let value: f64 = index
            .query_row("SELECT value_num FROM props WHERE key = 'arr'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(value, 1_500_000.0);

        let idx: i64 = index
            .query_row("SELECT idx FROM props WHERE key = 'tags'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(idx, 1);
    }

    fn company_type() -> TypeSpec {
        TypeSpec {
            name: "company".into(),
            columns: vec![
                TypeColumn {
                    key: "stage".into(),
                    kind: "text".into(),
                    many: false,
                },
                TypeColumn {
                    key: "arr".into(),
                    kind: "number".into(),
                    many: false,
                },
                TypeColumn {
                    key: "founded".into(),
                    kind: "date".into(),
                    many: false,
                },
                TypeColumn {
                    key: "tags".into(),
                    kind: "multiSelect".into(),
                    many: true,
                },
            ],
            progress: false,
        }
    }

    fn typed_note(path: &str, title: &str, values: &[(&str, &str)]) -> IndexedNote {
        let mut note = note(path, title, "body");
        note.properties = vec![property("type", "company")];
        for (key, value) in values {
            note.properties.push(IndexedProperty {
                key: (*key).to_string(),
                index: 0,
                text: Some((*value).to_string()),
                number: value.parse::<f64>().ok(),
                date: if key.contains("founded") {
                    Some((*value).to_string())
                } else {
                    None
                },
                json: None,
            });
        }
        note
    }

    #[test]
    fn a_view_gives_a_column_per_property() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[typed_note("a.md", "Acme", &[("stage", "seed")])],
        )
        .unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        let result = run_query(&index, "SELECT title, stage FROM v_company", &[]).unwrap();
        assert_eq!(result.columns, vec!["title", "stage"]);
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], serde_json::json!("Acme"));
        assert_eq!(result.rows[0][1], serde_json::json!("seed"));
    }

    #[test]
    fn a_view_holds_only_notes_of_its_type() {
        let mut index = empty_index();
        let mut other = note("b.md", "A person", "body");
        other.properties = vec![property("type", "person")];
        put_notes(&mut index, &[typed_note("a.md", "Acme", &[]), other]).unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        let result = run_query(&index, "SELECT title FROM v_company", &[]).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], serde_json::json!("Acme"));
    }

    #[test]
    fn a_number_column_compares_as_a_number() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[
                typed_note("a.md", "Small", &[("arr", "90")]),
                typed_note("b.md", "Big", &[("arr", "1000")]),
            ],
        )
        .unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        let result = run_query(
            &index,
            "SELECT title FROM v_company WHERE arr > ?",
            &[serde_json::json!(100)],
        )
        .unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], serde_json::json!("Big"));
    }

    #[test]
    fn a_list_property_becomes_one_cell() {
        let mut index = empty_index();
        let mut note = typed_note("a.md", "Acme", &[]);
        note.properties.push(IndexedProperty {
            key: "tags".into(),
            index: 0,
            text: Some("one".into()),
            number: None,
            date: None,
            json: None,
        });
        note.properties.push(IndexedProperty {
            key: "tags".into(),
            index: 1,
            text: Some("two".into()),
            number: None,
            date: None,
            json: None,
        });
        put_notes(&mut index, &[note]).unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        let result = run_query(&index, "SELECT tags FROM v_company", &[]).unwrap();
        assert_eq!(result.rows[0][0], serde_json::json!("one, two"));
    }

    #[test]
    fn rebuilding_replaces_the_previous_views() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[typed_note("a.md", "Acme", &[("stage", "seed")])],
        )
        .unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        // The type loses a property; the view must lose the column with it.
        let trimmed = TypeSpec {
            name: "company".into(),
            columns: vec![TypeColumn {
                key: "stage".into(),
                kind: "text".into(),
                many: false,
            }],
            progress: false,
        };
        rebuild_views(&index, &[trimmed]).unwrap();

        assert!(run_query(&index, "SELECT arr FROM v_company", &[]).is_err());
        assert!(run_query(&index, "SELECT stage FROM v_company", &[]).is_ok());
    }

    #[test]
    fn a_view_for_a_type_with_an_unusable_name_is_not_built() {
        let index = empty_index();
        let bad = TypeSpec {
            name: "drop table".into(),
            columns: Vec::new(),
            progress: false,
        };
        rebuild_views(&index, &[bad]).unwrap();

        let views: i64 = index
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='view'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(views, 0);
    }

    #[test]
    fn a_query_binds_its_parameters_rather_than_trusting_them() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[typed_note("a.md", "Acme", &[("stage", "seed")])],
        )
        .unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        let attack = serde_json::json!("seed'; DROP TABLE files;--");
        let result = run_query(
            &index,
            "SELECT title FROM v_company WHERE stage IS ?",
            &[attack],
        )
        .unwrap();
        assert!(result.rows.is_empty());

        // The table is still there.
        assert!(run_query(&index, "SELECT COUNT(*) FROM files", &[]).is_ok());
    }

    /// An index on disk opened read-write: the worst case, where only
    /// `run_query`'s own checks stand between the SQL and the files.
    fn index_on_disk() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let connection = Connection::open(dir.path().join("index.db")).unwrap();
        create_schema(&connection).unwrap();
        (dir, connection)
    }

    fn attached_databases(connection: &Connection) -> Vec<String> {
        let mut statement = connection
            .prepare("SELECT name FROM pragma_database_list")
            .unwrap();
        let names = statement.query_map([], |row| row.get(0)).unwrap();
        names.collect::<Result<_, _>>().unwrap()
    }

    fn file_count(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM files", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn a_query_cannot_attach_another_database_or_create_its_file() {
        let (dir, index) = index_on_disk();
        let other = dir.path().join("other.db");

        let sql = format!("ATTACH DATABASE '{}' AS other", other.display());
        assert!(run_query(&index, &sql, &[]).is_err());

        assert!(!other.exists());
        assert_eq!(attached_databases(&index), vec!["main"]);
    }

    #[test]
    fn a_query_cannot_vacuum_the_index_into_a_new_file() {
        let (dir, index) = index_on_disk();
        let copy = dir.path().join("copy.plist");

        let sql = format!("VACUUM INTO '{}'", copy.display());
        assert!(run_query(&index, &sql, &[]).is_err());

        assert!(!copy.exists());
    }

    #[test]
    fn a_query_cannot_detach_a_database() {
        let (dir, index) = index_on_disk();
        let other = dir.path().join("other.db");
        index
            .execute("ATTACH DATABASE ?1 AS other", [other.display().to_string()])
            .unwrap();

        assert!(run_query(&index, "DETACH DATABASE other", &[]).is_err());

        assert_eq!(attached_databases(&index), vec!["main", "other"]);
    }

    #[test]
    fn a_query_cannot_write_even_on_a_writable_connection() {
        let (_dir, index) = index_on_disk();

        let insert = "INSERT INTO files (path, title, modified, size) VALUES ('x.md', 'x', 1, 1)";
        assert!(run_query(&index, insert, &[]).is_err());
        assert!(run_query(&index, "SELECT 1; DELETE FROM files", &[]).is_err());

        assert_eq!(file_count(&index), 0);
    }

    #[test]
    fn a_query_cannot_change_how_the_connection_behaves() {
        let (_dir, index) = index_on_disk();

        assert!(run_query(&index, "PRAGMA writable_schema = 1", &[]).is_err());
        assert!(run_query(&index, "PRAGMA query_only = 0", &[]).is_err());
        // An open transaction would pin every later query to this snapshot.
        assert!(run_query(&index, "BEGIN", &[]).is_err());
        assert!(run_query(&index, "SAVEPOINT held", &[]).is_err());

        let writable: i64 = index
            .query_row("PRAGMA writable_schema", [], |row| row.get(0))
            .unwrap();
        assert_eq!(writable, 0);
        assert!(index.is_autocommit());
    }

    #[test]
    fn a_query_cannot_learn_where_the_index_file_is() {
        let (_dir, index) = index_on_disk();

        for sql in [
            "PRAGMA database_list",
            "pragma DATABASE_LIST",
            "SELECT file FROM pragma_database_list",
            "SELECT * FROM pragma_database_list()",
            "SELECT file FROM main.pragma_database_list",
        ] {
            assert!(run_query(&index, sql, &[]).is_err(), "{sql} was allowed");
        }
    }

    #[test]
    fn a_query_can_still_read_and_describe_the_index() {
        let (_dir, index) = index_on_disk();

        let described = run_query(&index, "PRAGMA table_info(files)", &[]).unwrap();
        assert!(described.rows.iter().any(|row| row[1] == "path"));
        let with = run_query(&index, "WITH n AS (SELECT 1 AS one) SELECT one FROM n", &[]);
        assert_eq!(with.unwrap().rows, vec![vec![serde_json::json!(1)]]);
        assert!(run_query(&index, "PRAGMA user_version", &[]).is_ok());

        // The indexer's own statements on the connection are not held to the rule.
        index
            .execute(
                "INSERT INTO files (path, title, modified, size) VALUES ('x.md', 'x', 1, 1)",
                [],
            )
            .unwrap();
        assert_eq!(file_count(&index), 1);
    }

    /// The query page's schema list (`SCHEMA_SQL` in the domain) reads
    /// `sqlite_master` and `pragma_table_info` through the same guard as any
    /// other query: allowed, and it names each type's view and its columns.
    #[test]
    fn the_schema_can_be_listed_through_the_read_only_path() {
        let index = empty_index();
        rebuild_views(&index, &[company_type()]).unwrap();
        let schema = "SELECT m.name AS \"table\", m.type AS \"kind\", p.name AS \"column\"
FROM sqlite_master AS m, pragma_table_info(m.name) AS p
WHERE m.type IN ('table', 'view')
AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
AND m.name NOT LIKE 'fts\\_%' ESCAPE '\\'
ORDER BY m.type DESC, m.name, p.cid";
        let result = run_query(&index, schema, &[]).unwrap();
        assert_eq!(result.columns, vec!["table", "kind", "column"]);
        assert!(result
            .rows
            .iter()
            .any(|row| row[0] == "v_company" && row[1] == "view" && row[2] == "stage"));
        assert!(result.rows.iter().all(|row| row[0] != "fts_data"));
    }

    /// A statement typed on the query page that writes is refused, whatever it is.
    #[test]
    fn a_hand_written_write_is_refused() {
        let index = empty_index();
        for sql in [
            "DELETE FROM files",
            "UPDATE files SET title = 'x'",
            "DROP TABLE files",
            "CREATE TABLE x (y)",
        ] {
            assert!(run_query(&index, sql, &[]).is_err(), "{sql} was allowed");
        }
    }

    #[test]
    fn a_query_reports_its_column_names() {
        let index = empty_index();
        rebuild_views(&index, &[company_type()]).unwrap();
        let result = run_query(&index, "SELECT path, title, stage FROM v_company", &[]).unwrap();
        assert_eq!(result.columns, vec!["path", "title", "stage"]);
    }

    /// The SQL below is what `compileViewQuery` produces for a dashboard widget.
    /// The TypeScript tests check that it is generated; these check that SQLite
    /// accepts it and answers correctly, which is the half that only the real
    /// database can tell us.
    #[test]
    fn an_aggregate_over_a_view_returns_one_number() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[
                typed_note("a.md", "Acme", &[("stage", "seed"), ("arr", "100")]),
                typed_note("b.md", "Beta", &[("stage", "seed"), ("arr", "300")]),
                typed_note("c.md", "Cyan", &[("stage", "series-a"), ("arr", "900")]),
            ],
        )
        .unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        let result = run_query(
            &index,
            "SELECT SUM(\"arr\") AS \"value\"\nFROM \"v_company\"\nWHERE \"stage\" IS ?\nLIMIT ?",
            &[serde_json::json!("seed"), serde_json::json!(50)],
        )
        .unwrap();

        assert_eq!(result.columns, vec!["value"]);
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], serde_json::json!(400.0));
    }

    #[test]
    fn an_aggregate_over_nothing_returns_null_rather_than_no_rows() {
        let index = empty_index();
        rebuild_views(&index, &[company_type()]).unwrap();

        let result = run_query(
            &index,
            "SELECT MAX(\"founded\") AS \"value\"\nFROM \"v_company\"\nLIMIT ?",
            &[serde_json::json!(50)],
        )
        .unwrap();

        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], serde_json::Value::Null);
    }

    #[test]
    fn counting_a_view_returns_a_row_per_value_biggest_first() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[
                typed_note("a.md", "Acme", &[("stage", "seed")]),
                typed_note("b.md", "Beta", &[("stage", "seed")]),
                typed_note("c.md", "Cyan", &[("stage", "series-a")]),
            ],
        )
        .unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        let result = run_query(
            &index,
            "SELECT COALESCE(\"stage\", '') AS \"label\", COUNT(*) AS \"count\"\nFROM \"v_company\"\nGROUP BY COALESCE(\"stage\", '')\nORDER BY \"count\" DESC, \"label\" ASC\nLIMIT ?",
            &[serde_json::json!(50)],
        )
        .unwrap();

        assert_eq!(result.columns, vec!["label", "count"]);
        assert_eq!(result.rows[0][0], serde_json::json!("seed"));
        assert_eq!(result.rows[0][1], serde_json::json!(2));
        assert_eq!(result.rows[1][0], serde_json::json!("series-a"));
    }

    #[test]
    fn a_note_missing_the_grouping_property_counts_under_the_empty_label() {
        let mut index = empty_index();
        put_notes(
            &mut index,
            &[
                typed_note("a.md", "Acme", &[("stage", "seed")]),
                typed_note("b.md", "Beta", &[]),
            ],
        )
        .unwrap();
        rebuild_views(&index, &[company_type()]).unwrap();

        let result = run_query(
            &index,
            "SELECT COALESCE(\"stage\", '') AS \"label\", COUNT(*) AS \"count\"\nFROM \"v_company\"\nGROUP BY COALESCE(\"stage\", '')\nORDER BY \"count\" DESC, \"label\" ASC\nLIMIT ?",
            &[serde_json::json!(50)],
        )
        .unwrap();

        let labels: Vec<&serde_json::Value> = result.rows.iter().map(|row| &row[0]).collect();
        assert!(labels.contains(&&serde_json::json!("")));
    }

    #[test]
    fn a_broken_query_is_an_error_rather_than_a_panic() {
        let index = empty_index();
        assert!(run_query(&index, "SELECT nope FROM nowhere", &[]).is_err());
    }

    #[cfg(test)]
    mod card_tests {
        use super::*;

        #[test]
        fn a_view_prefers_the_title_the_note_gives_itself() {
            let mut index = empty_index();

            let mut note = IndexedNote {
                path: "P00-01.md".into(),
                title: "P00-01".into(),
                modified: 1,
                size: 1,
                body: "body".into(),
                summary: "What it is about.".into(),
                properties: vec![
                    IndexedProperty {
                        key: "type".into(),
                        index: 0,
                        text: Some("task".into()),
                        number: None,
                        date: None,
                        json: None,
                    },
                    IndexedProperty {
                        key: "title".into(),
                        index: 0,
                        text: Some("Install the toolchain".into()),
                        number: None,
                        date: None,
                        json: None,
                    },
                ],
                links: Vec::new(),
                tags: Vec::new(),
                relations: Vec::new(),
                blocks: Vec::new(),
                checks: Vec::new(),
                progress: None,
            };
            note.links.clear();
            put_notes(&mut index, &[note]).unwrap();
            rebuild_views(
                &index,
                &[TypeSpec {
                    name: "task".into(),
                    columns: Vec::new(),
                    progress: false,
                }],
            )
            .unwrap();

            let result =
                run_query(&index, "SELECT title, summary, modified FROM v_task", &[]).unwrap();
            assert_eq!(
                result.rows[0][0],
                serde_json::json!("Install the toolchain")
            );
            assert_eq!(result.rows[0][1], serde_json::json!("What it is about."));
            // A feed orders by when the file last changed, so the view carries it.
            assert_eq!(result.rows[0][2], serde_json::json!(1));
        }

        #[test]
        fn a_view_falls_back_to_the_filename_when_there_is_no_title() {
            let mut index = empty_index();

            let mut note = note("plain.md", "plain", "body");
            note.properties = vec![property("type", "task")];
            put_notes(&mut index, &[note]).unwrap();
            rebuild_views(
                &index,
                &[TypeSpec {
                    name: "task".into(),
                    columns: Vec::new(),
                    progress: false,
                }],
            )
            .unwrap();

            let result = run_query(&index, "SELECT title FROM v_task", &[]).unwrap();
            assert_eq!(result.rows[0][0], serde_json::json!("plain"));
        }

        #[test]
        fn an_empty_index_answers_without_failing() {
            let index = empty_index();
            assert!(manifest(&index).unwrap().is_empty());
            assert!(search(&index, "anything", 10, None).unwrap().is_empty());
            assert!(backlinks(&index, "a.md").unwrap().is_empty());
        }
    }
}
