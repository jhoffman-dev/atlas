//! Where an export may write: the file or the new folder the person chose.
//!
//! The frontend decides what an export is and names its files; this only
//! holds the place the person picked, and keeps every write inside it. A
//! relative path is checked before anything is written, and each folder on
//! the way is made one at a time and refused if it is a link, so a symlink
//! already in the picked folder cannot lead a write out of it.

use std::collections::HashMap;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// The largest file an export writes: a meeting's recording is the biggest
/// attachment a note is likely to have.
pub const MAX_FILE_BYTES: usize = 512 * 1024 * 1024;

/// How many `<name> N` folders are tried before giving up: past this the
/// picked folder is full of earlier exports, and a person should tidy it.
const MAX_FOLDER_TRIES: u32 = 1000;

const ID_BYTES: usize = 32;

/// What the person is asked for.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DestinationRequest {
    /// One file, with perhaps a folder of its attachments beside it.
    #[serde(rename_all = "camelCase")]
    File {
        suggested_name: String,
        /// Without the dot: `md`, `pdf`.
        extension: String,
        /// Makes the companion folder's name from the file's stem.
        companion_suffix: Option<String>,
    },
    /// A new folder, made inside the one picked, for several files.
    #[serde(rename_all = "camelCase")]
    Folder { folder_name: String },
}

impl DestinationRequest {
    /// The names, checked before the dialog opens, so a bad request never
    /// asks the person anything.
    pub fn check(&self) -> Result<(), String> {
        match self {
            Self::File {
                suggested_name,
                extension,
                companion_suffix,
            } => {
                check_name(suggested_name, "file name")?;
                check_extension(extension)?;
                if let Some(suffix) = companion_suffix {
                    check_suffix(suffix)?;
                }
                Ok(())
            }
            Self::Folder { folder_name } => check_name(folder_name, "folder name"),
        }
    }
}

/// The folder beside an exported file that holds its other files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Companion {
    /// Its name, which every relative path into it starts with.
    pub name: String,
    pub dir: PathBuf,
}

/// A place an export may write, for this run of the app.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Grant {
    /// The chosen file, in its folder (resolved), and its companion if any.
    File {
        file: PathBuf,
        companion: Option<Companion>,
    },
    /// The folder made for this export (resolved).
    Folder { root: PathBuf },
}

/// What the frontend is told about a grant: its id, and where it is, for the
/// toast that says where the export went.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Granted {
    pub id: String,
    pub path: String,
    pub companion: Option<String>,
}

/// A grant, and every file and folder its export made that was not there
/// before — what a failed export takes back, and nothing else.
#[derive(Debug, Default)]
struct Held {
    grant: Option<Grant>,
    made: Vec<PathBuf>,
}

/// The places the person has chosen, by unguessable id. Memory only: an
/// export that outlives the app run has to be chosen again.
#[derive(Default)]
pub struct ExportGrants(Mutex<HashMap<String, Held>>);

impl ExportGrants {
    pub fn insert(&self, grant: Grant) -> Result<Granted, String> {
        let id = new_id()?;
        let granted = granted(&id, &grant);
        let made = grant.made_with_it();
        self.lock().insert(
            id,
            Held {
                grant: Some(grant),
                made,
            },
        );
        Ok(granted)
    }

    pub fn get(&self, id: &str) -> Result<Grant, String> {
        self.lock()
            .get(id)
            .and_then(|held| held.grant.clone())
            .ok_or_else(|| "this export's destination is no longer open; export again".into())
    }

    /// Notes what a write made, for `discard`.
    pub fn record_made(&self, id: &str, made: Vec<PathBuf>) {
        if let Some(held) = self.lock().get_mut(id) {
            held.made.extend(made);
        }
    }

