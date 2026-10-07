//! Scoped read access to the user's vault.
//!
//! This module is the only place the app touches the filesystem. It translates
//! between vault-relative paths and real ones, and refuses anything that resolves
//! outside the chosen vault root. It holds no product rules: what a note *means*
//! is decided in TypeScript.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Refuse to read anything larger than this as text; a vault note is never this big,
/// and a multi-gigabyte file would freeze the webview.
const MAX_TEXT_BYTES: u64 = 10 * 1024 * 1024;

/// Images are held in memory while they are displayed, so the ceiling is lower
/// than for text and a stray video file cannot exhaust memory.
pub(crate) const MAX_BINARY_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultLocation {
    pub absolute_path: String,
    pub name: String,
}

/// A note's text together with the modification time it was read at. The client
/// hands that time back when saving, so an edit made elsewhere is never clobbered.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContents {
    pub text: String,
    pub modified: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultEntry {
    pub name: String,
    pub path: String,
    pub kind: &'static str,
    /// Only meaningful for notes; the tree ignores both.
    pub modified: u64,
    pub size: u64,
}

#[derive(Default)]
pub struct VaultState(Mutex<Option<PathBuf>>);

impl VaultState {
    /// The open vault's root, for code outside this module that needs to reach it.
    pub fn root(&self) -> Option<PathBuf> {
        self.get()
    }

    /// The guarded value is one path. A thread that panicked while holding this
    /// lock cannot have left that path half-written, so the poison flag says
    /// nothing useful here — and honouring it would turn one panic somewhere
    /// else into every later vault call panicking for the rest of the session.
    fn set(&self, root: PathBuf) {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(root);
    }

    pub(crate) fn get(&self) -> Option<PathBuf> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

pub(crate) fn location_of(root: &Path) -> VaultLocation {
    VaultLocation {
        absolute_path: root.to_string_lossy().into_owned(),
        name: root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| root.to_string_lossy().into_owned()),
    }
}

fn config_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("no config directory: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("cannot create config directory: {error}"))?;
    Ok(dir.join("vault.json"))
}

fn remember(app: &AppHandle, location: &VaultLocation) -> Result<(), String> {
    let path = config_file(app)?;
    let json = serde_json::to_string_pretty(location).map_err(|error| error.to_string())?;
    fs::write(path, json).map_err(|error| format!("cannot save vault choice: {error}"))
}

fn recall(app: &AppHandle) -> Option<VaultLocation> {
    let path = config_file(app).ok()?;
    let json = fs::read_to_string(path).ok()?;
    let location: VaultLocation = serde_json::from_str(&json).ok()?;
    // A remembered vault may have been moved or deleted since last launch.
    Path::new(&location.absolute_path)
        .is_dir()
        .then_some(location)
}

/// Resolves a vault-relative path to a real one, or refuses.
///
/// Two checks, because neither alone is enough: the lexical check rejects `..`
/// before it touches the disk, and the canonical check catches a symlink whose
/// target sits outside the vault.
pub(crate) fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.contains('\0') {
        return Err("path contains a null byte".into());
    }
    refuse_git_folder(relative)?;

    let mut resolved = root.to_path_buf();
    for segment in relative.split('/').filter(|segment| !segment.is_empty()) {
        match Path::new(segment).components().next() {
            Some(Component::Normal(name)) => resolved.push(name),
            _ => return Err(format!("path segment {segment:?} is not allowed")),
        }
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("vault is unreadable: {error}"))?;
    let canonical = resolved
        .canonicalize()
        .map_err(|error| format!("no such entry: {error}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("path escapes the vault".into());
    }
    refuse_hidden_detour(&canonical_root, &canonical, relative)?;
    refuse_git_folder_reached(&canonical_root, &canonical)?;
    Ok(canonical)
}

/// Refuses any path into a `.git` folder, or at a `.git` file, whatever case
/// it is spelled in.
///
/// Atlas runs `git` in the vault (U-29), and git trusts what is in `.git`: a
/// `.git/config` naming `core.sshCommand`, or a `.git` file pointing at another
/// repository, is a program run the next time the vault syncs. The webview is
/// the untrusted side (ADR-0017), so no vault read or write may reach there;
/// only `git` itself, run by the host, touches it. `.gitignore` is not `.git`.
fn refuse_git_folder(relative: &str) -> Result<(), String> {
    if relative
        .split('/')
        .any(|segment| segment.eq_ignore_ascii_case(".git"))
    {
        return Err("git's own folder is not part of the vault".into());
    }
    Ok(())
}

/// The same refusal for where a path lands once links are followed.
fn refuse_git_folder_reached(canonical_root: &Path, canonical: &Path) -> Result<(), String> {
    let Ok(reached) = canonical.strip_prefix(canonical_root) else {
        return Ok(());
    };
    refuse_git_folder(&reached.to_string_lossy())
}

/// Refuses a path that a link carried into a hidden folder or file — `.atlas`,
/// `.git`, `Projects/.obsidian` — that the path itself did not name.
///
/// The TypeScript side keeps its callers out of any hidden segment, however
/// deep (`isUserSpace`), by what a path says; a link in user space would
/// otherwise let a path that says `Notes/…` read or write one. This decides
/// nothing about which folders matter: any hidden one is reached only by naming it.
fn refuse_hidden_detour(
    canonical_root: &Path,
    canonical: &Path,
    relative: &str,
) -> Result<(), String> {
    let Ok(reached) = canonical.strip_prefix(canonical_root) else {
        return Ok(());
    };
    let named: Vec<&str> = relative
        .split('/')
        .filter(|segment| segment.starts_with('.'))
        .collect();
    let detour = reached.components().any(|component| {
        let Component::Normal(segment) = component else {
            return false;
        };
        let segment = segment.to_string_lossy();
        segment.starts_with('.')
            && !named
                .iter()
                .any(|named| named.eq_ignore_ascii_case(&segment))
    });
    if detour {
        return Err("path reaches a hidden folder through a link".into());
    }
    Ok(())
}

