//! Listing the vault's files of one kind — its PDFs, for `[[name.pdf]]` (#506)
//! — in one walk, so a link is not a host call per folder.
//!
//! As with the note walk (ADR-0014), this reports what is on disk and skips
//! only the folders it is *told* to skip; which of the files the user should
//! see is decided in TypeScript.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::vault::{off_main, resolve, root_of, VaultState};

/// What one walk is told: the files it lists, and where it does not go.
pub(crate) struct FileWalk<'a> {
    /// Without the dot, any case: `pdf` lists `Notes.PDF` too.
    pub(crate) extension: &'a str,
    /// Names not to descend into, matched on a folder's own name at any level.
    pub(crate) skip: &'a HashSet<String>,
    /// How many folders down to look, as the note walk is told.
    pub(crate) max_depth: usize,
}

impl FileWalk<'_> {
    /// Every file under `root` with the extension, as paths relative to it.
    ///
    /// A link to a folder is not walked: `file_type` does not follow it, so a
    /// link that loops back on the vault cannot make the walk endless or list
    /// a file twice. A folder that cannot be read (permissions, or removed by
    /// a sync mid-walk) is left out, as the note walk leaves it out; the root
    /// that cannot be read is an error, not an empty vault.
    pub(crate) fn list(&self, root: &Path) -> Result<Vec<String>, String> {
        let suffix = format!(".{}", self.extension.to_lowercase());
        let mut found = Vec::new();
        let mut pending: Vec<(PathBuf, String, usize)> =
            vec![(root.to_path_buf(), String::new(), 0)];
        while let Some((directory, prefix, depth)) = pending.pop() {
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) if prefix.is_empty() => {
                    return Err(format!("the vault could not be listed: {error}"))
                }
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if self.skip.contains(&name) {
                    continue;
                }
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                let relative = if prefix.is_empty() {
                    name.clone()
                } else {
                    format!("{prefix}/{name}")
                };
                if kind.is_dir() {
                    if depth < self.max_depth {
                        pending.push((entry.path(), relative, depth + 1));
                    }
                } else if name.to_lowercase().ends_with(&suffix)
                    && (kind.is_file() || links_to_file_in_vault(root, &entry.path(), &relative))
                {
                    found.push(relative);
                }
            }
        }
        found.sort();
        Ok(found)
    }
}

/// A link to a file is listed only when the file is in the vault, as a read of it would be.
fn links_to_file_in_vault(root: &Path, path: &Path, relative: &str) -> bool {
    kind_is_file(path) && resolve(root, relative).is_ok()
}

fn kind_is_file(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
}

/// Every file of the vault with `extension`, as paths relative to it, minus
/// the folders `skip_directories` names and no more than `max_depth` folders
/// down. Off the main thread, as the note walk is.
#[tauri::command]
pub async fn list_vault_files(
    state: State<'_, VaultState>,
    extension: String,
    skip_directories: Vec<String>,
    max_depth: usize,
) -> Result<Vec<String>, String> {
    let root = root_of(&state)?;
    off_main(move || {
        let skip: HashSet<String> = skip_directories.into_iter().collect();
        FileWalk {
            extension: &extension,
            skip: &skip,
            max_depth,
        }
        .list(&root)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::FileWalk;
    use std::collections::HashSet;
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    fn pdfs_in(root: &Path, skip: &[&str], max_depth: usize) -> Result<Vec<String>, String> {
        let skip: HashSet<String> = skip.iter().map(|name| (*name).to_owned()).collect();
        FileWalk {
            extension: "pdf",
            skip: &skip,
            max_depth,
        }
        .list(root)
    }

    #[test]
    fn lists_the_files_of_the_kind_at_every_level_and_nothing_else() {
        let vault = tempdir().unwrap();
        fs::create_dir_all(vault.path().join("Library/Courses")).unwrap();
        fs::write(vault.path().join("top.pdf"), "x").unwrap();
        fs::write(vault.path().join("Library/Courses/Reading.PDF"), "x").unwrap();
        fs::write(vault.path().join("Library/notes.md"), "x").unwrap();
        fs::write(vault.path().join("Library/pdf"), "x").unwrap();
        assert_eq!(
            pdfs_in(vault.path(), &[], 32).unwrap(),
            vec!["Library/Courses/Reading.PDF", "top.pdf"]
        );
    }

    #[test]
    fn does_not_go_into_the_folders_it_is_told_to_skip() {
        let vault = tempdir().unwrap();
        for folder in [".git", "node_modules", ".trash", "Library"] {
            fs::create_dir_all(vault.path().join(folder)).unwrap();
            fs::write(vault.path().join(folder).join("a.pdf"), "x").unwrap();
        }
        assert_eq!(
            pdfs_in(vault.path(), &[".git", "node_modules", ".trash"], 32).unwrap(),
            vec!["Library/a.pdf"]
        );
    }

    #[test]
    fn looks_no_deeper_than_it_is_told() {
        let vault = tempdir().unwrap();
        fs::create_dir_all(vault.path().join("a/b")).unwrap();
        fs::write(vault.path().join("a/one.pdf"), "x").unwrap();
        fs::write(vault.path().join("a/b/two.pdf"), "x").unwrap();
        assert_eq!(pdfs_in(vault.path(), &[], 1).unwrap(), vec!["a/one.pdf"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_that_loops_back_on_the_vault_is_not_walked() {
        let vault = tempdir().unwrap();
        fs::create_dir_all(vault.path().join("Library")).unwrap();
        fs::write(vault.path().join("Library/a.pdf"), "x").unwrap();
        std::os::unix::fs::symlink(vault.path(), vault.path().join("Library/loop")).unwrap();
        assert_eq!(
            pdfs_in(vault.path(), &[], 32).unwrap(),
            vec!["Library/a.pdf"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_a_pdf_is_listed_only_when_the_pdf_is_in_the_vault() {
        let vault = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(vault.path().join("inside.pdf"), "x").unwrap();
        fs::write(outside.path().join("away.pdf"), "x").unwrap();
        std::os::unix::fs::symlink(
            vault.path().join("inside.pdf"),
            vault.path().join("again.pdf"),
        )
        .unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("away.pdf"),
            vault.path().join("away.pdf"),
        )
        .unwrap();
        assert_eq!(
            pdfs_in(vault.path(), &[], 32).unwrap(),
            vec!["again.pdf", "inside.pdf"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_that_cannot_be_read_is_left_out_and_the_rest_listed() {
        use std::os::unix::fs::PermissionsExt;
        let vault = tempdir().unwrap();
        fs::create_dir_all(vault.path().join("Library")).unwrap();
        fs::create_dir_all(vault.path().join("Private")).unwrap();
        fs::write(vault.path().join("Library/a.pdf"), "x").unwrap();
        fs::write(vault.path().join("Private/b.pdf"), "x").unwrap();
        let private = vault.path().join("Private");
        fs::set_permissions(&private, fs::Permissions::from_mode(0o000)).unwrap();
        let listed = pdfs_in(vault.path(), &[], 32);
        // Readable again before asserting, so the temporary folder can be removed.
        fs::set_permissions(&private, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(listed.unwrap(), vec!["Library/a.pdf"]);
    }

    #[test]
    fn a_vault_that_cannot_be_read_is_an_error_not_an_empty_vault() {
        let vault = tempdir().unwrap();
        let missing = vault.path().join("gone");
        let error = pdfs_in(&missing, &[], 32).unwrap_err();
        assert!(error.contains("could not be listed"), "{error}");
    }
}
