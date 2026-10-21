//! The one-time move from Atlas to DFAI (#482, ADR-0042).
//!
//! The app was called Atlas, with the bundle identifier `dev.jhoffman.atlas`.
//! Everything kept per Mac is filed under that identifier, so the first launch
//! under the new one would otherwise find nothing: no remembered vault, no API
//! token, no Keychain secrets, and none of what the webview keeps in its own
//! storage (this Mac's sync id, the theme, work a closing pane could not save).
//!
//! This copies all of it, before the app builds anything that would create
//! the new folders. It only ever copies: the old folders and Keychain items
//! are left exactly as they are for this release, so going back to Atlas
//! still works. A folder is copied whole, and only when the new one is not
//! there yet; a secret only when the new service has nothing under its name.
//! So running it twice changes nothing, and it never writes over anything DFAI
//! made.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::secrets::SecretStore;

/// The bundle identifier, as `tauri.conf.json` says.
pub const IDENTIFIER: &str = "com.dailyflowai.dfai";
/// The bundle identifier Atlas had.
pub const LEGACY_IDENTIFIER: &str = "dev.jhoffman.atlas";
/// An unbundled binary (`pnpm tauri:dev`) has no bundle identifier, and WebKit
/// files its storage under the executable's name instead.
const EXECUTABLE: &str = "dfai";
const LEGACY_EXECUTABLE: &str = "atlas";
/// Left in the new app-support folder once every secret has been copied, so
/// the Keychain is read once: a secret removed in DFAI stays removed, and the
/// old items' access prompts are not shown on every launch.
pub const MARKER: &str = "migrated-from-atlas";
const STAGING_SUFFIX: &str = "migrating";

/// A folder Atlas kept, and where DFAI keeps the same thing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FolderPair {
    pub from: PathBuf,
    pub to: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Copied {
    Folder,
    /// There was no old folder: a Mac that never ran Atlas.
    NothingThere,
    /// The new folder exists already, so it is DFAI's and is left alone.
    AlreadyThere,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct SecretsCopied {
    pub copied: usize,
    pub already_there: usize,
    /// The accounts that could not be read or written. Names, never values.
    pub failed: Vec<String>,
}

pub struct Migration<'a> {
    /// The home folder whose `Library` is migrated.
    pub home: &'a Path,
    /// The Keychain items filed under Atlas's service name.
    pub legacy_secrets: &'a dyn SecretStore,
    pub secrets: &'a dyn SecretStore,
}

fn app_support(home: &Path) -> PathBuf {
    home.join("Library/Application Support")
}

/// The folders to carry over, under `home`. Application Support holds the
/// remembered vault, the API's connection file, the Activity log, the
/// embedding model and the SQLite grants; WebKit holds the webview's
/// `localStorage`, which is this Mac's sync id and every per-Mac preference.
pub fn folders_under(home: &Path) -> Vec<FolderPair> {
    let support = app_support(home);
    let webkit = home.join("Library/WebKit");
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
            from: webkit.join(LEGACY_EXECUTABLE),
            to: webkit.join(EXECUTABLE),
        },
    ]
}

/// Copies `from` to `to` when there is something to copy and `to` is not
/// there yet. The copy is made beside `to` and renamed into place, so a
/// launch that dies halfway leaves no half-made folder to be taken for DFAI's
/// own; the next launch starts it again.
pub fn copy_folder_once(pair: &FolderPair) -> Result<Copied, String> {
    if exists(&pair.to)? {
        return Ok(Copied::AlreadyThere);
    }
    if !exists(&pair.from)? {
        return Ok(Copied::NothingThere);
    }
    let staging = staging_for(&pair.to)?;
    remove_staging(&staging)?;
    let copied = copy_tree(&pair.from, &staging).and_then(|()| fs::rename(&staging, &pair.to));
    if let Err(error) = copied {
        // The copy has already failed; that is the error to report. A staging
        // folder this cannot remove is removed by the next launch's attempt.
        let _ = remove_staging(&staging);
        return Err(format!("could not copy {}: {error}", pair.from.display()));
    }
    Ok(Copied::Folder)
}

/// Whether anything is at `path`, a dangling link included.
fn exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("cannot look at {}: {error}", path.display())),
    }
}

fn staging_for(to: &Path) -> Result<PathBuf, String> {
    let name = to
        .file_name()
        .ok_or_else(|| format!("{} has no folder name", to.display()))?;
    Ok(to.with_file_name(format!("{}.{STAGING_SUFFIX}", name.to_string_lossy())))
}