/// Resolves a path for a file that does not exist yet.
///
/// `resolve` canonicalises the target, which a new file cannot satisfy. Here the
/// *parent* is canonicalised and checked instead, so a new note still cannot be
/// written outside the vault — including through a symlinked folder.
pub(crate) fn resolve_new(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.contains('\0') {
        return Err("path contains a null byte".into());
    }
    refuse_git_folder(relative)?;

    let mut segments = Vec::new();
    for segment in relative.split('/').filter(|segment| !segment.is_empty()) {
        match Path::new(segment).components().next() {
            Some(Component::Normal(name)) => segments.push(name.to_os_string()),
            _ => return Err(format!("path segment {segment:?} is not allowed")),
        }
    }

    let name = segments.pop().ok_or("a note needs a name")?;
    let mut parent = root.to_path_buf();
    for segment in &segments {
        parent.push(segment);
    }

    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("vault is unreadable: {error}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "that folder does not exist".to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("path escapes the vault".into());
    }
    let file = canonical_parent.join(name);
    refuse_hidden_detour(&canonical_root, &file, relative)?;
    refuse_git_folder_reached(&canonical_root, &file)?;
    Ok(file)
}

/// Creates a note, refusing to touch one that is already there.
fn create_note_at(root: &Path, relative: &str, contents: &str) -> Result<(), String> {
    let file = resolve_new(root, relative)?;

    // create_new fails if the path exists, so an existing note is never overwritten
    // and two creations racing cannot both win.
    let mut handle = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::AlreadyExists => "a note with that name already exists".to_string(),
            _ => format!("cannot create the note: {error}"),
        })?;

    use std::io::Write;
    handle
        .write_all(contents.as_bytes())
        .map_err(|error| format!("cannot write the note: {error}"))
}

#[tauri::command]
pub fn create_note(
    state: State<'_, VaultState>,
    path: String,
    contents: String,
    vault: String,
) -> Result<(), String> {
    create_note_at(
        &root_for_write(state.get(), Some(&vault))?,
        &path,
        &contents,
    )?;
    log::info!("created {path}");
    Ok(())
}

fn root_of(state: &State<'_, VaultState>) -> Result<PathBuf, String> {
    state.get().ok_or_else(|| "no vault is open".to_string())
}

/// The root a write lands in, refused when it was meant for a vault that is no
/// longer the open one.
///
/// Paths are relative to a vault and only one is open at a time, so a write that
/// arrives after a switch names a same-named note in the other vault. Which vault
/// a write belongs to is the caller's to say (R14-01); this only compares, the way
/// `expected_modified` is compared. A write that names no vault is refused
/// (R14-04): the typed commands cannot be called without one, and this holds the
/// same line for the binary write, whose vault arrives as an optional header.
pub(crate) fn root_for_write(
    open: Option<PathBuf>,
    meant_for: Option<&str>,
) -> Result<PathBuf, String> {
    let root = open.ok_or_else(|| "no vault is open".to_string())?;
    let meant =
        meant_for.ok_or_else(|| "a write must name the vault it is meant for".to_string())?;
    if Path::new(meant) != root {
        return Err("another vault was opened before this could be written".into());
    }
    Ok(root)
}

#[tauri::command]
pub async fn pick_vault(app: AppHandle) -> Result<Option<VaultLocation>, String> {
    // Runs off the main thread: an async command is dispatched to the runtime pool,
    // and the dialog plugin hops back to the main thread on its own.
    // Picking only reports a choice — whether to keep it is decided in the use-case.
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let root = picked
        .into_path()
        .map_err(|error| format!("unusable folder: {error}"))?;
    Ok(Some(location_of(&root)))
}

#[tauri::command]
pub fn open_vault(
    app: AppHandle,
    state: State<'_, VaultState>,
    location: VaultLocation,
) -> Result<(), String> {
    let root = PathBuf::from(&location.absolute_path);
    if !root.is_dir() {
        return Err(format!("{} is not a folder", location.absolute_path));
    }
    log::info!("vault opened: {}", location.absolute_path);
    state.set(root);
    remember(&app, &location)
}

#[tauri::command]
pub fn current_vault(app: AppHandle, state: State<'_, VaultState>) -> Option<VaultLocation> {
    if let Some(root) = state.get() {
        return Some(location_of(&root));
    }
    let location = recall(&app)?;
    log::info!("vault restored: {}", location.absolute_path);
    state.set(PathBuf::from(&location.absolute_path));
    Some(location)
}

/// Lists one directory's immediate children. Entries whose metadata cannot be read
/// are skipped rather than failing the whole listing: a broken symlink in a vault
/// should not make the folder unopenable.
fn list_entries(root: &Path, path: &str) -> Result<Vec<VaultEntry>, String> {
    let directory = resolve(root, path)?;

    let mut entries = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| format!("cannot read: {error}"))? {
        let Ok(entry) = entry else { continue };
        // fs::metadata follows symlinks, so a link to a folder lists as a folder and a
        // broken link is skipped. DirEntry::metadata would describe the link itself.
        let Ok(metadata) = fs::metadata(entry.path()) else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let child = if path.is_empty() {
            name.clone()
        } else {
            format!("{path}/{name}")
        };
        entries.push(VaultEntry {
            name,
            path: child,
            kind: if metadata.is_dir() {
                "directory"
            } else {
                "file"
            },
            modified: modified_ms(&metadata).unwrap_or(0),
            size: metadata.len(),
        });
    }
    Ok(entries)
}

fn modified_ms(metadata: &fs::Metadata) -> Result<u64, String> {
    metadata
        .modified()
        .map_err(|error| format!("no modification time: {error}"))?
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as u64)
        .map_err(|error| format!("modification time is before the epoch: {error}"))
}

