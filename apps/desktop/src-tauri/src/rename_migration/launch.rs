//! The migration as the app runs it, first thing in `run`: this Mac's home
//! folder and Keychain, one launch at a time, never while Atlas runs, and a
//! native alert instead of a window when it cannot finish.

use std::path::Path;

/// Whether a process's executable is Atlas's: the bundled app's
/// (`…/Contents/MacOS/Atlas`) or a development build's
/// (`…/target/debug/atlas`). The parent folder is checked too, so a
/// command-line tool that happens to be called `atlas` is not taken for it.
pub fn is_atlas_executable(path: &Path) -> bool {
    let named_atlas = path
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("atlas"));
    let text = path.to_string_lossy();
    named_atlas
        && (text.contains(".app/Contents/MacOS/")
            || text.contains("/target/debug/")
            || text.contains("/target/release/"))
}

/// What the person is told when DFAI cannot start, for each reason.
pub fn blocked_message(reason: &str) -> String {
    format!("DFAI couldn't move your Atlas data: {reason}. Quit Atlas and open DFAI again.")
}

pub const ATLAS_RUNNING: &str = "Quit Atlas, then open DFAI again.";

pub fn gave_up_message(accounts: &[String]) -> String {
    format!(
        "DFAI could not read {} of the secrets Atlas kept ({}), so they were not copied. Set them again in Settings → Secrets.",
        accounts.len(),
        accounts.join(", ")
    )
}

#[cfg(target_os = "macos")]
mod mac {
    use std::fs::{File, OpenOptions};
    use std::os::fd::AsRawFd;
    use std::path::{Path, PathBuf};

    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSApplication};
    use objc2_foundation::NSString;

    use super::{blocked_message, gave_up_message, is_atlas_executable, ATLAS_RUNNING};
    use crate::rename_migration::{folders_pending, migrate, Migration, LEGACY_IDENTIFIER};
    use crate::secrets::{KeychainStore, SERVICE};

    /// Runs the move. Exits the process, after an alert, when Atlas is
    /// running or a folder could not be copied: starting anyway would make
    /// DFAI's folders empty, and the person would find no vault.
    pub fn on_launch() -> Vec<String> {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return vec!["no HOME, so nothing was migrated from Atlas".into()];
        };
        let _lock = match lock(&home) {
            Ok(lock) => lock,
            Err(error) => return vec![error],
        };
        if folders_pending(&home) && atlas_is_running() {
            stop(ATLAS_RUNNING);
        }
        let outcome = migrate(&Migration {
            home: &home,
            legacy_secrets: &KeychainStore::for_service(LEGACY_IDENTIFIER),
            secrets: &KeychainStore::for_service(SERVICE),
        });
        if let Some(reason) = &outcome.blocked {
            stop(&blocked_message(reason));
        }
        if !outcome.gave_up.is_empty() {
            alert(&gave_up_message(&outcome.gave_up));
        }
        outcome.said
    }

    /// An exclusive lock, held for the whole migration, so a second launch
    /// waits for the first rather than copying beside it. In Application
    /// Support, outside every folder copied.
    fn lock(home: &Path) -> Result<File, String> {
        let support = home.join("Library/Application Support");
        let file = std::fs::create_dir_all(&support)
            .and_then(|()| {
                OpenOptions::new()
                    .create(true)
                    .truncate(false)
                    .write(true)
                    .open(support.join(".dfai-rename-migration.lock"))
            })
            .map_err(|error| format!("cannot open the migration's lock: {error}"))?;
        // SAFETY: the descriptor is the open file's, alive for this call.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
            return Err(format!(
                "cannot take the migration's lock: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(file)
    }

    /// Whether any process on this Mac runs Atlas's executable.
    fn atlas_is_running() -> bool {
        let ours = std::process::id() as libc::pid_t;
        process_ids()
            .into_iter()
            .filter(|pid| *pid > 0 && *pid != ours)
            .filter_map(executable_of)
            .any(|path| is_atlas_executable(&path))
    }

    fn process_ids() -> Vec<libc::pid_t> {
        // SAFETY: a null buffer asks only for the count.
        let count = unsafe { libc::proc_listallpids(std::ptr::null_mut(), 0) };
        if count <= 0 {
            return Vec::new();
        }
        // Room for processes started since the count was taken.
        let mut pids = vec![0 as libc::pid_t; count as usize + 64];
        let bytes = (pids.len() * std::mem::size_of::<libc::pid_t>()) as libc::c_int;
        // SAFETY: the buffer holds `bytes` bytes and outlives the call.
        let found = unsafe { libc::proc_listallpids(pids.as_mut_ptr().cast(), bytes) };
        pids.truncate(found.max(0) as usize);
        pids
    }

    fn executable_of(pid: libc::pid_t) -> Option<PathBuf> {
        let mut buffer = vec![0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
        // SAFETY: the buffer holds its length in bytes and outlives the call.
        let length =
            unsafe { libc::proc_pidpath(pid, buffer.as_mut_ptr().cast(), buffer.len() as u32) };
        if length <= 0 {
            return None;
        }
        buffer.truncate(length as usize);
        String::from_utf8(buffer).ok().map(PathBuf::from)
    }

    fn alert(text: &str) {
        let Some(mtm) = MainThreadMarker::new() else {
            eprintln!("{text}");
            return;
        };
        let _app = NSApplication::sharedApplication(mtm);
        let alert = NSAlert::new(mtm);
        alert.setMessageText(&NSString::from_str("DFAI"));
        alert.setInformativeText(&NSString::from_str(text));
        alert.runModal();
    }

    fn stop(text: &str) -> ! {
        alert(text);
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
pub use mac::on_launch;

/// DFAI ships for macOS only; elsewhere there was never an Atlas to move from.
#[cfg(not(target_os = "macos"))]
pub fn on_launch() -> Vec<String> {
    Vec::new()
}