    /// Lets the grant go, handing back what its export made, for `remove_made`.
    pub fn finish(&self, id: &str) -> Vec<PathBuf> {
        self.lock()
            .remove(id)
            .map(|held| held.made)
            .unwrap_or_default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, Held>> {
        // A panic while holding it leaves only a map of paths, still whole.
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Grant {
    /// The folders made as the grant was: a folder export's own, a file's attachments folder.
    fn made_with_it(&self) -> Vec<PathBuf> {
        match self {
            Grant::File { companion, .. } => companion
                .iter()
                .map(|companion| companion.dir.clone())
                .collect(),
            Grant::Folder { root } => vec![root.clone()],
        }
    }
}

/// Removes what an export made, files first, then folders deepest first. A
/// folder that holds anything else is left (`remove_dir` refuses it), so
/// nothing that was the person's is ever taken.
pub fn remove_made(made: &[PathBuf]) {
    for path in made.iter().filter(|path| !path.is_dir()) {
        // Gone already, or not removable: nothing more an undo can do with it.
        let _ = fs::remove_file(path);
    }
    let mut folders: Vec<&PathBuf> = made.iter().filter(|path| path.is_dir()).collect();
    folders.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for folder in folders {
        // Not empty means it holds something the export did not make: kept.
        let _ = fs::remove_dir(folder);
    }
}

/// Refuses a place inside an open vault: an export never writes into one.
pub fn outside_vaults(place: &Path, vaults: &[PathBuf]) -> Result<(), String> {
    let resolved = place.canonicalize().unwrap_or_else(|_| place.to_path_buf());
    let inside = vaults.iter().any(|vault| {
        let vault = vault.canonicalize().unwrap_or_else(|_| vault.clone());
        resolved.starts_with(&vault)
    });
    if inside {
        Err("that place is inside the vault, and exporting never writes into it: choose a folder outside it".into())
    } else {
        Ok(())
    }
}

fn granted(id: &str, grant: &Grant) -> Granted {
    let text = |path: &Path| path.to_string_lossy().into_owned();
    match grant {
        Grant::File { file, companion } => Granted {
            id: id.to_owned(),
            path: text(file),
            companion: companion.as_ref().map(|companion| text(&companion.dir)),
        },
        Grant::Folder { root } => Granted {
            id: id.to_owned(),
            path: text(root),
            companion: None,
        },
    }
}

/// 32 bytes from the operating system's CSPRNG, as hex, as the API token is.
fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; ID_BYTES];
    getrandom::fill(&mut bytes).map_err(|error| format!("cannot open the export: {error}"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// One path component a write can be trusted with: not empty, not `.` or
/// `..`, no separator and no NUL.
fn check_name(name: &str, what: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err(format!("the {what} is empty"));
    }
    if name == "." || name == ".." || name.contains('/') || name.contains('\0') {
        return Err(format!("the {what} \"{name}\" is not a single name"));
    }
    Ok(())
}

fn check_extension(extension: &str) -> Result<(), String> {
    if extension.is_empty() || !extension.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err(format!("\"{extension}\" is not a file extension"));
    }
    Ok(())
}

fn check_suffix(suffix: &str) -> Result<(), String> {
    if suffix.contains('/') || suffix.contains('\0') {
        return Err(format!(
            "the folder suffix \"{suffix}\" is not part of a name"
        ));
    }
    Ok(())
}

/// The dialog's label for the one kind of file it offers.
pub fn filter_label(extension: &str) -> String {
    match extension {
        "md" => "Markdown".into(),
        "pdf" => "PDF".into(),
        other => other.to_ascii_uppercase(),
    }
}

/// The file the person chose in the save panel, which has already asked
/// before replacing one, with the extension added if they typed it away.
pub fn grant_file(
    chosen: &Path,
    extension: &str,
    companion_suffix: Option<&str>,
) -> Result<Grant, String> {
    let name = chosen
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("the chosen file has no usable name")?;
    let has_extension = Path::new(name)
        .extension()
        .and_then(|found| found.to_str())
        .is_some_and(|found| found.eq_ignore_ascii_case(extension));
    let name = if has_extension {
        name.to_owned()
    } else {
        format!("{name}.{extension}")
    };
    check_name(&name, "file name")?;
    let parent = chosen.parent().ok_or("the chosen file has no folder")?;
    let parent = parent
        .canonicalize()
        .map_err(|error| format!("cannot use {}: {error}", parent.display()))?;
    // The save panel asked before replacing the name it showed, not this one.
    if !has_extension && fs::symlink_metadata(parent.join(&name)).is_ok() {
        return Err(format!(
            "\"{name}\" is already there, and the save dialog did not ask to replace it: export again and choose another name"
        ));
    }
    let companion = companion_suffix
        .map(|suffix| companion_of(&parent, &name, suffix))
        .transpose()?;
    Ok(Grant::File {
        file: parent.join(name),
        companion,
    })
}

/// The attachments folder beside the file, made now: `<stem><suffix>`, or
/// `<stem><suffix> 2`, … when that name is taken. A folder already there may
/// hold the person's own files, so it is never written into.
fn companion_of(parent: &Path, file_name: &str, suffix: &str) -> Result<Companion, String> {
    check_suffix(suffix)?;
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(file_name);
    let base = format!("{stem}{suffix}");
    check_name(&base, "folder name")?;
    if base == file_name {
        return Err("the attachments folder would have the file's own name".into());
    }
    let dir = new_folder(parent, &base)?;
    let name = dir
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("the attachments folder has no usable name")?
        .to_owned();
    Ok(Companion { dir, name })
}

/// A new folder `name` in `parent` — `name 2`, `name 3`, … if it is taken —
/// resolved. `create_dir` either makes the folder or fails, so a name taken
/// after looking is skipped, never shared.
fn new_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    for n in 1..=MAX_FOLDER_TRIES {
        let candidate = if n == 1 {
            parent.join(name)
        } else {
            parent.join(format!("{name} {n}"))
        };
        match fs::create_dir(&candidate) {
            Ok(()) => {
                return candidate
                    .canonicalize()
                    .map_err(|error| format!("cannot use {}: {error}", candidate.display()));
            }
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("cannot make {}: {error}", candidate.display())),
        }
    }
    Err(format!(
        "there are already {MAX_FOLDER_TRIES} folders named \"{name}\" there"
    ))
}

