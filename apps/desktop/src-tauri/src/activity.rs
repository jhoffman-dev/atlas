//! The Activity log's files (U-28): one per vault, in the app's data folder on
//! this Mac rather than in the vault, so it never shows up in the vault's Git
//! or sync.
//!
//! This decides nothing. TypeScript hands over lines already made and made
//! safe, decides when the file is over its bound and what is kept, and hands
//! the kept text back to be written whole. Here the text is only appended,
//! read and replaced. A line torn by a crash is TypeScript's to skip; bytes
//! that are not UTF-8 are read as replacement characters rather than refused,
//! so one bad line never costs the rest.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::secrets::vault_scope;

/// The folder under the app's data folder the logs are kept in.
const FOLDER: &str = "activity";

/// The file for a vault: named by a digest of its path, which never appears
/// in the file name or the file.
fn log_path(data_dir: &Path, vault: &str) -> Result<PathBuf, String> {
    if vault.is_empty() {
        return Err("no vault was named for the activity log".into());
    }
    let name = format!("{}.jsonl", vault_scope(Path::new(vault)));
    Ok(data_dir.join(FOLDER).join(name))
}

/// Adds the text to the end of the vault's file, making it and its folder the
/// first time. Starts on a line of its own if the last append was cut short.
/// Answers the file's size in bytes afterwards.
pub fn append_to(data_dir: &Path, vault: &str, text: &str) -> Result<u64, String> {
    let path = log_path(data_dir, vault)?;
    let folder = path.parent().ok_or("the activity log has no folder")?;
    fs::create_dir_all(folder)
        .map_err(|error| format!("cannot make the activity folder: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("cannot open the activity log: {error}"))?;
    let broken = ends_without_newline(&mut file)?;
    let mut bytes = Vec::with_capacity(text.len() + 1);
    if broken {
        bytes.push(b'\n');
    }
    bytes.extend_from_slice(text.as_bytes());
    file.write_all(&bytes)
        .map_err(|error| format!("cannot write the activity log: {error}"))?;
    file.metadata()
        .map(|metadata| metadata.len())
        .map_err(|error| format!("cannot size the activity log: {error}"))
}

/// Whether the file holds something whose last byte is not a line's end.
fn ends_without_newline(file: &mut File) -> Result<bool, String> {
    let length = file
        .metadata()
        .map_err(|error| format!("cannot size the activity log: {error}"))?
        .len();
    if length == 0 {
        return Ok(false);
    }
    let mut last = [0u8; 1];
    file.seek(SeekFrom::Start(length - 1))
        .and_then(|_| file.read_exact(&mut last))
        .map_err(|error| format!("cannot read the activity log: {error}"))?;
    Ok(last[0] != b'\n')
}

/// The vault's whole file; empty when it has none yet.
pub fn read_from(data_dir: &Path, vault: &str) -> Result<String, String> {
    let path = log_path(data_dir, vault)?;
    match fs::read(&path) {
        Ok(bytes) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("cannot read the activity log: {error}")),
    }
}

/// Replaces the vault's file with the text, whole: written beside it first and
/// renamed over it, so a crash part-way leaves the old file, never half a new one.
pub fn replace_in(data_dir: &Path, vault: &str, text: &str) -> Result<(), String> {
    let path = log_path(data_dir, vault)?;
    let folder = path.parent().ok_or("the activity log has no folder")?;
    fs::create_dir_all(folder)
        .map_err(|error| format!("cannot make the activity folder: {error}"))?;
    let staged = path.with_extension("jsonl.new");
    fs::write(&staged, text).map_err(|error| format!("cannot write the activity log: {error}"))?;
    fs::rename(&staged, &path).map_err(|error| format!("cannot replace the activity log: {error}"))
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|error| error.to_string())
}

/// Runs file work off the main thread and off the async runtime's workers: a
/// sync command runs on the main thread, where a slow disk or a 5 MB rewrite
/// would freeze the window.
async fn off_main<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| format!("the activity log stopped: {error}"))?
}

#[tauri::command]
pub async fn activity_append(app: AppHandle, vault: String, text: String) -> Result<u64, String> {
    let data = data_dir(&app)?;
    off_main(move || append_to(&data, &vault, &text)).await
}

#[tauri::command]
pub async fn activity_read(app: AppHandle, vault: String) -> Result<String, String> {
    let data = data_dir(&app)?;
    off_main(move || read_from(&data, &vault)).await
}