fn read_text(root: &Path, path: &str) -> Result<NoteContents, String> {
    let file = resolve(root, path)?;

    let metadata = fs::metadata(&file).map_err(|error| format!("cannot read: {error}"))?;
    if metadata.is_dir() {
        return Err("that is a directory".into());
    }
    if metadata.len() > MAX_TEXT_BYTES {
        return Err(format!(
            "file is {} MB, larger than the {} MB limit",
            metadata.len() / 1024 / 1024,
            MAX_TEXT_BYTES / 1024 / 1024
        ));
    }
    let text = fs::read_to_string(&file).map_err(|_| "not a text file".to_string())?;
    Ok(NoteContents {
        text,
        modified: modified_ms(&metadata)?,
    })
}

/// Saves a note by writing a temporary file beside it and renaming over the top.
/// A rename within a directory is atomic, so an interrupted save can never leave a
/// half-written note: the reader sees either the old file or the new one.
fn write_text(
    root: &Path,
    path: &str,
    contents: &str,
    expected_modified: Option<u64>,
) -> Result<u64, String> {
    let file = resolve(root, path)?;

    let metadata = fs::metadata(&file).map_err(|error| format!("cannot read: {error}"))?;
    if metadata.is_dir() {
        return Err("that is a directory".into());
    }
    if let Some(expected) = expected_modified {
        if modified_ms(&metadata)? != expected {
            return Err("the note changed on disk since it was opened".into());
        }
    }

    let directory = file.parent().ok_or("note has no parent directory")?;
    let name = file
        .file_name()
        .ok_or("note has no file name")?
        .to_string_lossy()
        .into_owned();
    let temporary = directory.join(format!(".{name}.atlas-tmp"));

    fs::write(&temporary, contents).map_err(|error| format!("cannot write: {error}"))?;
    if let Err(error) = fs::rename(&temporary, &file) {
        let _ = fs::remove_file(&temporary); // Best effort; the save already failed.
        return Err(format!("cannot save: {error}"));
    }

    modified_ms(&fs::metadata(&file).map_err(|error| format!("cannot read back: {error}"))?)
}

/// A walk of the vault for markdown notes, and the two things that hold for all of it.
///
/// It reports what is on disk. Which of those notes the user should see is decided
/// in TypeScript (ADR-0014): the one thing this skips is the folders it was *told*
/// to skip, so a vault containing `node_modules` does not send tens of thousands of
/// paths across IPC for the frontend to throw away. It has no opinion about what a
/// name means — a dotted folder it was not told about is walked like any other.
struct NoteWalk<'a> {
    root: &'a Path,
    /// Names the frontend asked not to be descended into. Matched on the entry's
    /// own name at any level, which is how the rule that produced it is written.
    skip: &'a HashSet<String>,
    /// How many folders down to read notes, as the frontend's rule says: the
    /// archive refuses to file a note deeper than this, so the two must agree.
    /// A cap at all because a symlink can otherwise make the tree appear
    /// infinite even when every step stays inside the vault.
    max_depth: usize,
}

impl NoteWalk<'_> {
    /// Deliberately cheap per entry: names and paths only, never contents.
    fn collect(&self, directory: &Path, prefix: &str, depth: usize, notes: &mut Vec<VaultEntry>) {
        if depth > self.max_depth {
            return;
        }

        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if self.skip.contains(&name) {
                continue;
            }
            let Ok(metadata) = fs::metadata(entry.path()) else {
                continue;
            };
            let relative = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };

            if metadata.is_dir() {
                // Refuse to follow a link that leaves the vault.
                if resolve(self.root, &relative).is_err() {
                    continue;
                }
                self.collect(&entry.path(), &relative, depth + 1, notes);
            } else if name.to_lowercase().ends_with(".md") {
                notes.push(VaultEntry {
                    name,
                    path: relative,
                    kind: "file",
                    modified: modified_ms(&metadata).unwrap_or(0),
                    size: metadata.len(),
                });
            }
        }
    }
}

/// Every markdown note on disk, for link resolution, autocomplete, the index and
/// backlinks — minus the folders `skip_directories` named, and no more than
/// `max_depth` folders down.
#[tauri::command]
pub fn list_notes(
    state: State<'_, VaultState>,
    skip_directories: Vec<String>,
    max_depth: usize,
) -> Result<Vec<VaultEntry>, String> {
    let root = root_of(&state)?;
    let skip: HashSet<String> = skip_directories.into_iter().collect();
    let mut notes = Vec::new();
    NoteWalk {
        root: &root,
        skip: &skip,
        max_depth,
    }
    .collect(&root, "", 0, &mut notes);
    log::debug!("found {} notes", notes.len());
    Ok(notes)
}

#[tauri::command]
pub fn list_directory(
    state: State<'_, VaultState>,
    path: String,
) -> Result<Vec<VaultEntry>, String> {
    let entries = list_entries(&root_of(&state)?, &path)?;
    log::debug!("listed {} entries in {:?}", entries.len(), path);
    Ok(entries)
}

/// A note's text together with the facts the index needs about the file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    pub path: String,
    pub text: String,
    pub modified: u64,
    pub size: u64,
}

fn read_notes_at(root: &Path, paths: &[String]) -> Vec<NoteFile> {
    let mut notes = Vec::with_capacity(paths.len());
    for path in paths {
        let Ok(file) = resolve(root, path) else {
            continue;
        };
        let Ok(metadata) = fs::metadata(&file) else {
            continue;
        };
        if metadata.is_dir() || metadata.len() > MAX_TEXT_BYTES {
            continue;
        }
        // A note that cannot be read as text is skipped, not fatal: one unreadable
        // file must not stop the rest of the vault being indexed.
        let Ok(text) = fs::read_to_string(&file) else {
            continue;
        };
        let Ok(modified) = modified_ms(&metadata) else {
            continue;
        };
        notes.push(NoteFile {
            path: path.clone(),
            text,
            modified,
            size: metadata.len(),
        });
    }
    notes
}

