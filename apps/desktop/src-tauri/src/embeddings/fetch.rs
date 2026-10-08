//! Getting a model's files onto this Mac, once.
//!
//! Each file is fetched from its pinned revision, checked against its pinned
//! size and SHA-256 as it arrives, and only then renamed into place — so a file
//! in the model's folder under its own name is one that was checked, and an
//! interrupted fetch leaves a `.part` behind rather than a file that looks done.

use std::path::Path;
use std::time::Duration;

use reqwest::Client;
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::AsyncWriteExt;

use super::model::{ModelFile, ModelSpec};

/// A model is a few hundred megabytes at most; a slow line gets this long.
const FETCH_TIMEOUT: Duration = Duration::from_secs(15 * 60);

const USER_AGENT: &str = concat!("Atlas/", env!("CARGO_PKG_VERSION"));

/// Fetches whichever of the model's files `folder` does not hold yet.
pub async fn ensure_model(folder: &Path, spec: &ModelSpec) -> Result<(), String> {
    fs::create_dir_all(folder)
        .await
        .map_err(|error| format!("cannot make the embedding model's folder: {error}"))?;
    let missing: Vec<&ModelFile> = spec
        .files
        .iter()
        .filter(|file| !folder.join(file.name).exists())
        .collect();
    if missing.is_empty() {
        return Ok(());
    }
    let client = Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("cannot start fetching the embedding model: {error}"))?;
    for file in missing {
        fetch_file(&client, folder, spec, file).await?;
    }
    Ok(())
}

fn file_url(spec: &ModelSpec, file: &ModelFile) -> String {
    format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        spec.repository, spec.revision, file.name
    )
}

async fn fetch_file(
    client: &Client,
    folder: &Path,
    spec: &ModelSpec,
    file: &ModelFile,
) -> Result<(), String> {
    let cannot_reach = |error: reqwest::Error| {
        format!(
            "cannot fetch the embedding model's {} (is this Mac online?): {}",
            file.name,
            error.without_url()
        )
    };
    let mut response = client
        .get(file_url(spec, file))
        .send()
        .await
        .map_err(cannot_reach)?;
    if !response.status().is_success() {
        return Err(format!(
            "fetching the embedding model's {} answered {}",
            file.name,
            response.status()
        ));
    }
    let staged = folder.join(format!("{}.part", file.name));
    let mut written = fs::File::create(&staged)
        .await
        .map_err(|error| format!("cannot write the embedding model: {error}"))?;
    let mut check = FileCheck::new(file);
    while let Some(chunk) = response.chunk().await.map_err(cannot_reach)? {
        check.take(&chunk)?;
        written
            .write_all(&chunk)
            .await
            .map_err(|error| format!("cannot write the embedding model: {error}"))?;
    }
    written
        .sync_all()
        .await
        .map_err(|error| format!("cannot write the embedding model: {error}"))?;
    check.finish()?;
    fs::rename(&staged, folder.join(file.name))
        .await
        .map_err(|error| format!("cannot put the embedding model in place: {error}"))
}

/// A file checked as it arrives: refused as soon as it is longer than pinned,
/// and at the end unless its digest is the pinned one.
pub struct FileCheck<'a> {
    file: &'a ModelFile,
    read: u64,
    digest: Sha256,
}

impl<'a> FileCheck<'a> {
    pub fn new(file: &'a ModelFile) -> Self {
        Self {
            file,
            read: 0,
            digest: Sha256::new(),
        }
    }

    pub fn take(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.read = self.read.saturating_add(chunk.len() as u64);
        if self.read > self.file.bytes {
            return Err(format!(
                "the embedding model's {} is larger than the {} bytes it was pinned at",
                self.file.name, self.file.bytes
            ));
        }
        self.digest.update(chunk);
        Ok(())
    }

    pub fn finish(self) -> Result<(), String> {
        let digest: String = self
            .digest
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        if digest != self.file.sha256 {
            return Err(format!(
                "the embedding model's {} is not the file it was pinned at",
                self.file.name
            ));
        }
        Ok(())
    }
}