#[tauri::command]
pub async fn activity_replace(app: AppHandle, vault: String, text: String) -> Result<(), String> {
    let data = data_dir(&app)?;
    off_main(move || replace_in(&data, &vault, &text)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const VAULT: &str = "/Users/j/My Vault";

    #[test]
    fn runs_file_work_on_another_thread_and_passes_its_answer_back() {
        let caller = std::thread::current().id();
        let (ran_on, answer) = tauri::async_runtime::block_on(off_main(move || {
            Ok::<_, String>((std::thread::current().id(), 7))
        }))
        .unwrap();
        assert_ne!(ran_on, caller);
        assert_eq!(answer, 7);
        let refused = tauri::async_runtime::block_on(off_main(|| Err::<(), _>("full".into())));
        assert_eq!(refused, Err("full".to_string()));
    }

    #[test]
    fn appends_lines_in_order_and_answers_the_size() {
        let data = tempdir().unwrap();
        let first = append_to(data.path(), VAULT, "{\"a\":1}\n").unwrap();
        let second = append_to(data.path(), VAULT, "{\"a\":2}\n{\"a\":3}\n").unwrap();
        assert_eq!(first, 8);
        assert_eq!(second, 24);
        assert_eq!(
            read_from(data.path(), VAULT).unwrap(),
            "{\"a\":1}\n{\"a\":2}\n{\"a\":3}\n"
        );
    }

    #[test]
    fn keeps_the_file_in_the_data_folder_named_without_the_vault_path() {
        let data = tempdir().unwrap();
        append_to(data.path(), VAULT, "x\n").unwrap();
        let entries: Vec<String> = fs::read_dir(data.path().join(FOLDER))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].ends_with(".jsonl"));
        assert!(!entries[0].contains("Vault"));
    }

    #[test]
    fn keeps_each_vault_apart() {
        let data = tempdir().unwrap();
        append_to(data.path(), VAULT, "mine\n").unwrap();
        append_to(data.path(), "/Users/j/Other", "theirs\n").unwrap();
        assert_eq!(read_from(data.path(), VAULT).unwrap(), "mine\n");
        assert_eq!(
            read_from(data.path(), "/Users/j/Other").unwrap(),
            "theirs\n"
        );
    }

    #[test]
    fn reads_a_vault_with_no_log_as_empty() {
        let data = tempdir().unwrap();
        assert_eq!(read_from(data.path(), VAULT).unwrap(), "");
    }

    #[test]
    fn starts_an_append_on_its_own_line_after_one_cut_short() {
        let data = tempdir().unwrap();
        append_to(data.path(), VAULT, "{\"torn\":").unwrap();
        append_to(data.path(), VAULT, "{\"whole\":1}\n").unwrap();
        assert_eq!(
            read_from(data.path(), VAULT).unwrap(),
            "{\"torn\":\n{\"whole\":1}\n"
        );
    }

    #[test]
    fn reads_bytes_that_are_not_utf8_rather_than_refusing_the_file() {
        let data = tempdir().unwrap();
        let path = log_path(data.path(), VAULT).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, b"{\"ok\":1}\n\xff\xfe broken\n{\"ok\":2}\n").unwrap();
        let text = read_from(data.path(), VAULT).unwrap();
        assert!(text.starts_with("{\"ok\":1}\n"));
        assert!(text.ends_with("{\"ok\":2}\n"));
    }

    #[test]
    fn replaces_the_file_whole_and_leaves_nothing_staged() {
        let data = tempdir().unwrap();
        append_to(data.path(), VAULT, "old one\nold two\n").unwrap();
        replace_in(data.path(), VAULT, "kept\n").unwrap();
        assert_eq!(read_from(data.path(), VAULT).unwrap(), "kept\n");
        assert_eq!(append_to(data.path(), VAULT, "next\n").unwrap(), 10);
        let staged: Vec<_> = fs::read_dir(data.path().join(FOLDER))
            .unwrap()
            .filter(|entry| {
                entry
                    .as_ref()
                    .unwrap()
                    .path()
                    .to_string_lossy()
                    .ends_with(".new")
            })
            .collect();
        assert!(staged.is_empty());
    }

    #[test]
    fn replaces_a_log_that_was_never_written() {
        let data = tempdir().unwrap();
        replace_in(data.path(), VAULT, "").unwrap();
        assert_eq!(read_from(data.path(), VAULT).unwrap(), "");
    }

    #[test]
    fn refuses_to_write_for_no_vault() {
        let data = tempdir().unwrap();
        assert!(append_to(data.path(), "", "x\n").is_err());
        assert!(read_from(data.path(), "").is_err());
        assert!(replace_in(data.path(), "", "x\n").is_err());
    }

    #[test]
    fn says_why_when_the_folder_cannot_be_made() {
        let data = tempdir().unwrap();
        // A file where the folder should be.
        fs::write(data.path().join(FOLDER), "in the way").unwrap();
        let refused = append_to(data.path(), VAULT, "x\n").unwrap_err();
        assert!(
            refused.contains("cannot make the activity folder"),
            "{refused}"
        );
    }
}