/// Reads many notes in one call, so indexing a vault is not thousands of round trips.
#[tauri::command]
pub fn read_notes(
    state: State<'_, VaultState>,
    paths: Vec<String>,
) -> Result<Vec<NoteFile>, String> {
    Ok(read_notes_at(&root_of(&state)?, &paths))
}

#[tauri::command]
pub fn read_text_file(state: State<'_, VaultState>, path: String) -> Result<NoteContents, String> {
    read_text(&root_of(&state)?, &path)
}

fn read_binary(root: &Path, path: &str) -> Result<Vec<u8>, String> {
    let file = resolve(root, path)?;
    let metadata = fs::metadata(&file).map_err(|error| format!("cannot read: {error}"))?;
    if metadata.is_dir() {
        return Err("that is a directory".into());
    }
    if metadata.len() > MAX_BINARY_BYTES {
        return Err(format!(
            "file is {} MB, larger than the {} MB limit",
            metadata.len() / 1024 / 1024,
            MAX_BINARY_BYTES / 1024 / 1024
        ));
    }
    fs::read(&file).map_err(|error| format!("cannot read: {error}"))
}

/// Raw bytes of a file in the vault, for showing an image.
///
/// Sent as a binary response rather than a JSON array, and read through the same
/// guard as everything else, so the webview never gets access to the filesystem.
#[tauri::command]
pub fn read_binary_file(
    state: State<'_, VaultState>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let bytes = read_binary(&root_of(&state)?, &path)?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn write_text_file(
    state: State<'_, VaultState>,
    path: String,
    contents: String,
    expected_modified: Option<u64>,
    vault: String,
) -> Result<u64, String> {
    let root = root_for_write(state.get(), Some(&vault))?;
    let modified = write_text(&root, &path, &contents, expected_modified)?;
    log::info!("saved {path}");
    Ok(modified)
}

#[cfg(test)]
mod tests {
    use super::{resolve, resolve_new, root_for_write, VaultState};
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    /// A thread that panics while holding the vault lock must not take the rest
    /// of the session with it: the guarded value is a single path, so there is
    /// nothing for the poison flag to protect.
    #[test]
    fn a_poisoned_lock_does_not_end_the_session() {
        use std::sync::Arc;

        let state = Arc::new(VaultState::default());
        state.set(PathBuf::from("/tmp/atlas-vault"));

        let poisoner = Arc::clone(&state);
        let panicked = std::thread::spawn(move || {
            let _held = poisoner.0.lock().unwrap();
            panic!("a thread died holding the lock");
        })
        .join();
        assert!(panicked.is_err());

        // The path is still readable, and still writable.
        assert_eq!(state.get(), Some(PathBuf::from("/tmp/atlas-vault")));
        state.set(PathBuf::from("/tmp/atlas-other"));
        assert_eq!(state.root(), Some(PathBuf::from("/tmp/atlas-other")));
    }

    #[test]
    fn writes_into_the_vault_the_write_was_meant_for() {
        let open = PathBuf::from("/vaults/a");
        assert_eq!(
            root_for_write(Some(open.clone()), Some("/vaults/a")),
            Ok(open)
        );
    }

    /// R14-01: a save that arrives after a switch must not land in the other
    /// vault's note of the same name.
    #[test]
    fn refuses_a_write_meant_for_a_vault_that_is_no_longer_open() {
        let refused = root_for_write(Some(PathBuf::from("/vaults/b")), Some("/vaults/a"));
        assert_eq!(
            refused,
            Err("another vault was opened before this could be written".to_string())
        );
    }

    /// R14-04: a write that does not say which vault it is meant for is not
    /// sent to whichever happens to be open; it is refused.
    #[test]
    fn refuses_a_write_that_names_no_vault() {
        assert_eq!(
            root_for_write(Some(PathBuf::from("/vaults/b")), None),
            Err("a write must name the vault it is meant for".to_string())
        );
    }

    #[test]
    fn refuses_a_write_when_no_vault_is_open() {
        assert_eq!(
            root_for_write(None, Some("/vaults/a")),
            Err("no vault is open".to_string())
        );
    }

