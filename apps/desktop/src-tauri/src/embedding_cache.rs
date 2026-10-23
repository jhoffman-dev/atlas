//! The embeddings cache (P32-02, ADR-0031): each block's vector, kept so a
//! block whose words have not changed is never embedded again.
//!
//! Like the index it is derived and disposable: a file of its own in the
//! vault's `.atlas-cache/` (`embeddings.sqlite`), never synced, which can be
//! deleted at any time and built again from the notes. It is a file of its
//! own rather than tables in `index.sqlite` so the index's frequent schema
//! changes do not throw away minutes of embedding, and so the queries a note
//! runs against the index never read 384 floats a block.
//!
//! This module stores and reads back. It decides nothing: how a note is cut
//! into blocks, what a block's digest is, which notes to embed or forget and
//! how vectors are compared are all TypeScript's, handed here as rows.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::ipc::Response;
use tauri::State;

use crate::embeddings::MODEL;
use crate::vault::VaultState;

/// Bumped whenever the tables below change shape. A file of another shape is
/// thrown away rather than migrated: it can simply be built again.
const SCHEMA_VERSION: i64 = 1;

const CACHE_DIR: &str = ".atlas-cache";
const DATABASE: &str = "embeddings.sqlite";

/// A note as the cache holds it: the digest of its text when it was last cut
/// into blocks, and its title, which a hit shows.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedNote {
    pub path: String,
    pub digest: String,
    pub title: String,
}

/// One block of a note, as TypeScript cut it.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedBlock {
    pub ordinal: i64,
    pub digest: String,
    pub anchor: Option<String>,
    pub heading: Option<String>,
    pub excerpt: String,
}

/// A block and its vector; no vector when the model would not read it, so
/// it is known and not sent again.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockToPut {
    #[serde(flatten)]
    pub block: CachedBlock,
    pub vector: Option<Vec<f32>>,
}

/// A note's blocks, in place of whatever the cache held of it.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteToPut {
    #[serde(flatten)]
    pub note: CachedNote,
    pub blocks: Vec<BlockToPut>,
}

/// A block as read back, but its words: whether it has a vector, whose
/// numbers follow the header in the order the blocks are listed. The words
/// are read only for the blocks a search finds (`excerpts`), so loading a
/// vault's cache parses a few bytes a block rather than a paragraph.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedBlock {
    pub path: String,
    pub ordinal: i64,
    pub digest: String,
    pub anchor: Option<String>,
    pub heading: Option<String>,
    pub embedded: bool,
}

/// Which block of which note.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockKey {
    pub path: String,
    pub ordinal: i64,
}

/// Everything the cache holds, but the vectors.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedHeader {
    pub notes: Vec<CachedNote>,
    pub blocks: Vec<LoadedBlock>,
}

/// What opening the cache found.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheOpened {
    /// True when the cache was made just now, so it holds nothing yet.
    pub fresh: bool,
}

/// The cache of the vault open now, behind one lock: every read and write is
/// short, and the build sends them one at a time.
#[derive(Default)]
pub struct EmbeddingCacheState {
    held: Mutex<Option<Held>>,
}

struct Held {
    root: PathBuf,
    connection: Connection,
}

pub type SharedEmbeddingCache = Arc<EmbeddingCacheState>;

impl EmbeddingCacheState {
    /// Opens the cache of the vault at `root` for vectors of `generation`
    /// — the chunking rules TypeScript names, joined here with the model's
    /// pinned revision, since vectors from two models are not comparable.
    pub fn open(&self, root: &Path, generation: &str) -> Result<CacheOpened, String> {
        let mut held = self.held.lock().map_err(|_| "cache state poisoned")?;
        *held = None;
        let (connection, opened) =
            open_database(&database_path(root)?, &full_generation(generation))?;
        *held = Some(Held {
            root: root.to_path_buf(),
            connection,
        });
        Ok(opened)
    }

    /// Throws the cache away and makes it again, empty, for the same generation.
    pub fn clear(&self) -> Result<(), String> {
        let mut held = self.held.lock().map_err(|_| "cache state poisoned")?;
        let current = held.take().ok_or("the embeddings cache is not open")?;
        let generation = stored_generation(&current.connection)?.unwrap_or_default();
        let root = current.root;
        drop(current.connection);
        let path = database_path(&root)?;
        discard(&path);
        let (connection, _) = open_database(&path, &generation)?;
        *held = Some(Held { root, connection });
        Ok(())
    }