/// A new folder `name` inside the one picked — `name 2`, `name 3`, … if it is
/// taken. An existing folder is never written into: `create_dir` either makes
/// the folder or fails, so a name taken after looking is skipped, not shared.
pub fn grant_folder(picked: &Path, name: &str) -> Result<Grant, String> {
    check_name(name, "folder name")?;
    Ok(Grant::Folder {
        root: new_folder(picked, name)?,
    })
}

/// A relative path's names, each a single safe component; `""` is none.
pub fn relative_parts(path: &str) -> Result<Vec<&str>, String> {
    if path.is_empty() {
        return Ok(Vec::new());
    }
    path.split('/')
        .map(|part| {
            check_name(part, "path")
                .map(|()| part)
                .map_err(|_| format!("\"{path}\" is not a path inside the export"))
        })
        .collect()
}

/// Where a relative path lands: the folder it must stay inside, the folders
/// below that to make, and the file.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Target<'a> {
    root: PathBuf,
    folders: Vec<&'a str>,
    file: PathBuf,
}

fn target<'a>(grant: &Grant, parts: &[&'a str]) -> Result<Target<'a>, String> {
    let (root, inside) = match (grant, parts) {
        (Grant::File { file, .. }, []) => {
            let root = file.parent().ok_or("the export has no folder")?;
            return Ok(Target {
                root: root.to_path_buf(),
                folders: Vec::new(),
                file: file.clone(),
            });
        }
        (Grant::File { companion, .. }, [first, inside @ ..]) => {
            let companion = companion
                .as_ref()
                .filter(|companion| companion.name == *first && !inside.is_empty())
                .ok_or("an export's other files go in its attachments folder")?;
            (companion.dir.clone(), inside)
        }
        (Grant::Folder { .. }, []) => return Err("a folder export needs a file's name".into()),
        (Grant::Folder { root }, inside) => (root.clone(), inside),
    };
    let (name, folders) = inside.split_last().ok_or("no file was named")?;
    let mut file = root.clone();
    file.extend(folders);
    file.push(name);
    Ok(Target {
        root,
        folders: folders.to_vec(),
        file,
    })
}

