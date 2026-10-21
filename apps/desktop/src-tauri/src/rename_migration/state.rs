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
    /// Each folder pair finished, by the path of its new folder.
    pub folders_done: Vec<String>,
    pub accounts: BTreeMap<String, AccountState>,
    /// No more Keychain items are copied: set when the state was lost, since
    /// copying again could bring back a secret the person removed in DFAI.
    #[serde(default)]
    pub keychain_closed: bool,
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
            keychain_closed: false,
            log: Vec::new(),
        }
    }
}

impl State {
    pub fn folder_done(&self, to: &Path) -> bool {
        self.folders_done.iter().any(|done| Path::new(done) == to)
    }

    pub fn mark_folder_done(&mut self, to: &Path) {
        if !self.folder_done(to) {
            self.folders_done.push(to.to_string_lossy().into_owned());
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
    /// The file is there but is not one this build wrote. A migration has
    /// run before, so it is treated as finished, never as fresh: fresh would
    /// set DFAI's own folders aside and copy Atlas's over them again.
    Unreadable(String),
}

pub fn load(file: &Path) -> Loaded {
    let text = match fs::read_to_string(file) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Loaded::State(State::default())
        }
        Err(error) => {
            return Loaded::Unreadable(format!("cannot read {}: {error}", file.display()))
        }
    };
    match serde_json::from_str::<State>(&text) {
        Ok(state) if state.version == FORMAT_VERSION => Loaded::State(state),
        _ => Loaded::Unreadable(format!(
            "{} is not a state this build wrote",
            file.display()
        )),
    }
}

/// Writes the state whole, through a temporary file renamed over the old.
pub fn save(file: &Path, state: &State) -> Result<(), String> {
    let json = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    let staged = file.with_extension("json.new");
    file.parent()
        .map_or(Ok(()), fs::create_dir_all)
        .and_then(|()| fs::write(&staged, json))
        .and_then(|()| fs::rename(&staged, file))
        .map_err(|error| format!("cannot save {}: {error}", file.display()))
}
