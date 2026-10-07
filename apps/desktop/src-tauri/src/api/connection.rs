//! The connection file: how another tool on this machine finds the API.
//!
//! `api.json` holds the port, the token, the format version and whether the API
//! is on. It lives in the app's data directory and is readable only by its owner
//! (ADR-0016) — **never in a vault**, because vaults get synced and shared and a
//! token in one is a token published.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const FILE_NAME: &str = "api.json";
pub const FORMAT_VERSION: u32 = 1;
const TOKEN_BYTES: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConnectionFile {
    /// The port last bound, or 0 before the server has ever run.
    pub port: u16,
    pub token: String,
    pub version: u32,
    pub enabled: bool,
}

impl ConnectionFile {
    /// Off, with a fresh token and no port yet: the state of a machine that has
    /// never turned the API on.
    pub fn fresh() -> Result<Self, String> {
        Ok(ConnectionFile {
            port: 0,
            token: new_token()?,
            version: FORMAT_VERSION,
            enabled: false,
        })
    }

    fn is_usable(&self) -> bool {
        self.version == FORMAT_VERSION && is_token(&self.token)
    }
}

/// 32 bytes from the operating system's CSPRNG, as 64 lowercase hex characters.
pub fn new_token() -> Result<String, String> {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::fill(&mut bytes).map_err(|error| format!("cannot make a token: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn is_token(text: &str) -> bool {
    text.len() == TOKEN_BYTES * 2
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn path_in(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Reads the file, or starts a fresh one when it is missing or unusable, and
/// writes it back in that case so the file on disk always matches what runs.
///
/// A malformed file is replaced rather than fatal: it holds nothing the user
/// made, and the fresh one is off, so recovering can never turn the API on.
///
/// A usable file that others could read — restored from a backup, copied by
/// hand — keeps its port and on/off, but its token may already have been read,
/// so it gets a new one and is written back owner-only.
pub fn load_or_create(dir: &Path) -> Result<ConnectionFile, String> {
    let path = path_in(dir);
    let existing = match read_with_exposure(&path) {
        Ok((bytes, exposed)) => serde_json::from_slice::<ConnectionFile>(&bytes)
            .ok()
            .filter(ConnectionFile::is_usable)
            .map(|file| (file, exposed)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("cannot read {}: {error}", path.display())),
    };
    match existing {
        Some((file, false)) => return Ok(file),
        Some((file, true)) => {
            log::warn!(
                "{} was readable by other users; it is now private and its token was replaced",
                path.display()
            );
            let file = ConnectionFile {
                token: new_token()?,
                ..file
            };
            save(dir, &file)?;
            return Ok(file);
        }
        None => {}
    }
    log::info!("starting a new API connection file at {}", path.display());
    let file = ConnectionFile::fresh()?;
    save(dir, &file)?;
    Ok(file)
}

/// The file's bytes, and whether anyone but its owner may read it — both from
/// the one open handle, so the mode judged is the mode of the bytes read.
fn read_with_exposure(path: &Path) -> std::io::Result<(Vec<u8>, bool)> {
    let mut opened = File::open(path)?;
    let mut bytes = Vec::new();
    std::io::Read::read_to_end(&mut opened, &mut bytes)?;
    #[cfg(unix)]
    let exposed = {
        use std::os::unix::fs::PermissionsExt;
        opened.metadata()?.permissions().mode() & 0o077 != 0
    };
    #[cfg(not(unix))]
    let exposed = false;
    Ok((bytes, exposed))
}

/// Writes the file atomically, owner-only from the moment it exists.
///
/// The bytes go to a new temporary file created with mode 0600 — so the token is
/// never on disk under looser permissions, not even for an instant — and that
/// file is renamed over the old one, so a reader sees the old file or the new
/// one and never half of either.
pub fn save(dir: &Path, file: &ConnectionFile) -> Result<(), String> {
    create_private_dir(dir)?;
    let json = serde_json::to_vec_pretty(file).map_err(|error| error.to_string())?;
    let temporary = dir.join(format!(".{FILE_NAME}.{}.tmp", std::process::id()));
    let written = write_private(&temporary, &json)
        .and_then(|()| fs::rename(&temporary, path_in(dir)))
        .map_err(|error| format!("cannot write {}: {error}", path_in(dir).display()));
    if written.is_err() {
        // Best effort: the write already failed and that is the error reported;
        // a leftover temporary file is harmless and replaced on the next save.
        let _ = fs::remove_file(&temporary);
        return written;
    }
    if let Err(error) = sync_dir(dir) {
        // The rename has happened and every reader already sees the new file,
        // so calling the save failed would leave the caller believing the old
        // one; only its surviving a power cut right now is in doubt.
        log::warn!("cannot sync {} after saving: {error}", dir.display());
    }
    Ok(())
}

/// Makes the rename itself durable: without syncing the directory, a crash can
/// leave the old entry in place even though the new file's bytes are on disk.
#[cfg(unix)]
fn sync_dir(dir: &Path) -> std::io::Result<()> {
    File::open(dir)?.sync_all()
}

/// Windows cannot open a directory as a file to sync it; its rename is
/// journaled by NTFS.
#[cfg(not(unix))]
fn sync_dir(_dir: &Path) -> std::io::Result<()> {
    Ok(())
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    // A stale temporary from a crashed save would make `create_new` fail, and
    // it may have looser permissions than we would give it, so it goes first.
    match fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut out: File = options.open(path)?;
    out.write_all(bytes)?;
    out.sync_all()
}

fn create_private_dir(dir: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder
        .create(dir)
        .map_err(|error| format!("cannot create {}: {error}", dir.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn tokens_are_64_hex_characters_and_differ_each_time() {
        let first = new_token().unwrap();
        let second = new_token().unwrap();
        assert!(is_token(&first), "{first}");
        assert!(is_token(&second), "{second}");
        assert_ne!(first, second);
    }

    #[test]
    fn a_new_file_is_off_with_a_token_and_no_port() {
        let dir = tempfile::tempdir().unwrap();
        let file = load_or_create(dir.path()).unwrap();
        assert!(!file.enabled);
        assert_eq!(file.port, 0);
        assert_eq!(file.version, 1);
        assert!(is_token(&file.token));
        assert!(path_in(dir.path()).exists(), "the fresh file is written");
    }

    #[test]
    fn round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let file = ConnectionFile {
            port: 27183,
            enabled: true,
            ..ConnectionFile::fresh().unwrap()
        };
        save(dir.path(), &file).unwrap();
        assert_eq!(load_or_create(dir.path()).unwrap(), file);
    }

    #[test]
    fn writes_the_contract_fields() {
        let dir = tempfile::tempdir().unwrap();
        let file = ConnectionFile::fresh().unwrap();
        save(dir.path(), &file).unwrap();
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(path_in(dir.path())).unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "port": 0, "token": file.token, "version": 1, "enabled": false })
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_file_is_readable_only_by_its_owner() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("dev.jhoffman.atlas");
        save(&nested, &ConnectionFile::fresh().unwrap()).unwrap();
        assert_eq!(mode_of(&path_in(&nested)), 0o600);
        assert_eq!(mode_of(&nested), 0o700);
    }

    #[cfg(unix)]
    #[test]
    fn replacing_a_loose_file_leaves_a_private_one() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        fs::write(path_in(dir.path()), b"{}").unwrap();
        fs::set_permissions(path_in(dir.path()), fs::Permissions::from_mode(0o644)).unwrap();

        save(dir.path(), &ConnectionFile::fresh().unwrap()).unwrap();
        assert_eq!(mode_of(&path_in(dir.path())), 0o600);
    }

    #[cfg(unix)]
    #[test]
    fn loading_a_file_others_can_read_makes_it_private_with_a_new_token() {
        use std::os::unix::fs::PermissionsExt;
        for loose in [0o640, 0o604, 0o660] {
            let dir = tempfile::tempdir().unwrap();
            let original = ConnectionFile {
                port: 27183,
                enabled: true,
                ..ConnectionFile::fresh().unwrap()
            };
            save(dir.path(), &original).unwrap();
            fs::set_permissions(path_in(dir.path()), fs::Permissions::from_mode(loose)).unwrap();

            let loaded = load_or_create(dir.path()).unwrap();
            assert_eq!(mode_of(&path_in(dir.path())), 0o600, "{loose:o}");
            assert_ne!(loaded.token, original.token, "{loose:o}");
            assert!(is_token(&loaded.token));
            assert_eq!((loaded.port, loaded.enabled), (27183, true), "{loose:o}");
            assert_eq!(load_or_create(dir.path()).unwrap(), loaded, "written back");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_stale_temporary_from_a_crash_does_not_block_or_leak_into_the_save() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let stale = dir
            .path()
            .join(format!(".{FILE_NAME}.{}.tmp", std::process::id()));
        fs::write(&stale, b"half a file").unwrap();
        fs::set_permissions(&stale, fs::Permissions::from_mode(0o644)).unwrap();

        let file = ConnectionFile::fresh().unwrap();
        save(dir.path(), &file).unwrap();
        assert_eq!(load_or_create(dir.path()).unwrap(), file);
        assert_eq!(mode_of(&path_in(dir.path())), 0o600);
        assert!(!stale.exists());
    }

    #[test]
    fn the_save_is_a_rename_so_no_temporary_is_left_behind() {
        let dir = tempfile::tempdir().unwrap();
        save(dir.path(), &ConnectionFile::fresh().unwrap()).unwrap();
        save(dir.path(), &ConnectionFile::fresh().unwrap()).unwrap();
        let names: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![FILE_NAME.to_string()]);
    }

    #[test]
    fn a_malformed_file_is_replaced_by_a_fresh_one_that_is_off() {
        for broken in [
            &b"not json"[..],
            b"",
            br#"{"port":1,"enabled":true}"#,
            br#"{"port":1,"token":"short","version":1,"enabled":true}"#,
            br#"{"port":1,"token":"ZZ12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12","version":1,"enabled":true}"#,
            br#"{"port":1,"token":"ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12","version":2,"enabled":true}"#,
        ] {
            let dir = tempfile::tempdir().unwrap();
            fs::write(path_in(dir.path()), broken).unwrap();

            let recovered = load_or_create(dir.path()).unwrap();
            assert!(!recovered.enabled, "{}", String::from_utf8_lossy(broken));
            assert!(is_token(&recovered.token));
            assert_eq!(load_or_create(dir.path()).unwrap(), recovered, "it was written back");
        }
    }

    #[test]
    fn an_unreadable_location_is_an_error_not_a_reset() {
        let dir = tempfile::tempdir().unwrap();
        // A directory where the file should be cannot be read as one.
        fs::create_dir(path_in(dir.path())).unwrap();
        assert!(load_or_create(dir.path()).is_err());
    }
}
