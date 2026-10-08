//! Text in, vectors out, with a small open model run on this Mac (ADR-0031).
//!
//! This decides nothing. Which blocks are embedded, how a note is cut into
//! them, how vectors are compared and what counts as related are TypeScript's
//! (ADR-0005). Here the model is fetched once and checked, loaded once, and run
//! over the texts it is handed, in the order it is handed them.
//!
//! A text longer than the model reads is refused, never cut: cutting it would
//! quietly leave its end out of every search, and how to split a block is the
//! chunker's to decide.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

pub mod fetch;
pub mod model;

use fetch::ensure_model;
use model::{Embedder, ModelFile, ModelSpec, Pooling, Purpose};

/// Snowflake Arctic Embed XS, chosen by the spike in ADR-0031: the best of
/// three on James's questions, 91 MB, and a 512-token window. Apache-2.0.
pub const MODEL: ModelSpec = ModelSpec {
    folder: "snowflake-arctic-embed-xs",
    repository: "Snowflake/snowflake-arctic-embed-xs",
    revision: "d8c86521100d3556476a063fc2342036d45c106f",
    files: &[
        ModelFile {
            name: "config.json",
            sha256: "d7d071046ab952af96b7abad788db7ab3fc997b465e1b9914ff39707092254ec",
            bytes: 737,
        },
        ModelFile {
            name: "tokenizer.json",
            sha256: "91f1def9b9391fdabe028cd3f3fcc4efd34e5d1f08c3bf2de513ebb5911a1854",
            bytes: 711_649,
        },
        ModelFile {
            name: "model.safetensors",
            sha256: "ee789e0b1d6ecbbd5ce37b474af556cc1a1319cee4417d9e3b11f82e90300706",
            bytes: 90_272_656,
        },
    ],
    pooling: Pooling::Cls,
    query_prefix: "Represent this sentence for searching relevant passages: ",
    max_tokens: 512,
};

/// The most texts one call takes. A call of this many short blocks is about a
/// second of work (ADR-0031); the cache build sends fewer and sends often.
pub const MAX_TEXTS: usize = 256;

/// The most text one call takes, in bytes: about twice what `MAX_TEXTS`
/// full-length blocks of prose add up to, so it stops only a call that was
/// never cut into blocks, before the tokenizer spends time on it.
pub const MAX_BATCH_BYTES: usize = 1024 * 1024;

/// Refuses a call larger than the host takes in one go, before any work.
pub fn check_batch(texts: &[String]) -> Result<(), String> {
    if texts.len() > MAX_TEXTS {
        return Err(format!(
            "{} texts were sent to embed at once; the most is {MAX_TEXTS}",
            texts.len()
        ));
    }
    let bytes: usize = texts.iter().map(String::len).sum();
    if bytes > MAX_BATCH_BYTES {
        return Err(format!(
            "{bytes} bytes of text were sent to embed at once; the most is {MAX_BATCH_BYTES}"
        ));
    }
    Ok(())
}

/// Where a model's files are kept: the app's data folder on this Mac, never
/// the vault, so they are fetched once per Mac and never synced.
pub fn model_folder(data_dir: &Path, spec: &ModelSpec) -> PathBuf {
    data_dir
        .join("models")
        .join(format!("{}-{}", spec.folder, &spec.revision[..12]))
}

/// The model, once loaded. Loading waits on the lock, so two first calls
/// fetch and load it once between them.
#[derive(Default)]
pub struct EmbeddingState {
    embedder: Mutex<Option<Arc<Embedder>>>,
}

impl EmbeddingState {
    async fn embedder(&self, folder: PathBuf) -> Result<Arc<Embedder>, String> {
        let mut loaded = self.embedder.lock().await;
        if let Some(embedder) = loaded.as_ref() {
            return Ok(Arc::clone(embedder));
        }
        ensure_model(&folder, &MODEL).await?;
        let embedder = off_main(move || Embedder::load(&folder, &MODEL)).await?;
        let embedder = Arc::new(embedder);
        *loaded = Some(Arc::clone(&embedder));
        Ok(embedder)
    }
}

/// Model work is seconds of CPU; it runs on a blocking thread so neither the
/// window nor the async runtime's workers wait on it.
async fn off_main<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("the embedding model stopped: {error}"))?
}

/// One unit-length vector per text, in order. The first call on this Mac
/// fetches the model (91 MB) and every first call after launch loads it.
#[tauri::command]
pub async fn embed(
    app: AppHandle,
    state: State<'_, EmbeddingState>,
    texts: Vec<String>,
    purpose: Purpose,
) -> Result<Vec<Vec<f32>>, String> {
    check_batch(&texts)?;
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let embedder = state.embedder(model_folder(&data_dir, &MODEL)).await?;
    off_main(move || embedder.embed(&texts, purpose)).await
}

#[cfg(test)]
mod tests;
