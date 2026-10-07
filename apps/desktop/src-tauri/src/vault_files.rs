//! Writing files that are not notes: the pages, scripts and pictures of an
//! artifact's saved copy.
//!
//! Which files a copy may hold, and where, is decided in TypeScript (the
//! domain's `artifactFileRefusal`). This writes the bytes it is handed through
//! the same path guard as every other write and refuses only what would be
//! unsafe for the disk: overwriting a file unasked, appending to a file of
//! another length than the caller expected, or growing a file past what the
//! vault will read back. The one write that replaces — an artifact's generated
//! thumbnail, made again — says so, and lands whole or not at all.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;

use tauri::ipc::{InvokeBody, Request};
use tauri::State;

use crate::vault::{resolve, resolve_new, root_for_write, VaultState, MAX_BINARY_BYTES};

/// The headers the frontend names the write in, percent-encoded, since a
/// header carries only ASCII. `tauri-vault-fs.ts` sends the same names.
const PATH_HEADER: &str = "atlas-path";
const OFFSET_HEADER: &str = "atlas-offset";
const VAULT_HEADER: &str = "atlas-vault";
/// Sent as `1` to replace a whole file rather than create or append to one.
const REPLACE_HEADER: &str = "atlas-replace";

/// Writes `bytes` at `offset` into the file at `relative`, and reports its new
/// length.
///
/// At offset 0 the file is created and an existing one is never overwritten —
/// `create_new` fails even on a symlink, so it cannot be pointed elsewhere.
/// Past 0 the file must already be exactly `offset` bytes long, so a chunk
/// sent twice or out of order is refused rather than corrupting it; it is
/// resolved in full first, so an append never follows a link out of the vault.
pub(crate) fn write_binary_at(
    root: &Path,
    relative: &str,
    bytes: &[u8],
    offset: u64,
) -> Result<u64, String> {
    let end = offset.saturating_add(bytes.len() as u64);
    refuse_past_ceiling(end)?;

    let mut handle = if offset == 0 {
        OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(resolve_new(root, relative)?)
            .map_err(|error| match error.kind() {
                ErrorKind::AlreadyExists => "a file with that name already exists".to_string(),
                _ => format!("cannot create the file: {error}"),
            })?
    } else {
        let file = resolve(root, relative)?;
        let handle = OpenOptions::new()
            .append(true)
            .open(&file)
            .map_err(|error| format!("cannot open the file: {error}"))?;
        let length = handle
            .metadata()
            .map_err(|error| format!("cannot read the file: {error}"))?
            .len();
        if length != offset {
            return Err("the file is not the length the write expected".into());
        }
        handle
    };

    handle
        .write_all(bytes)
        .map_err(|error| format!("cannot write the file: {error}"))?;
    Ok(end)
}