    /// Runs `action` on the cache, refusing it when the cache open now is
    /// another vault's than the one it was meant for.
    fn with<T>(
        &self,
        meant_for: Option<&str>,
        action: impl FnOnce(&mut Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut held = self.held.lock().map_err(|_| "cache state poisoned")?;
        let held = held.as_mut().ok_or("the embeddings cache is not open")?;
        if meant_for.is_some_and(|meant| Path::new(meant) != held.root) {
            return Err("another vault was opened before this could be cached".into());
        }
        action(&mut held.connection)
    }
}

fn full_generation(generation: &str) -> String {
    format!("{generation}+{}@{}", MODEL.folder, MODEL.revision)
}

fn database_path(root: &Path) -> Result<PathBuf, String> {
    let directory = root.join(CACHE_DIR);
    fs::create_dir_all(&directory).map_err(|error| format!("cannot create cache: {error}"))?;
    Ok(directory.join(DATABASE))
}

/// Opens the cache at `path`, discarding one of another shape or generation
/// — or a file that is not a database at all — and making it afresh.
fn open_database(path: &Path, generation: &str) -> Result<(Connection, CacheOpened), String> {
    let fresh = !matches_shape(path, generation)?;
    if fresh {
        discard(path);
    }
    let connection =
        Connection::open(path).map_err(|error| format!("cannot open embeddings cache: {error}"))?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS notes (
                path TEXT PRIMARY KEY, digest TEXT NOT NULL, title TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS block_embeddings (
                path TEXT NOT NULL, ordinal INTEGER NOT NULL, digest TEXT NOT NULL,
                anchor TEXT, heading TEXT, excerpt TEXT NOT NULL, vector BLOB,
                PRIMARY KEY (path, ordinal)
            ) WITHOUT ROWID;",
        )
        .map_err(|error| format!("cannot make embeddings cache: {error}"))?;
    if fresh {
        connection
            .execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('generation', ?1)",
                params![generation],
            )
            .and_then(|_| {
                connection.execute_batch(&format!("PRAGMA user_version = {SCHEMA_VERSION};"))
            })
            .map_err(|error| format!("cannot set embeddings cache version: {error}"))?;
    }
    Ok((connection, CacheOpened { fresh }))
}

/// Whether the file at `path` is a cache of this shape and generation. A
/// missing file, or one that is not a database, is not.
fn matches_shape(path: &Path, generation: &str) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let connection =
        Connection::open(path).map_err(|error| format!("cannot open embeddings cache: {error}"))?;
    let version: i64 = match connection.query_row("PRAGMA user_version", [], |row| row.get(0)) {
        Ok(version) => version,
        Err(rusqlite::Error::SqliteFailure(failure, _))
            if failure.code == rusqlite::ErrorCode::NotADatabase =>
        {
            return Ok(false)
        }
        Err(error) => return Err(format!("cannot read embeddings cache version: {error}")),
    };
    // A file of another version may not even have the meta table to ask.
    Ok(version == SCHEMA_VERSION && stored_generation(&connection)?.as_deref() == Some(generation))
}

fn stored_generation(connection: &Connection) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'generation'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("cannot read embeddings cache generation: {error}"))
}

/// Removes the cache and its journal files. A file already gone is what was wanted.
fn discard(path: &Path) {
    let _ = fs::remove_file(path);
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = path.as_os_str().to_owned();
        sidecar.push(suffix);
        let _ = fs::remove_file(sidecar);
    }
}

