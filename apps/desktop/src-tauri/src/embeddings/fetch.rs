//! Getting a model's files onto this Mac, and making sure the files there
//! are the ones it was pinned at.
//!
//! A file already in the model's folder is read back and checked against its
//! pinned size and SHA-256 before the model is used; one that does not match
//! is removed and fetched again. A fetch streams into a temporary file of its
//! own in the same folder, checking each chunk as it writes it, and is put in
//! place under the file's name only if it matches — and never over a file
//! another fetch put there first. Two fetches at once (two Atlas processes on
//! one Mac share the folder) cannot mix their bytes, and an interrupted fetch
//! leaves nothing under the file's name.
//!
//! The check runs once per launch, when the model is loaded: a read and hash
//! of 91 MB, about 170 ms. A stamp that let a later launch skip it would trust
//! a file's size and time over its bytes.

use std::fs::File;
use std::io::{ErrorKind, Read};
use std::path::Path;
use std::time::Duration;

use reqwest::Client;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use super::model::{ModelFile, ModelSpec};

/// Where the models come from.
pub const HUGGING_FACE: &str = "https://huggingface.co";

/// How long the server may go without answering or sending more of a file.
/// A slow line is fine while bytes keep arriving; one that stops is not.
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);

const USER_AGENT: &str = concat!("Atlas/", env!("CARGO_PKG_VERSION"));

/// Makes sure `folder` holds the model's pinned files, from Hugging Face.
pub async fn ensure_model(folder: &Path, spec: &ModelSpec) -> Result<(), String> {
    ensure_model_from(HUGGING_FACE, folder, spec).await
}

/// Makes sure `folder` holds the model's pinned files, fetching from `source`
/// whichever are missing or are not the pinned file.
pub async fn ensure_model_from(
    source: &str,
    folder: &Path,
    spec: &ModelSpec,
) -> Result<(), String> {
    fs::create_dir_all(folder)
        .await
        .map_err(|error| format!("cannot make the embedding model's folder: {error}"))?;
    let mut client = None;
    for file in spec.files {
        let path = folder.join(file.name);
        let replaced = match on_disk(&path, file).await? {
            OnDisk::Pinned => continue,
            OnDisk::Missing => false,
            OnDisk::Other => {
                fs::remove_file(&path).await.map_err(|error| {
                    format!("cannot remove the embedding model's {}: {error}", file.name)
                })?;
                true
            }
        };
        let client = match &client {
            Some(client) => client,
            None => client.insert(new_client()?),
        };
        let fetched = fetch_file(client, &file_url(source, spec, file), folder, file).await;
        fetched.map_err(|error| match replaced {
            true => format!(
                "the embedding model's {} on this Mac was not the pinned file, so it was \
                 removed; fetching it again failed: {error}",
                file.name
            ),
            false => error,
        })?;
    }
    Ok(())
}

enum OnDisk {
    Missing,
    Pinned,
    Other,
}

/// Whether the file at `path` is there, and whether it is the pinned file.
async fn on_disk(path: &Path, file: &'static ModelFile) -> Result<OnDisk, String> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        let mut opened = match File::open(&path) {
            Ok(opened) => opened,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(OnDisk::Missing),
            Err(error) => return Err(format!("cannot read the embedding model: {error}")),
        };
        let mut check = FileCheck::new(file);
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let read = opened
                .read(&mut buffer)
                .map_err(|error| format!("cannot read the embedding model: {error}"))?;
            if read == 0 {
                break;
            }
            if check.take(&buffer[..read]).is_err() {
                return Ok(OnDisk::Other);
            }
        }
        Ok(match check.finish() {
            Ok(()) => OnDisk::Pinned,
            Err(_) => OnDisk::Other,
        })
    })
    .await
    .map_err(|error| format!("checking the embedding model stopped: {error}"))?
}

fn new_client() -> Result<Client, String> {
    Client::builder()
        .connect_timeout(IDLE_TIMEOUT)
        .read_timeout(IDLE_TIMEOUT)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("cannot start fetching the embedding model: {error}"))
}

fn file_url(source: &str, spec: &ModelSpec, file: &ModelFile) -> String {
    format!(
        "{source}/{}/resolve/{}/{}",
        spec.repository, spec.revision, file.name
    )
}

fn write_error(error: impl std::fmt::Display) -> String {
    format!("cannot write the embedding model: {error}")
}

/// Fetches one file into a temporary file of its own, checking it as it
/// arrives, and puts it in place only if it is the pinned file.
async fn fetch_file(
    client: &Client,
    url: &str,
    folder: &Path,
    file: &'static ModelFile,
) -> Result<(), String> {
    let cannot_reach = |error: reqwest::Error| {
        format!(
            "cannot fetch the embedding model's {} (is this Mac online?): {}",
            file.name,
            error.without_url()
        )
    };
    let mut response = client.get(url).send().await.map_err(cannot_reach)?;
    if !response.status().is_success() {
        return Err(format!(
            "fetching the embedding model's {} answered {}",
            file.name,
            response.status()
        ));
    }
    // Removed when dropped, so a fetch that fails leaves nothing behind.
    let staged = tempfile::Builder::new()
        .prefix(&format!(".{}.", file.name))
        .suffix(".part")
        .tempfile_in(folder)
        .map_err(write_error)?;
    let mut written = fs::File::from_std(staged.reopen().map_err(write_error)?);
    let mut check = FileCheck::new(file);
    while let Some(chunk) = response.chunk().await.map_err(cannot_reach)? {
        check.take(&chunk)?;
        written.write_all(&chunk).await.map_err(write_error)?;
    }
    written.sync_all().await.map_err(write_error)?;
    check.finish()?;
    put_in_place(staged, &folder.join(file.name), file).await
}

/// Names the checked file, unless another fetch named one first — in which
/// case that one is kept if it, too, is the pinned file.
async fn put_in_place(
    staged: NamedTempFile,
    path: &Path,
    file: &'static ModelFile,
) -> Result<(), String> {
    match staged.persist_noclobber(path) {
        Ok(_) => Ok(()),
        Err(error) if error.error.kind() == ErrorKind::AlreadyExists => {
            match on_disk(path, file).await? {
                OnDisk::Pinned => Ok(()),
                _ => Err(format!(
                    "the embedding model's {} was put in place by another fetch and is \
                     not the pinned file; the next use fetches it again",
                    file.name
                )),
            }
        }
        Err(error) => Err(format!(
            "cannot put the embedding model in place: {}",
            error.error
        )),
    }
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

#[cfg(test)]
mod tests;
