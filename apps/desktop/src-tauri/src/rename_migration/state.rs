//! What the migration has finished, kept in a file outside every folder it
//! copies. Whether a folder exists says nothing about whether it was copied:
//! WebKit, or a launch whose copy failed, makes the new folders on its own.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const FILE_NAME: &str = ".dfai-rename-migration.json";
const FORMAT_VERSION: u32 = 1;
/// How many launches a Keychain item that cannot be read is asked for before
/// it is given up on: each ask can be a prompt the person keeps denying.
pub const ATTEMPTS: u32 = 3;

/// Where one Keychain account is in the migration.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum AccountState {
    /// Copied, or DFAI already had it. Never copied again, so a secret the
    /// person removes in DFAI stays removed.
    Done,
    /// It could not be read this many launches running.
    Trying { attempts: u32 },
    /// It could not be read for `ATTEMPTS` launches; the person was told once.
    GaveUp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub version: u32,
    /// Each folder pair finished, by its key: the new folder's place under
    /// `~/Library` (`WebKit/dfai`), never an absolute path, so a renamed home
    /// folder still finds its pairs finished.
    pub folders_done: Vec<String>,
    pub accounts: BTreeMap<String, AccountState>,
    /// Set when a state file was found damaged. What was finished is unknown,
    /// so a new folder already there is taken as DFAI's own and kept, never
    /// set aside: only a missing one is copied into.
    #[serde(default)]
    pub after_damage: bool,
    /// Everything the migration did or could not do, launch after launch, for
    /// the report it leaves in DFAI's own folder. Names and paths only.
    pub log: Vec<String>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            version: FORMAT_VERSION,
            folders_done: Vec::new(),
            accounts: BTreeMap::new(),
            after_damage: false,
            log: Vec::new(),
        }
    }
}

impl State {
    pub fn folder_done(&self, key: &str) -> bool {
        self.folders_done.iter().any(|done| done == key)
    }

    pub fn mark_folder_done(&mut self, key: &str) {
        if !self.folder_done(key) {
            self.folders_done.push(key.to_string());
        }
    }
}

/// The state file: in Application Support itself, beside the folders it
/// tracks and inside none of them.
pub fn state_file(app_support: &Path) -> PathBuf {
    app_support.join(FILE_NAME)
}

/// What a load found.
pub enum Loaded {
    State(State),
    /// The file is there but cannot be read, or is not one this build wrote:
    /// a power cut mid-save, a disk error, a hand edit. Nothing is known about
    /// what was finished.
    Damaged(String),
}

pub fn load(file: &Path) -> Loaded {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Loaded::State(State::default())
        }
        Err(error) => return Loaded::Damaged(format!("cannot read {}: {error}", file.display())),
    };
    match serde_json::from_str::<State>(&text) {
        Ok(state) if state.version == FORMAT_VERSION => Loaded::State(state),
        _ => Loaded::Damaged(format!("{} is damaged", file.display())),
    }
}

/// Writes the state whole and durably: a temporary file, flushed to the disk
/// itself (`F_FULLFSYNC` on macOS, where `fsync` stops at the drive's cache),
/// renamed over the old, and the folder flushed so the rename survives too.
pub fn save(file: &Path, state: &State) -> Result<(), String> {
    let json = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    let staged = file.with_extension("json.new");
    let folder = file.parent().unwrap_or(Path::new("."));
    write_durably(folder, &staged, json.as_bytes())
        .and_then(|()| fs::rename(&staged, file))
        .and_then(|()| flush(&fs::File::open(folder)?))
        .map_err(|error| format!("cannot save {}: {error}", file.display()))
}

fn write_durably(folder: &Path, staged: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::io::Write;
    fs::create_dir_all(folder)?;
    let mut file = fs::File::create(staged)?;
    file.write_all(bytes)?;
    flush(&file)
}

#[cfg(target_os = "macos")]
fn flush(file: &fs::File) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    // SAFETY: the descriptor is the open file's, alive for this call.
    if unsafe { libc::fcntl(file.as_raw_fd(), libc::F_FULLFSYNC) } == -1 {
        return file.sync_all();
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn flush(file: &fs::File) -> io::Result<()> {
    file.sync_all()
}
