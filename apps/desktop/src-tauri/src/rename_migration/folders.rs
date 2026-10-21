//! Copying one folder Atlas kept to where DFAI keeps the same thing.

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const STAGING_SUFFIX: &str = "migrating";
const SET_ASIDE_SUFFIX: &str = "pre-dfai";

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
    /// The new folder exists already, so it is left alone.
    AlreadyThere,
}

/// Copies `from` to `to` when there is something to copy and `to` is not
/// there yet. The copy is made beside `to` and renamed into place, so a
/// launch that dies halfway leaves no half-made folder; the next launch
/// starts it again. The migration copies through `copy_folder_noting`;
/// tests check the folder rules through this.
#[cfg(test)]
pub fn copy_folder_once(pair: &FolderPair) -> Result<Copied, String> {
    copy_folder_noting(pair, &mut Vec::new())
}

/// `copy_folder_once`, adding to `notes` each file that vanished while it was
/// being copied — Atlas, or WebKit, removing it — which is skipped rather
/// than failing the whole copy.
pub fn copy_folder_noting(pair: &FolderPair, notes: &mut Vec<String>) -> Result<Copied, String> {
    if exists(&pair.to)? {
        return Ok(Copied::AlreadyThere);
    }
    if !exists(&pair.from)? {
        return Ok(Copied::NothingThere);
    }
    // An old folder that is a link is followed and its contents copied, so the
    // new folder is never a link into Atlas's own data.
    let source = fs::canonicalize(&pair.from)
        .map_err(|error| format!("cannot follow {}: {error}", pair.from.display()))?;
    let staging = beside(&pair.to, STAGING_SUFFIX)?;
    remove_staging(&staging)?;
    let copied = copy_tree(&source, &staging, notes).and_then(|()| fs::rename(&staging, &pair.to));
    if let Err(error) = copied {
        // The copy has already failed; that is the error to report. A staging
        // folder this cannot remove is removed by the next launch's attempt.
        let _ = remove_staging(&staging);
        return Err(format!("could not copy {}: {error}", pair.from.display()));
    }
    Ok(Copied::Folder)
}

/// Moves a folder that is in the way to `<folder>.pre-dfai-<n>`, the first
/// number free, and says where. Never deletes it: it may hold work.
pub fn set_aside(folder: &Path) -> Result<PathBuf, String> {
    let base = beside(folder, SET_ASIDE_SUFFIX)?;
    let free = (1..)
        .map(|at| PathBuf::from(format!("{}-{at}", base.display())))
        .find(|candidate| !matches!(exists(candidate), Ok(true)))
        .ok_or("no free name to set a folder aside under")?;
    fs::rename(folder, &free)
        .map_err(|error| format!("cannot set {} aside: {error}", folder.display()))?;
    Ok(free)
}

/// Whether anything is at `path`, a dangling link included.
pub fn exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("cannot look at {}: {error}", path.display())),
    }
}

fn beside(folder: &Path, suffix: &str) -> Result<PathBuf, String> {
    let name = folder
        .file_name()
        .ok_or_else(|| format!("{} has no folder name", folder.display()))?;
    Ok(folder.with_file_name(format!("{}.{suffix}", name.to_string_lossy())))
}

/// Removes a staging folder an earlier launch left. It is this module's own:
/// nothing else writes a name ending in `.migrating` beside these folders.
/// A read-only folder in it, copied as Atlas had it, is made writable first.
fn remove_staging(staging: &Path) -> Result<(), String> {
    if !exists(staging)? {
        return Ok(());
    }
    make_writable(staging)
        .and_then(|()| fs::remove_dir_all(staging))
        .map_err(|error| format!("cannot clear {}: {error}", staging.display()))
}

/// Gives the owner write on every folder under `path`, links not followed.
fn make_writable(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() {
        return Ok(());
    }
    let mode = metadata.permissions().mode();
    fs::set_permissions(path, fs::Permissions::from_mode(mode | 0o700))?;
    for entry in fs::read_dir(path)? {
        make_writable(&entry?.path())?;
    }
    Ok(())
}

/// Copies a tree: files with their permissions (the API token file stays
/// owner-only), folders, and links as links. `fs::copy` clones on APFS, so a
/// large model file costs no time or space.
fn copy_tree(from: &Path, to: &Path, notes: &mut Vec<String>) -> io::Result<()> {
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
        let source = entry?.path();
        let target = to.join(source.file_name().unwrap_or_default());
        match copy_tree(&source, &target, notes) {
            Err(error) if error.kind() == io::ErrorKind::NotFound && !source.exists() => {
                notes.push(format!(
                    "{} vanished while it was copied; skipped",
                    source.display()
                ));
            }
            result => result?,
        }
    }
    fs::set_permissions(to, fs::metadata(from)?.permissions())
}