/// Removes a staging folder an earlier launch left. It is this module's own:
/// nothing else writes a name ending in `.migrating` beside these folders.
fn remove_staging(staging: &Path) -> Result<(), String> {
    match fs::remove_dir_all(staging) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("cannot clear {}: {error}", staging.display())),
    }
}

/// Copies a tree: files with their permissions (the API token file stays
/// owner-only), folders, and links as links. `fs::copy` clones on APFS, so a
/// large model file costs no time or space.
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    let kind = fs::symlink_metadata(from)?.file_type();
    if kind.is_symlink() {
        return std::os::unix::fs::symlink(fs::read_link(from)?, to);
    }
    if kind.is_file() {
        return fs::copy(from, to).map(|_| ());
    }
    if !kind.is_dir() {
        // A socket or a pipe left by a running process: nothing to carry over.
        return Ok(());
    }
    fs::create_dir(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        copy_tree(&entry.path(), &to.join(entry.file_name()))?;
    }
    fs::set_permissions(to, fs::metadata(from)?.permissions())
}

/// Copies every secret Atlas kept to DFAI's service, under the same account,
/// unless DFAI already has one there. An account that cannot be read — the
/// person denied the Keychain's prompt — is named in `failed` and the rest
/// still copy.
pub fn copy_secrets(from: &dyn SecretStore, to: &dyn SecretStore) -> Result<SecretsCopied, String> {
    let mut report = SecretsCopied::default();
    for account in from.accounts()? {
        match copy_secret(from, to, &account) {
            Ok(true) => report.copied += 1,
            Ok(false) => report.already_there += 1,
            Err(_) => report.failed.push(account),
        }
    }
    Ok(report)
}

/// Whether the secret was copied; false when DFAI had one already.
fn copy_secret(
    from: &dyn SecretStore,
    to: &dyn SecretStore,
    account: &str,
) -> Result<bool, String> {
    if to.get(account)?.is_some() {
        return Ok(false);
    }
    match from.get(account)? {
        Some(value) => to.set(account, &value).map(|()| true),
        // Gone between the listing and the read: nothing to copy.
        None => Ok(false),
    }
}

/// Runs the whole move and says what it did, a line each, for the log. No
/// line ever holds a secret's value: only accounts and paths.
pub fn migrate(migration: &Migration<'_>) -> Vec<String> {
    let mut said = Vec::new();
    for pair in folders_under(migration.home) {
        match copy_folder_once(&pair) {
            Ok(Copied::Folder) => said.push(format!(
                "copied {} to {}",
                pair.from.display(),
                pair.to.display()
            )),
            Ok(_) => {}
            Err(error) => said.push(error),
        }
    }
    said.extend(migrate_secrets_once(migration));
    said
}

fn migrate_secrets_once(migration: &Migration<'_>) -> Option<String> {
    let folder = app_support(migration.home).join(IDENTIFIER);
    let marker = folder.join(MARKER);
    if marker.is_file() {
        return None;
    }
    let report = match copy_secrets(migration.legacy_secrets, migration.secrets) {
        Ok(report) => report,
        Err(error) => return Some(format!("the old secrets could not be listed: {error}")),
    };
    if !report.failed.is_empty() {
        return Some(format!(
            "copied {} secrets; these could not be and are tried again next launch: {}",
            report.copied,
            report.failed.join(", ")
        ));
    }
    let marked = fs::create_dir_all(&folder).and_then(|()| fs::write(&marker, ""));
    Some(match marked {
        Ok(()) => format!("copied {} secrets from Atlas", report.copied),
        Err(error) => format!(
            "copied {} secrets, but could not mark it done: {error}",
            report.copied
        ),
    })
}

/// The move as the app runs it: this Mac's home folder and its Keychain.
/// Called first thing in `run`, before Tauri makes any folder or webview.
#[cfg(target_os = "macos")]
pub fn on_launch() -> Vec<String> {
    use crate::secrets::{KeychainStore, SERVICE};

    let Some(home) = std::env::var_os("HOME") else {
        return vec!["no HOME, so nothing was migrated from Atlas".into()];
    };
    migrate(&Migration {
        home: Path::new(&home),
        legacy_secrets: &KeychainStore::for_service(LEGACY_IDENTIFIER),
        secrets: &KeychainStore::for_service(SERVICE),
    })
}

/// DFAI ships for macOS only; elsewhere there was never an Atlas to move from.
#[cfg(not(target_os = "macos"))]
pub fn on_launch() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests;
