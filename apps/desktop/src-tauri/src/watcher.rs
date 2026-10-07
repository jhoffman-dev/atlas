//! Notices changes made to the vault outside the app.
//!
//! A vault is a folder of ordinary files: Obsidian, a sync client or a text editor
//! can change it at any moment. The watcher reports what changed and nothing more;
//! deciding what to do about it happens in TypeScript.

use std::path::Path;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

use crate::vault::VaultState;

/// Changes arrive in bursts — a save is often several events — so they are
/// collected briefly and reported once.
const QUIET_PERIOD: Duration = Duration::from_millis(400);

/// Our own index lives inside the vault; reporting writes to it would start a loop
/// where indexing triggers indexing.
const IGNORED: [&str; 2] = [".atlas-cache", ".git"];

#[derive(Default)]
pub struct WatcherState(Mutex<Option<RecommendedWatcher>>);

fn is_ignored(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return true;
    };
    relative
        .components()
        .any(|component| IGNORED.contains(&component.as_os_str().to_string_lossy().as_ref()))
}

fn to_relative(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let text = relative.to_string_lossy().replace('\\', "/");
    (!text.is_empty()).then_some(text)
}

/// Starts watching the open vault, replacing any previous watch.
#[tauri::command]
pub fn watch_vault(
    app: AppHandle,
    vault: State<'_, VaultState>,
    watcher: State<'_, WatcherState>,
) -> Result<(), String> {
    let root = vault.root().ok_or("no vault is open")?;
    let (sender, receiver) = channel();

    let mut handle: RecommendedWatcher =
        notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
            if let Ok(event) = event {
                let _ = sender.send(event.paths);
            }
        })
        .map_err(|error| format!("cannot watch the vault: {error}"))?;

    handle
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| format!("cannot watch the vault: {error}"))?;

    let watch_root = root.clone();
    std::thread::spawn(move || {
        let mut pending: Vec<String> = Vec::new();
        loop {
            match receiver.recv_timeout(QUIET_PERIOD) {
                Ok(paths) => {
                    for path in paths {
                        if is_ignored(&watch_root, &path) {
                            continue;
                        }
                        if let Some(relative) = to_relative(&watch_root, &path) {
                            if !pending.contains(&relative) {
                                pending.push(relative);
                            }
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        log::debug!("vault changed: {} paths", pending.len());
                        let _ = app.emit("vault-changed", &pending);
                        pending.clear();
                    }
                }
                // The watcher was replaced or the app is closing.
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    *watcher.0.lock().map_err(|_| "watcher state poisoned")? = Some(handle);
    log::info!("watching {}", root.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{is_ignored, to_relative};
    use std::path::Path;

    #[test]
    fn reports_a_note_relative_to_the_vault() {
        assert_eq!(
            to_relative(Path::new("/vault"), Path::new("/vault/Notes/today.md")),
            Some("Notes/today.md".to_string())
        );
    }

    #[test]
    fn ignores_a_path_outside_the_vault() {
        assert_eq!(
            to_relative(Path::new("/vault"), Path::new("/elsewhere/x.md")),
            None
        );
        assert!(is_ignored(
            Path::new("/vault"),
            Path::new("/elsewhere/x.md")
        ));
    }

    #[test]
    fn ignores_the_vault_root_itself() {
        assert_eq!(to_relative(Path::new("/vault"), Path::new("/vault")), None);
    }

    #[test]
    fn ignores_our_own_cache_so_indexing_does_not_loop() {
        assert!(is_ignored(
            Path::new("/vault"),
            Path::new("/vault/.atlas-cache/index.sqlite")
        ));
        assert!(is_ignored(
            Path::new("/vault"),
            Path::new("/vault/.atlas-cache/index.sqlite-wal")
        ));
    }

    #[test]
    fn ignores_git_internals() {
        assert!(is_ignored(
            Path::new("/vault"),
            Path::new("/vault/.git/objects/ab/cdef")
        ));
    }

    #[test]
    fn reports_an_ordinary_note() {
        assert!(!is_ignored(
            Path::new("/vault"),
            Path::new("/vault/today.md")
        ));
    }
}