    #[test]
    fn resolves_a_file_inside_the_vault() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("note.md"), "hi").unwrap();
        let resolved = resolve(vault.path(), "note.md").unwrap();
        assert!(resolved.ends_with("note.md"));
    }

    #[test]
    fn resolves_a_nested_file() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("Notes")).unwrap();
        fs::write(vault.path().join("Notes/today.md"), "hi").unwrap();
        assert!(resolve(vault.path(), "Notes/today.md").is_ok());
    }

    #[test]
    fn resolves_the_root_itself() {
        let vault = tempdir().unwrap();
        assert!(resolve(vault.path(), "").is_ok());
    }

    #[test]
    fn refuses_a_parent_escape() {
        let vault = tempdir().unwrap();
        assert!(resolve(vault.path(), "../secrets").is_err());
        assert!(resolve(vault.path(), "Notes/../../secrets").is_err());
    }

    #[test]
    fn refuses_an_absolute_path() {
        let vault = tempdir().unwrap();
        // A leading slash yields empty segments, so this can only ever resolve
        // relative to the vault — never to the real /etc.
        assert!(resolve(vault.path(), "/etc/passwd").is_err());
    }

    #[test]
    fn refuses_a_null_byte() {
        let vault = tempdir().unwrap();
        assert!(resolve(vault.path(), "note.md\0.png").is_err());
    }

    #[test]
    fn refuses_a_symlink_pointing_outside_the_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secrets.txt"), "top secret").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secrets.txt"),
            vault.path().join("link"),
        )
        .unwrap();

        let error = resolve(vault.path(), "link").unwrap_err();
        assert_eq!(error, "path escapes the vault");
    }

    #[test]
    fn allows_a_symlink_pointing_inside_the_vault() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("real.md"), "hi").unwrap();
        std::os::unix::fs::symlink(vault.path().join("real.md"), vault.path().join("alias.md"))
            .unwrap();
        assert!(resolve(vault.path(), "alias.md").is_ok());
    }

    #[test]
    fn reports_a_missing_entry_rather_than_guessing() {
        let vault = tempdir().unwrap();
        assert!(resolve(vault.path(), "nope.md").is_err());
    }

    /// A vault with `.atlas/settings.md` and `.git/config`, and user-space
    /// links into both: what a synced folder or a stray `ln -s` can leave.
    fn vault_with_links_into_hidden_folders() -> tempfile::TempDir {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join(".atlas")).unwrap();
        fs::create_dir(vault.path().join(".git")).unwrap();
        fs::create_dir(vault.path().join("Notes")).unwrap();
        fs::write(vault.path().join(".atlas/settings.md"), "mine").unwrap();
        fs::write(vault.path().join(".git/config"), "[core]").unwrap();
        let link = |target: &str, at: &str| {
            std::os::unix::fs::symlink(vault.path().join(target), vault.path().join(at)).unwrap()
        };
        link(".atlas/settings.md", "Notes/settings.md");
        link(".atlas", "Notes/system");
        link(".git/config", "config.md");
        vault
    }

    #[test]
    fn refuses_a_link_that_leads_into_a_hidden_folder_the_path_did_not_name() {
        let vault = vault_with_links_into_hidden_folders();
        let refused = "path reaches a hidden folder through a link".to_string();

        assert_eq!(
            resolve(vault.path(), "Notes/settings.md"),
            Err(refused.clone())
        );
        assert_eq!(resolve(vault.path(), "config.md"), Err(refused.clone()));
        assert_eq!(
            resolve(vault.path(), "Notes/system/settings.md"),
            Err(refused.clone())
        );
        assert_eq!(
            resolve_new(vault.path(), "Notes/system/new.md"),
            Err(refused)
        );
    }

    #[test]
    fn still_reaches_a_hidden_folder_by_its_own_name() {
        let vault = vault_with_links_into_hidden_folders();
        assert!(resolve(vault.path(), ".atlas/settings.md").is_ok());
        assert!(resolve_new(vault.path(), ".atlas/new.md").is_ok());
    }

    /// Atlas runs `git` in the vault (U-29): a `.git/config` or `.git` file the
    /// webview could write would be a program git runs. Named or reached, in
    /// any case, for reads and writes alike, it is refused.
    #[test]
    fn never_reaches_gits_own_folder() {
        let vault = vault_with_links_into_hidden_folders();
        fs::create_dir(vault.path().join("Sub")).unwrap();
        let refused = Err("git's own folder is not part of the vault".to_string());

        assert_eq!(resolve(vault.path(), ".git/config"), refused);
        assert_eq!(resolve(vault.path(), ".GIT/config"), refused);
        assert_eq!(resolve_new(vault.path(), ".git/hooks-new"), refused);
        assert_eq!(resolve_new(vault.path(), ".git"), refused);
        assert_eq!(resolve_new(vault.path(), "Sub/.Git"), refused);
        assert_eq!(resolve(vault.path(), "Sub/../.git/config"), refused);
        assert!(super::create_note_at(vault.path(), ".git/config", "[core]").is_err());
        assert_eq!(
            fs::read_to_string(vault.path().join(".git/config")).unwrap(),
            "[core]"
        );
    }

    #[test]
    fn a_link_that_lands_in_gits_folder_is_refused() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join(".git")).unwrap();
        std::os::unix::fs::symlink(vault.path().join(".git"), vault.path().join(".repo")).unwrap();
        assert!(resolve_new(vault.path(), ".repo/config").is_err());
        assert!(resolve(vault.path(), ".repo").is_err());
    }

    #[test]
    fn the_gitignore_at_the_top_stays_writable() {
        let vault = tempdir().unwrap();
        assert!(resolve_new(vault.path(), ".gitignore").is_ok());
        assert!(resolve_new(vault.path(), ".gitattributes").is_ok());
    }

    /// The TypeScript side keeps the API out of any hidden folder, however deep
    /// (`isUserSpace`); a link in user space must not reach one below the top
    /// that the path did not name — a tag rename writes whatever note it finds.
    #[test]
    fn refuses_a_link_into_a_hidden_folder_below_the_top_of_the_vault() {
        let vault = tempdir().unwrap();
        fs::create_dir_all(vault.path().join("Projects/.obsidian")).unwrap();
        fs::create_dir(vault.path().join("Notes")).unwrap();
        fs::write(vault.path().join("Projects/.obsidian/app.md"), "#idea").unwrap();
        std::os::unix::fs::symlink(
            vault.path().join("Projects/.obsidian/app.md"),
            vault.path().join("Notes/app.md"),
        )
        .unwrap();

        assert_eq!(
            resolve(vault.path(), "Notes/app.md"),
            Err("path reaches a hidden folder through a link".to_string())
        );
    }
}

