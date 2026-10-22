//! The migration as the app runs it, first thing in `run`: this Mac's home
//! folder and Keychain, one launch at a time, never while Atlas runs, and a
//! native alert instead of a window when it cannot finish.

use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::path::Path;

/// An exclusive lock, held for the whole migration, so a second launch waits
/// for the first rather than copying beside it. In Application Support,
/// beside the state file and outside every folder copied.
pub fn lock_in(support: &Path) -> Result<File, String> {
    let file = std::fs::create_dir_all(support)
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

/// Whether a process is an Atlas that matters: one of this user's. Another
/// user's Atlas on the same Mac has its own `~/Library`.
pub fn is_users_atlas(executable: &Path, owner: u32, user: u32) -> bool {
    owner == user && is_atlas_executable(executable)
}

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
    use std::path::PathBuf;

    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSApplication};
    use objc2_foundation::NSString;

    use super::{blocked_message, gave_up_message, is_users_atlas, lock_in, ATLAS_RUNNING};
    use crate::rename_migration::{folders_pending, migrate, Migration, LEGACY_IDENTIFIER};
    use crate::secrets::{KeychainStore, SERVICE};

    /// Runs the move. Exits the process, after an alert, when Atlas is
    /// running or a folder could not be copied: starting anyway would make
    /// DFAI's folders empty, and the person would find no vault.
    pub fn on_launch() -> Vec<String> {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return vec!["no HOME, so nothing was migrated from Atlas".into()];
        };
        // Without the lock another launch may be copying: never start unmigrated.
        let _lock = match lock_in(&home.join("Library/Application Support")) {
            Ok(lock) => lock,
            Err(error) => stop(&blocked_message(&error)),
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

    /// Whether a process of this user's runs Atlas's executable.
    fn atlas_is_running() -> bool {
        let ours = std::process::id() as libc::pid_t;
        // SAFETY: getuid cannot fail.
        let user = unsafe { libc::getuid() };
        process_ids()
            .into_iter()
            .filter(|pid| *pid > 0 && *pid != ours)
            .filter_map(|pid| Some((executable_of(pid)?, owner_of(pid)?)))
            .any(|(path, owner)| is_users_atlas(&path, owner, user))
    }

    /// The user id a process runs as, from its BSD info.
    fn owner_of(pid: libc::pid_t) -> Option<u32> {
        // SAFETY: `proc_bsdinfo` is plain integers and bytes; all zeroes is valid.
        let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        // SAFETY: `info` is a whole `proc_bsdinfo` and outlives the call.
        let read = unsafe {
            libc::proc_pidinfo(
                pid,
                libc::PROC_PIDTBSDINFO,
                0,
                (&mut info as *mut libc::proc_bsdinfo).cast(),
                size,
            )
        };
        (read == size).then_some(info.pbi_uid)
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
