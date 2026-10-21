//! The one-time move from Atlas to DFAI (#482, ADR-0042).
//!
//! The app was called Atlas, with the bundle identifier `dev.jhoffman.atlas`.
//! Everything kept per Mac is filed under that identifier, so the first launch
//! under the new one would otherwise find nothing: no remembered vault, no API
//! token, no Keychain secrets, and none of what the webview keeps in its own
//! storage (this Mac's sync id, the theme, work a closing pane could not save).
//!
//! This copies all of it, before the app builds anything that would create
//! the new folders. It only ever copies: Atlas's folders and Keychain items
//! are left exactly as they are for this release, so going back to Atlas
//! still works. What is finished is kept in a state file outside every folder
//! copied (`state`), never judged from whether a new folder exists, so a copy
//! that failed is tried again however the new folder came to be.

use std::fs;
use std::ops::Deref;
use std::path::{Path, PathBuf};

use crate::secrets::SecretStore;

mod folders;
mod keychain_copy;
mod launch;
mod state;

#[cfg(test)]
pub use folders::copy_folder_once;
pub use folders::{Copied, FolderPair};
#[cfg(test)]
pub use keychain_copy::copy_secrets;
pub use launch::on_launch;

/// The bundle identifier, as `tauri.conf.json` says.
pub const IDENTIFIER: &str = "com.dailyflowai.dfai";
/// The bundle identifier Atlas had.
pub const LEGACY_IDENTIFIER: &str = "dev.jhoffman.atlas";
/// An unbundled binary (`pnpm tauri:dev`) has no bundle identifier, and WebKit
/// files its storage under the executable's name instead.
const EXECUTABLE: &str = "dfai";
const LEGACY_EXECUTABLE: &str = "atlas";
/// The report left in DFAI's own Application Support folder.
pub const REPORT: &str = "migration-from-atlas.log";

pub struct Migration<'a> {
    /// The home folder whose `Library` is migrated.
    pub home: &'a Path,
    /// The Keychain items filed under Atlas's service name.
    pub legacy_secrets: &'a dyn SecretStore,
    pub secrets: &'a dyn SecretStore,
}

/// What one launch's migration did, a line each. It reads as those lines.
#[derive(Debug, Default)]
pub struct Outcome {
    pub said: Vec<String>,
    /// Why a folder could not be copied. The app must not start: starting
    /// would make the new folders empty, and the person would see no vault.
    pub blocked: Option<String>,
    /// Secrets given up on this launch, to tell the person about once.
    pub gave_up: Vec<String>,
}

impl Deref for Outcome {
    type Target = [String];
    fn deref(&self) -> &[String] {
        &self.said
    }
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

/// Whether a folder still has to be copied from an Atlas folder that exists:
/// the only case in which a running Atlas matters.
pub fn folders_pending(home: &Path) -> bool {
    let state = match state::load(&state::state_file(&app_support(home))) {
        state::Loaded::State(state) => state,
        state::Loaded::Unreadable(_) => return false,
    };
    folders_under(home)
        .iter()
        .any(|pair| !state.folder_done(&pair.to) && pair.from.exists())
}

/// Runs the move and says what it did. Safe to run any number of times.
pub fn migrate(migration: &Migration<'_>) -> Outcome {
    let support = app_support(migration.home);
    let file = state::state_file(&support);
    let mut outcome = Outcome::default();
    let mut state = match state::load(&file) {
        state::Loaded::State(state) => state,
        state::Loaded::Unreadable(why) => {
            outcome
                .said
                .push(format!("{why}; nothing more is migrated"));
            settled_after_loss(migration.home, &file, &mut outcome)
        }
    };
    copy_folders(migration.home, &mut state, &mut outcome);
    if outcome.blocked.is_none() {
        let pass =
            keychain_copy::copy_unsettled(&mut state, migration.legacy_secrets, migration.secrets);
        outcome.said.extend(pass.said);
        outcome.gave_up = pass.gave_up;
    }
    finish(&support, &file, &mut state, &mut outcome);
    outcome
}

/// A state that says everything is finished, after the old one was lost. The
/// unreadable file is kept beside it, set aside, for whoever looks.
fn settled_after_loss(home: &Path, file: &Path, outcome: &mut Outcome) -> state::State {
    if let Err(error) = folders::set_aside(file) {
        outcome.said.push(error);
    }
    let mut state = state::State {
        keychain_closed: true,
        ..state::State::default()
    };
    for pair in folders_under(home) {
        state.mark_folder_done(&pair.to);
    }
    state
}

fn copy_folders(home: &Path, state: &mut state::State, outcome: &mut Outcome) {
    for pair in folders_under(home) {
        if state.folder_done(&pair.to) {
            continue;
        }
        match copy_pair(&pair, &mut outcome.said) {
            Ok(()) => state.mark_folder_done(&pair.to),
            Err(error) => {
                outcome.said.push(error.clone());
                outcome.blocked.get_or_insert(error);
            }
        }
    }
}

/// Copies one pair not yet done. A new folder already there was made by
/// something else — WebKit, or a launch whose copy failed — and holds nothing
/// of Atlas's, so it is set aside (never deleted) to make room.
fn copy_pair(pair: &FolderPair, said: &mut Vec<String>) -> Result<(), String> {
    if !folders::exists(&pair.from)? {
        return Ok(());
    }
    if folders::exists(&pair.to)? {
        let aside = folders::set_aside(&pair.to)?;
        said.push(format!(
            "set {} aside as {} to copy Atlas's over it",
            pair.to.display(),
            aside.display()
        ));
    }
    if folders::copy_folder_noting(pair, said)? == Copied::Folder {
        said.push(format!(
            "copied {} to {}",
            pair.from.display(),
            pair.to.display()
        ));
    }
    Ok(())
}

/// Saves the state, and once the folders are in place leaves the whole log
/// as a report in DFAI's own folder. A blocked launch writes nothing there:
/// making that folder is what would hide the failed copy.
fn finish(support: &Path, file: &Path, state: &mut state::State, outcome: &mut Outcome) {
    state.log.extend(outcome.said.iter().cloned());
    if outcome.blocked.is_none() && !state.log.is_empty() {
        let folder = support.join(IDENTIFIER);
        let report = fs::create_dir_all(&folder)
            .and_then(|()| fs::write(folder.join(REPORT), state.log.join("\n") + "\n"));
        if let Err(error) = report {
            outcome
                .said
                .push(format!("could not write the report: {error}"));
        }
    }
    if let Err(error) = state::save(file, state) {
        outcome.said.push(error);
    }
}

#[cfg(test)]
mod tests;