#[cfg(test)]
mod read_tests {
    use super::{list_entries, read_text};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn lists_files_and_directories_with_their_kind() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("Notes")).unwrap();
        fs::write(vault.path().join("todo.md"), "x").unwrap();

        let mut entries = list_entries(vault.path(), "").unwrap();
        entries.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "Notes");
        assert_eq!(entries[0].kind, "directory");
        assert_eq!(entries[1].name, "todo.md");
        assert_eq!(entries[1].kind, "file");
    }

    #[test]
    fn builds_child_paths_relative_to_the_vault() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("Notes")).unwrap();
        fs::write(vault.path().join("Notes/today.md"), "x").unwrap();

        let entries = list_entries(vault.path(), "Notes").unwrap();
        assert_eq!(entries[0].path, "Notes/today.md");
    }

    #[test]
    fn lists_an_empty_directory_as_empty() {
        let vault = tempdir().unwrap();
        assert!(list_entries(vault.path(), "").unwrap().is_empty());
    }

    #[test]
    fn skips_a_broken_symlink_rather_than_failing_the_listing() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("real.md"), "x").unwrap();
        std::os::unix::fs::symlink(vault.path().join("gone.md"), vault.path().join("broken"))
            .unwrap();

        let entries = list_entries(vault.path(), "").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "real.md");
    }

    #[test]
    fn lists_a_symlinked_folder_as_a_folder() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("Real")).unwrap();
        std::os::unix::fs::symlink(vault.path().join("Real"), vault.path().join("Alias")).unwrap();

        let entries = list_entries(vault.path(), "").unwrap();
        let alias = entries.iter().find(|e| e.name == "Alias").unwrap();
        assert_eq!(alias.kind, "directory");
    }

    #[test]
    fn refuses_to_list_outside_the_vault() {
        let vault = tempdir().unwrap();
        assert!(list_entries(vault.path(), "../..").is_err());
    }

    #[test]
    fn reads_a_note_byte_for_byte() {
        let vault = tempdir().unwrap();
        let text = "---\ntitle: Today\n---\n\n# Today\n\n- [ ] one\n";
        fs::write(vault.path().join("today.md"), text).unwrap();
        assert_eq!(read_text(vault.path(), "today.md").unwrap().text, text);
    }

    #[test]
    fn reads_utf8_beyond_ascii() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "año — 日本語\n").unwrap();
        assert_eq!(
            read_text(vault.path(), "a.md").unwrap().text,
            "año — 日本語\n"
        );
    }

    #[test]
    fn refuses_to_read_a_directory_as_text() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("Notes")).unwrap();
        assert_eq!(
            read_text(vault.path(), "Notes").unwrap_err(),
            "that is a directory"
        );
    }

    #[test]
    fn refuses_a_file_that_is_not_text() {
        let vault = tempdir().unwrap();
        fs::write(
            vault.path().join("photo.png"),
            [0xff, 0xd8, 0xff, 0x00, 0x80],
        )
        .unwrap();
        assert_eq!(
            read_text(vault.path(), "photo.png").unwrap_err(),
            "not a text file"
        );
    }

    #[test]
    fn refuses_a_file_over_the_size_limit() {
        let vault = tempdir().unwrap();
        let big = vec![b'a'; (super::MAX_TEXT_BYTES + 1) as usize];
        fs::write(vault.path().join("big.md"), big).unwrap();
        assert!(read_text(vault.path(), "big.md")
            .unwrap_err()
            .contains("larger than"));
    }
}

#[cfg(test)]
mod write_tests {
    use super::{read_text, write_text};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn saves_the_exact_bytes_it_was_given() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "old\n").unwrap();

        let text = "---\ntitle: New\n---\n\n# New\n\n- [ ] one\n";
        write_text(vault.path(), "a.md", text, None).unwrap();
        assert_eq!(fs::read_to_string(vault.path().join("a.md")).unwrap(), text);
    }

    #[test]
    fn leaves_no_temporary_file_behind() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "old\n").unwrap();
        write_text(vault.path(), "a.md", "new\n", None).unwrap();

        let names: Vec<_> = fs::read_dir(vault.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["a.md"]);
    }

    #[test]
    fn reports_a_new_modification_time() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "old\n").unwrap();

        let before = read_text(vault.path(), "a.md").unwrap().modified;
        let after = write_text(vault.path(), "a.md", "new\n", None).unwrap();
        assert!(after >= before);
        assert_eq!(read_text(vault.path(), "a.md").unwrap().modified, after);
    }

    #[test]
    fn saves_when_the_file_is_untouched_since_it_was_read() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "old\n").unwrap();

        let opened = read_text(vault.path(), "a.md").unwrap();
        assert!(write_text(vault.path(), "a.md", "new\n", Some(opened.modified)).is_ok());
    }

    #[test]
    fn refuses_to_clobber_a_note_edited_elsewhere() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "old\n").unwrap();
        let opened = read_text(vault.path(), "a.md").unwrap();

        // Something else — Obsidian, a sync client — rewrites the file.
        let error =
            write_text(vault.path(), "a.md", "mine\n", Some(opened.modified - 1)).unwrap_err();
        assert_eq!(error, "the note changed on disk since it was opened");
        assert_eq!(
            fs::read_to_string(vault.path().join("a.md")).unwrap(),
            "old\n"
        );
    }

    #[test]
    fn refuses_to_write_outside_the_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secrets.txt"), "top secret").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secrets.txt"),
            vault.path().join("link"),
        )
        .unwrap();

        assert!(write_text(vault.path(), "link", "hacked", None).is_err());
        assert_eq!(
            fs::read_to_string(outside.path().join("secrets.txt")).unwrap(),
            "top secret"
        );
    }

    #[test]
    fn refuses_to_write_over_a_directory() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("Notes")).unwrap();
        assert_eq!(
            write_text(vault.path(), "Notes", "x", None).unwrap_err(),
            "that is a directory"
        );
    }

    #[test]
    fn round_trips_unicode_and_windows_line_endings() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "x").unwrap();
        let text = "año — 日本語 🎉\r\nsecond\r\n";
        write_text(vault.path(), "a.md", text, None).unwrap();
        assert_eq!(read_text(vault.path(), "a.md").unwrap().text, text);
    }
}

#[cfg(test)]
mod note_tests {
    use super::{NoteWalk, VaultEntry};
    use std::collections::HashSet;
    use std::fs;
    use tempfile::tempdir;