/// Replaces each note's blocks with those given, in one transaction: a note
/// is held whole or as it was, never half way, whatever stops the write.
fn put_notes(connection: &mut Connection, notes: &[NoteToPut]) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for NoteToPut { note, blocks } in notes {
        transaction
            .execute(
                "DELETE FROM block_embeddings WHERE path = ?1",
                params![note.path],
            )
            .map_err(|error| error.to_string())?;
        for BlockToPut { block, vector } in blocks {
            transaction
                .execute(
                    "INSERT INTO block_embeddings
                        (path, ordinal, digest, anchor, heading, excerpt, vector)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        note.path,
                        block.ordinal,
                        block.digest,
                        block.anchor,
                        block.heading,
                        block.excerpt,
                        vector.as_deref().map(vector_bytes),
                    ],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction
            .execute(
                "INSERT OR REPLACE INTO notes (path, digest, title) VALUES (?1, ?2, ?3)",
                params![note.path, note.digest, note.title],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn remove_notes(connection: &mut Connection, paths: &[String]) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    for path in paths {
        for statement in [
            "DELETE FROM block_embeddings WHERE path = ?1",
            "DELETE FROM notes WHERE path = ?1",
        ] {
            transaction
                .execute(statement, params![path])
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn vector_bytes(vector: &[f32]) -> Vec<u8> {
    vector
        .iter()
        .flat_map(|value| value.to_le_bytes())
        .collect()
}

/// Everything the cache holds, in one read: a little-endian u32 giving the
/// length of a JSON header (`LoadedHeader`), the header, then the vectors of
/// the blocks marked embedded, in the header's order, as little-endian f32s
/// — so a vault's vectors cross to the window as bytes, not as text.
fn load(connection: &Connection) -> Result<Vec<u8>, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let notes = read_notes(&transaction)?;
    let mut statement = transaction
        .prepare(
            "SELECT path, ordinal, digest, anchor, heading, vector
             FROM block_embeddings ORDER BY path, ordinal",
        )
        .map_err(|error| error.to_string())?;
    let mut vectors: Vec<u8> = Vec::new();
    let mut blocks = Vec::new();
    let mut rows = statement.query([]).map_err(|error| error.to_string())?;
    while let Some(row) = rows.next().map_err(|error| error.to_string())? {
        let vector: Option<Vec<u8>> = row.get(5).map_err(|error| error.to_string())?;
        if let Some(bytes) = &vector {
            vectors.extend_from_slice(bytes);
        }
        blocks.push(LoadedBlock {
            path: row.get(0).map_err(|error| error.to_string())?,
            ordinal: row.get(1).map_err(|error| error.to_string())?,
            digest: row.get(2).map_err(|error| error.to_string())?,
            anchor: row.get(3).map_err(|error| error.to_string())?,
            heading: row.get(4).map_err(|error| error.to_string())?,
            embedded: vector.is_some(),
        });
    }
    let header =
        serde_json::to_vec(&LoadedHeader { notes, blocks }).map_err(|error| error.to_string())?;
    let length = u32::try_from(header.len()).map_err(|_| "the cache header is too large")?;
    let mut bytes = Vec::with_capacity(4 + header.len() + vectors.len());
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend_from_slice(&header);
    bytes.extend_from_slice(&vectors);
    Ok(bytes)
}

/// Each block's words, in the order asked; empty for a block the cache does not hold.
fn excerpts(connection: &Connection, keys: &[BlockKey]) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare_cached("SELECT excerpt FROM block_embeddings WHERE path = ?1 AND ordinal = ?2")
        .map_err(|error| error.to_string())?;
    keys.iter()
        .map(|key| {
            statement
                .query_row(params![key.path, key.ordinal], |row| row.get(0))
                .optional()
                .map(Option::unwrap_or_default)
                .map_err(|error| error.to_string())
        })
        .collect()
}

fn read_notes(connection: &Connection) -> Result<Vec<CachedNote>, String> {
    let mut statement = connection
        .prepare("SELECT path, digest, title FROM notes ORDER BY path")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(CachedNote {
                path: row.get(0)?,
                digest: row.get(1)?,
                title: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

/// Cache work off the main thread, so the window never waits on SQLite.
async fn off_main<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("the embeddings cache stopped: {error}"))?
}

#[tauri::command]
pub async fn embedding_cache_open(
    vault: State<'_, VaultState>,
    cache: State<'_, SharedEmbeddingCache>,
    generation: String,
) -> Result<CacheOpened, String> {
    let root = vault.root().ok_or_else(|| "no vault is open".to_string())?;
    let cache = Arc::clone(&cache);
    let opened = off_main(move || cache.open(&root, &generation)).await?;
    log::info!("embeddings cache opened (fresh: {})", opened.fresh);
    Ok(opened)
}

/// Throws the cache away and starts again: the point of it being a cache.
#[tauri::command]
pub async fn embedding_cache_clear(cache: State<'_, SharedEmbeddingCache>) -> Result<(), String> {
    let cache = Arc::clone(&cache);
    off_main(move || cache.clear()).await
}

#[tauri::command]
pub async fn embedding_cache_load(
    cache: State<'_, SharedEmbeddingCache>,
) -> Result<Response, String> {
    let cache = Arc::clone(&cache);
    let bytes = off_main(move || cache.with(None, |connection| load(connection))).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn embedding_cache_excerpts(
    cache: State<'_, SharedEmbeddingCache>,
    keys: Vec<BlockKey>,
) -> Result<Vec<String>, String> {
    let cache = Arc::clone(&cache);
    off_main(move || cache.with(None, |connection| excerpts(connection, &keys))).await
}

/// `vault` is the vault the notes were read from: refused once another's cache is open.
#[tauri::command]
pub async fn embedding_cache_put(
    cache: State<'_, SharedEmbeddingCache>,
    vault: Option<String>,
    notes: Vec<NoteToPut>,
) -> Result<(), String> {
    let cache = Arc::clone(&cache);
    off_main(move || cache.with(vault.as_deref(), |connection| put_notes(connection, &notes))).await
}

#[tauri::command]
pub async fn embedding_cache_remove(
    cache: State<'_, SharedEmbeddingCache>,
    vault: Option<String>,
    paths: Vec<String>,
) -> Result<(), String> {
    let cache = Arc::clone(&cache);
    off_main(move || {
        cache.with(vault.as_deref(), |connection| {
            remove_notes(connection, &paths)
        })
    })
    .await
}

#[cfg(test)]
mod tests;