/// Writes `bytes` to `path` inside the grant, through a temporary file in the
/// same folder that then takes the name, so a reader never sees half a file.
/// Returns how many bytes were written.
pub fn write_into(grant: &Grant, path: &str, bytes: &[u8]) -> Result<u64, String> {
    write_tracked(grant, path, bytes).map(|(written, _)| written)
}

/// As `write_into`, and also every file and folder the write made that was
/// not there before: what a failed export takes back.
pub fn write_tracked(
    grant: &Grant,
    path: &str,
    bytes: &[u8],
) -> Result<(u64, Vec<PathBuf>), String> {
    if bytes.len() > MAX_FILE_BYTES {
        return Err(too_big());
    }
    let parts = relative_parts(path)?;
    let target = target(grant, &parts)?;
    let mut made: Vec<PathBuf> = Vec::new();
    let mut at = target.root.clone();
    for folder in &target.folders {
        at.push(folder);
        if !at.exists() {
            made.push(at.clone());
        }
    }
    let root = target
        .root
        .canonicalize()
        .map_err(|error| format!("cannot use {}: {error}", target.root.display()))?;
    let folder = make_folders(&target.root, &target.folders)?;
    let folder = folder
        .canonicalize()
        .map_err(|error| format!("cannot use {}: {error}", folder.display()))?;
    if !folder.starts_with(&root) || !inside_grant(grant, &root) {
        return Err(format!("\"{path}\" leads outside the export"));
    }
    let name = target.file.file_name().ok_or("no file was named")?;
    let file = folder.join(name);
    if fs::symlink_metadata(&file).is_err() {
        made.push(file.clone());
    }
    write_atomically(&folder, &file, bytes)?;
    Ok((bytes.len() as u64, made))
}

pub fn too_big() -> String {
    format!(
        "a file to export is at most {} MB",
        MAX_FILE_BYTES / 1024 / 1024
    )
}

/// The companion folder, once resolved, must still sit beside the file: a
/// link put there in its place would lead out.
fn inside_grant(grant: &Grant, root: &Path) -> bool {
    match grant {
        Grant::File { file, .. } => file.parent().is_some_and(|parent| root.starts_with(parent)),
        Grant::Folder { root: granted } => root.starts_with(granted),
    }
}

/// Makes each folder below `root` in turn, refusing one that is a link or
/// not a folder, so nothing is made outside before the check after it.
fn make_folders(root: &Path, folders: &[&str]) -> Result<PathBuf, String> {
    let mut at = root.to_path_buf();
    for folder in folders {
        at.push(folder);
        make_folder(&at)?;
    }
    Ok(at)
}

fn make_folder(at: &Path) -> Result<(), String> {
    match fs::create_dir(at) {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
        Err(error) => return Err(format!("cannot make {}: {error}", at.display())),
    }
    let found = fs::symlink_metadata(at)
        .map_err(|error| format!("cannot use {}: {error}", at.display()))?;
    if found.is_dir() {
        Ok(())
    } else {
        Err(format!(
            "{} is in the way: it is not a folder",
            at.display()
        ))
    }
}

fn write_atomically(folder: &Path, file: &Path, bytes: &[u8]) -> Result<(), String> {
    let failed = |error: std::io::Error| format!("cannot write {}: {error}", file.display());
    let mut staged = tempfile::NamedTempFile::new_in(folder).map_err(failed)?;
    staged.write_all(bytes).map_err(failed)?;
    staged.as_file().sync_all().map_err(failed)?;
    staged.persist(file).map_err(|error| failed(error.error))?;
    Ok(())
}

#[cfg(test)]
mod tests;