    /// The walk with nothing skipped: everything on disk, which is the contract.
    fn notes_in(root: &std::path::Path) -> Vec<String> {
        skipping(root, &[])
    }

    fn skipping(root: &std::path::Path, skip: &[&str]) -> Vec<String> {
        let skip: HashSet<String> = skip.iter().map(|name| (*name).to_owned()).collect();
        let mut notes: Vec<VaultEntry> = Vec::new();
        // The depth the frontend hands over (VAULT_WALK_DEPTH).
        NoteWalk {
            root,
            skip: &skip,
            max_depth: 32,
        }
        .collect(root, "", 0, &mut notes);
        let mut paths: Vec<String> = notes.into_iter().map(|note| note.path).collect();
        paths.sort();
        paths
    }

    #[test]
    fn finds_notes_at_every_level() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("top.md"), "x").unwrap();
        fs::create_dir_all(vault.path().join("a/b")).unwrap();
        fs::write(vault.path().join("a/mid.md"), "x").unwrap();
        fs::write(vault.path().join("a/b/deep.md"), "x").unwrap();

        assert_eq!(
            notes_in(vault.path()),
            vec!["a/b/deep.md", "a/mid.md", "top.md"]
        );
    }

    #[test]
    fn ignores_files_that_are_not_markdown() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("note.md"), "x").unwrap();
        fs::write(vault.path().join("photo.png"), "x").unwrap();
        fs::write(vault.path().join("data.json"), "x").unwrap();

        assert_eq!(notes_in(vault.path()), vec!["note.md"]);
    }

    #[test]
    fn accepts_an_uppercase_extension() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("Note.MD"), "x").unwrap();
        assert_eq!(notes_in(vault.path()), vec!["Note.MD"]);
    }

    #[test]
    fn reports_a_dotted_directory_it_was_not_told_to_skip() {
        // The point of A13-09: deciding that a dot means hidden is the frontend's
        // job, and this walk no longer has an opinion about it.
        let vault = tempdir().unwrap();
        fs::create_dir_all(vault.path().join(".atlas/types")).unwrap();
        fs::write(vault.path().join(".atlas/types/task.md"), "x").unwrap();
        fs::create_dir(vault.path().join(".obsidian")).unwrap();
        fs::write(vault.path().join(".obsidian/config.md"), "x").unwrap();
        fs::write(vault.path().join("keep.md"), "x").unwrap();

        assert_eq!(
            notes_in(vault.path()),
            vec![".atlas/types/task.md", ".obsidian/config.md", "keep.md"]
        );
    }

    #[test]
    fn does_not_descend_into_a_directory_it_was_told_to_skip() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join(".obsidian")).unwrap();
        fs::write(vault.path().join(".obsidian/config.md"), "x").unwrap();
        fs::create_dir(vault.path().join("node_modules")).unwrap();
        fs::write(vault.path().join("node_modules/readme.md"), "x").unwrap();
        fs::write(vault.path().join("keep.md"), "x").unwrap();

        assert_eq!(
            skipping(vault.path(), &[".obsidian", "node_modules"]),
            vec!["keep.md"]
        );
    }

    #[test]
    fn skips_a_named_directory_wherever_it_sits() {
        let vault = tempdir().unwrap();
        fs::create_dir_all(vault.path().join("Projects/app/node_modules/pkg")).unwrap();
        fs::write(
            vault.path().join("Projects/app/node_modules/pkg/readme.md"),
            "x",
        )
        .unwrap();
        fs::write(vault.path().join("Projects/app/notes.md"), "x").unwrap();

        assert_eq!(
            skipping(vault.path(), &["node_modules"]),
            vec!["Projects/app/notes.md"]
        );
    }

    #[test]
    fn skips_a_file_with_a_skipped_name_as_well_as_a_directory() {
        // The rule this list comes from matches any path segment, a file's own
        // name included, so the walk matches on the name and not on the kind.
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("node_modules"), "not a folder").unwrap();
        fs::write(vault.path().join("keep.md"), "x").unwrap();

        assert_eq!(skipping(vault.path(), &["node_modules"]), vec!["keep.md"]);
    }

    #[test]
    fn a_skipped_name_does_not_match_a_longer_one() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join(".gitlab")).unwrap();
        fs::write(vault.path().join(".gitlab/ci.md"), "x").unwrap();

        assert_eq!(skipping(vault.path(), &[".git"]), vec![".gitlab/ci.md"]);
    }

    #[test]
    fn does_not_follow_a_directory_link_out_of_the_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), vault.path().join("escape")).unwrap();
        fs::write(vault.path().join("inside.md"), "x").unwrap();

        assert_eq!(notes_in(vault.path()), vec!["inside.md"]);
    }

    #[test]
    fn does_not_follow_a_dotted_directory_link_out_of_the_vault() {
        // Dotted folders used to be skipped outright, so the containment check
        // was never what stopped this one. Now it is the only thing that does.
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), vault.path().join(".escape")).unwrap();
        fs::write(vault.path().join("inside.md"), "x").unwrap();

        assert_eq!(notes_in(vault.path()), vec!["inside.md"]);
    }

    #[test]
    fn stops_descending_at_the_depth_cap() {
        let vault = tempdir().unwrap();
        let deep: std::path::PathBuf = (0..40).map(|level| format!("d{level}")).collect();
        fs::create_dir_all(vault.path().join(&deep)).unwrap();
        fs::write(vault.path().join(&deep).join("buried.md"), "x").unwrap();
        fs::write(vault.path().join("d0/shallow.md"), "x").unwrap();

        let found = notes_in(vault.path());
        assert!(found.contains(&"d0/shallow.md".to_owned()));
        assert!(found.iter().all(|path| !path.ends_with("buried.md")));
    }

    /// The depth is the frontend's rule, handed over like the skip list (ADR-0014):
    /// a note `max_depth` folders down is read, one folder further is not.
    #[test]
    fn reads_exactly_as_deep_as_it_is_told() {
        let vault = tempdir().unwrap();
        fs::create_dir_all(vault.path().join("a/b/c")).unwrap();
        fs::write(vault.path().join("a/b/at-two.md"), "x").unwrap();
        fs::write(vault.path().join("a/b/c/at-three.md"), "x").unwrap();

        let skip = HashSet::new();
        let mut notes: Vec<VaultEntry> = Vec::new();
        NoteWalk {
            root: vault.path(),
            skip: &skip,
            max_depth: 2,
        }
        .collect(vault.path(), "", 0, &mut notes);
        let paths: Vec<String> = notes.into_iter().map(|note| note.path).collect();
        assert_eq!(paths, vec!["a/b/at-two.md"]);
    }

    #[test]
    fn handles_an_empty_vault() {
        let vault = tempdir().unwrap();
        assert!(notes_in(vault.path()).is_empty());
    }
}