fn refuse_past_ceiling(end: u64) -> Result<(), String> {
    if end > MAX_BINARY_BYTES {
        return Err(format!(
            "a file is at most {} MB",
            MAX_BINARY_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

/// Replaces the file at `relative` with `bytes`, or creates it, and reports
/// its new length.
///
/// Written beside it and renamed over it, as a note is saved, so a reader sees
/// the old file or the new one and never half of either. A rename replaces the
/// name, never what a link at that name points to, so it cannot write through
/// a link out of the vault; a folder at the name is refused by the rename.
pub(crate) fn replace_binary_at(root: &Path, relative: &str, bytes: &[u8]) -> Result<u64, String> {
    refuse_past_ceiling(bytes.len() as u64)?;
    let file = resolve_new(root, relative)?;
    let directory = file.parent().ok_or("a file needs a folder")?;
    let name = file
        .file_name()
        .ok_or("a file needs a name")?
        .to_string_lossy()
        .into_owned();
    let temporary = directory.join(format!(".{name}.atlas-tmp"));
    // A temporary left by a write that died is removed, never written through:
    // it could be a link planted to point anywhere.
    match fs::remove_file(&temporary) {
        Err(error) if error.kind() != ErrorKind::NotFound => {
            return Err(format!("cannot clear the way for the file: {error}"));
        }
        _ => {}
    }
    let written = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .and_then(|mut handle| handle.write_all(bytes))
        .and_then(|()| fs::rename(&temporary, &file));
    if let Err(error) = written {
        let _ = fs::remove_file(&temporary); // Best effort; the write already failed.
        return Err(format!("cannot write the file: {error}"));
    }
    Ok(bytes.len() as u64)
}

/// A header's value, percent-decoded; None when it was not sent.
pub(crate) fn header(request: &Request<'_>, name: &str) -> Result<Option<String>, String> {
    let Some(value) = request.headers().get(name) else {
        return Ok(None);
    };
    let text = value
        .to_str()
        .map_err(|_| format!("the {name} header is not text"))?;
    percent_encoding::percent_decode_str(text)
        .decode_utf8()
        .map(|decoded| Some(decoded.into_owned()))
        .map_err(|_| format!("the {name} header is not UTF-8"))
}

/// Writes the raw body into a file of the open vault. The path, the offset
/// and the vault the write is meant for arrive as headers.
#[tauri::command]
pub fn write_binary_file(
    state: State<'_, VaultState>,
    request: Request<'_>,
) -> Result<u64, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("the file's bytes must be the body of the call".into());
    };
    let path = header(&request, PATH_HEADER)?.ok_or("no file path was given")?;
    let offset = header(&request, OFFSET_HEADER)?
        .unwrap_or_else(|| "0".into())
        .parse::<u64>()
        .map_err(|_| "the offset is not a whole number".to_string())?;
    let vault = header(&request, VAULT_HEADER)?;
    let replace = header(&request, REPLACE_HEADER)?.as_deref() == Some("1");
    if replace && offset != 0 {
        return Err("a file is replaced whole, from offset 0".into());
    }

    let root = root_for_write(state.get(), vault.as_deref())?;
    let length = if replace {
        replace_binary_at(&root, &path, bytes)?
    } else {
        write_binary_at(&root, &path, bytes, offset)?
    };
    log::info!("wrote {path} ({length} bytes)");
    Ok(length)
}

#[cfg(test)]
mod tests {
    use super::{replace_binary_at, write_binary_at};
    use crate::vault::MAX_BINARY_BYTES;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn creates_a_file_with_the_exact_bytes() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("a")).unwrap();
        let bytes = [0u8, 159, 146, 150, 255];
        assert_eq!(write_binary_at(vault.path(), "a/p.png", &bytes, 0), Ok(5));
        assert_eq!(fs::read(vault.path().join("a/p.png")).unwrap(), bytes);
    }

    #[test]
    fn never_overwrites_a_file() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("p.png"), "old").unwrap();
        let error = write_binary_at(vault.path(), "p.png", b"new", 0).unwrap_err();
        assert_eq!(error, "a file with that name already exists");
        assert_eq!(fs::read(vault.path().join("p.png")).unwrap(), b"old");
    }

    #[test]
    fn appends_a_chunk_at_the_length_it_expects() {
        let vault = tempdir().unwrap();
        write_binary_at(vault.path(), "p.js", b"abc", 0).unwrap();
        assert_eq!(write_binary_at(vault.path(), "p.js", b"def", 3), Ok(6));
        assert_eq!(fs::read(vault.path().join("p.js")).unwrap(), b"abcdef");
    }

    #[test]
    fn refuses_a_chunk_sent_twice_or_out_of_order() {
        let vault = tempdir().unwrap();
        write_binary_at(vault.path(), "p.js", b"abc", 0).unwrap();
        for offset in [1, 4] {
            let error = write_binary_at(vault.path(), "p.js", b"x", offset).unwrap_err();
            assert_eq!(error, "the file is not the length the write expected");
        }
        assert_eq!(fs::read(vault.path().join("p.js")).unwrap(), b"abc");
    }

    #[test]
    fn refuses_an_append_to_a_file_that_is_not_there() {
        let vault = tempdir().unwrap();
        assert!(write_binary_at(vault.path(), "p.js", b"x", 3).is_err());
        assert!(!vault.path().join("p.js").exists());
    }

    #[test]
    fn refuses_to_grow_a_file_past_the_ceiling() {
        let vault = tempdir().unwrap();
        let error = write_binary_at(vault.path(), "p.png", b"x", MAX_BINARY_BYTES).unwrap_err();
        assert!(error.starts_with("a file is at most"));
        assert!(write_binary_at(vault.path(), "q.png", b"x", u64::MAX).is_err());
    }

    #[test]
    fn refuses_to_write_outside_the_vault() {
        let vault = tempdir().unwrap();
        assert!(write_binary_at(vault.path(), "../escape.png", b"x", 0).is_err());
        assert!(write_binary_at(vault.path(), "missing/p.png", b"x", 0).is_err());
    }

    #[test]
    fn refuses_to_append_through_a_link_out_of_the_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret.js"), "abc").unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.js"), vault.path().join("p.js"))
            .unwrap();
        assert!(write_binary_at(vault.path(), "p.js", b"x", 3).is_err());
        assert!(write_binary_at(vault.path(), "p.js", b"x", 0).is_err());
        assert_eq!(fs::read(outside.path().join("secret.js")).unwrap(), b"abc");
    }

    #[test]
    fn replaces_a_file_whole_or_creates_it() {
        let vault = tempdir().unwrap();
        assert_eq!(replace_binary_at(vault.path(), "t.png", b"first"), Ok(5));
        assert_eq!(replace_binary_at(vault.path(), "t.png", b"new"), Ok(3));
        assert_eq!(fs::read(vault.path().join("t.png")).unwrap(), b"new");
        assert!(!vault.path().join(".t.png.atlas-tmp").exists());
    }

    #[test]
    fn replacing_never_writes_through_a_link_or_a_planted_temporary() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret"), "abc").unwrap();
        let secret = outside.path().join("secret");
        std::os::unix::fs::symlink(&secret, vault.path().join("t.png")).unwrap();
        std::os::unix::fs::symlink(&secret, vault.path().join(".t.png.atlas-tmp")).unwrap();
        assert_eq!(replace_binary_at(vault.path(), "t.png", b"x"), Ok(1));
        assert_eq!(fs::read(&secret).unwrap(), b"abc");
        assert_eq!(fs::read(vault.path().join("t.png")).unwrap(), b"x");
    }

    #[test]
    fn replacing_refuses_a_folder_the_ceiling_and_a_way_out() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("t.png")).unwrap();
        assert!(replace_binary_at(vault.path(), "t.png", b"x").is_err());
        assert!(vault.path().join("t.png").is_dir());
        assert!(replace_binary_at(vault.path(), "../t.png", b"x").is_err());
        let big = vec![0u8; MAX_BINARY_BYTES as usize + 1];
        assert!(replace_binary_at(vault.path(), "u.png", &big).is_err());
        assert!(!vault.path().join("u.png").exists());
    }
}