#[cfg(test)]
mod binary_tests {
    use super::read_binary;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reads_the_exact_bytes() {
        let vault = tempdir().unwrap();
        let bytes: Vec<u8> = vec![0x89, 0x50, 0x4e, 0x47, 0x00, 0xff];
        fs::write(vault.path().join("pic.png"), &bytes).unwrap();
        assert_eq!(read_binary(vault.path(), "pic.png").unwrap(), bytes);
    }

    #[test]
    fn refuses_a_directory() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("images")).unwrap();
        assert_eq!(
            read_binary(vault.path(), "images").unwrap_err(),
            "that is a directory"
        );
    }

    #[test]
    fn refuses_a_file_outside_the_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret.png"), [1, 2, 3]).unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.png"),
            vault.path().join("link.png"),
        )
        .unwrap();
        assert!(read_binary(vault.path(), "link.png").is_err());
    }

    #[test]
    fn reports_a_missing_file() {
        let vault = tempdir().unwrap();
        assert!(read_binary(vault.path(), "nope.png").is_err());
    }
}

#[cfg(test)]
mod batch_tests {
    use super::read_notes_at;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn reads_several_notes_in_one_call() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "alpha").unwrap();
        fs::write(vault.path().join("b.md"), "beta").unwrap();

        let notes = read_notes_at(vault.path(), &["a.md".into(), "b.md".into()]);
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].text, "alpha");
        assert_eq!(notes[1].size, 4);
    }

    #[test]
    fn skips_a_note_that_is_missing_rather_than_failing_the_batch() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "alpha").unwrap();

        let notes = read_notes_at(vault.path(), &["gone.md".into(), "a.md".into()]);
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].path, "a.md");
    }

    #[test]
    fn skips_a_file_that_is_not_text() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("pic.png"), [0xff, 0xd8, 0x80]).unwrap();
        assert!(read_notes_at(vault.path(), &["pic.png".into()]).is_empty());
    }

    #[test]
    fn refuses_a_path_outside_the_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "secret").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("secret.md"),
            vault.path().join("link.md"),
        )
        .unwrap();

        assert!(read_notes_at(vault.path(), &["link.md".into()]).is_empty());
    }

    #[test]
    fn an_empty_request_reads_nothing() {
        let vault = tempdir().unwrap();
        assert!(read_notes_at(vault.path(), &[]).is_empty());
    }
}

#[cfg(test)]
mod create_tests {
    use super::{create_note_at, read_text};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn creates_a_note_with_the_given_contents() {
        let vault = tempdir().unwrap();
        create_note_at(vault.path(), "Untitled.md", "# Untitled\n\n").unwrap();
        assert_eq!(
            read_text(vault.path(), "Untitled.md").unwrap().text,
            "# Untitled\n\n"
        );
    }

    #[test]
    fn creates_a_note_inside_a_folder() {
        let vault = tempdir().unwrap();
        fs::create_dir(vault.path().join("Notes")).unwrap();
        create_note_at(vault.path(), "Notes/Today.md", "x").unwrap();
        assert!(vault.path().join("Notes/Today.md").is_file());
    }

    #[test]
    fn refuses_to_overwrite_an_existing_note() {
        let vault = tempdir().unwrap();
        fs::write(vault.path().join("a.md"), "original").unwrap();

        let error = create_note_at(vault.path(), "a.md", "replacement").unwrap_err();
        assert_eq!(error, "a note with that name already exists");
        assert_eq!(
            fs::read_to_string(vault.path().join("a.md")).unwrap(),
            "original"
        );
    }

    #[test]
    fn refuses_a_folder_that_does_not_exist() {
        let vault = tempdir().unwrap();
        assert_eq!(
            create_note_at(vault.path(), "Nowhere/a.md", "x").unwrap_err(),
            "that folder does not exist"
        );
    }

    #[test]
    fn refuses_a_path_that_climbs_out_of_the_vault() {
        let vault = tempdir().unwrap();
        assert!(create_note_at(vault.path(), "../escaped.md", "x").is_err());
        assert!(!vault.path().parent().unwrap().join("escaped.md").exists());
    }

    #[test]
    fn refuses_to_create_through_a_folder_link_leaving_the_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), vault.path().join("escape")).unwrap();

        assert_eq!(
            create_note_at(vault.path(), "escape/a.md", "x").unwrap_err(),
            "path escapes the vault"
        );
        assert!(!outside.path().join("a.md").exists());
    }

    #[test]
    fn refuses_a_name_that_is_only_a_folder() {
        let vault = tempdir().unwrap();
        assert!(create_note_at(vault.path(), "", "x").is_err());
    }

    #[test]
    fn refuses_a_null_byte() {
        let vault = tempdir().unwrap();
        assert!(create_note_at(vault.path(), "a\0.md", "x").is_err());
    }
}
