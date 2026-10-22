//! Where an export may write, against real folders on disk.

use std::fs;
use std::path::{Path, PathBuf};

use super::{
    filter_label, grant_file, grant_folder, outside_vaults, relative_parts, remove_made,
    write_into, write_tracked, DestinationRequest, ExportGrants, Grant, MAX_FILE_BYTES,
};

/// A temporary folder, resolved: on macOS the temp dir is behind `/var`, a link.
fn place() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    (dir, root)
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

fn file_request(name: &str, extension: &str, suffix: Option<&str>) -> DestinationRequest {
    DestinationRequest::File {
        suggested_name: name.into(),
        extension: extension.into(),
        companion_suffix: suffix.map(Into::into),
    }
}

#[test]
fn reads_both_kinds_of_request_from_the_frontend_s_json() {
    let file: DestinationRequest = serde_json::from_str(
        r#"{"kind":"file","suggestedName":"Kickoff.md","extension":"md","companionSuffix":" attachments"}"#,
    )
    .unwrap();
    assert_eq!(file, file_request("Kickoff.md", "md", Some(" attachments")));
    let bare: DestinationRequest = serde_json::from_str(
        r#"{"kind":"file","suggestedName":"Kickoff.pdf","extension":"pdf","companionSuffix":null}"#,
    )
    .unwrap();
    assert_eq!(bare, file_request("Kickoff.pdf", "pdf", None));
    let folder: DestinationRequest =
        serde_json::from_str(r#"{"kind":"folder","folderName":"Larkspur notes"}"#).unwrap();
    assert_eq!(
        folder,
        DestinationRequest::Folder {
            folder_name: "Larkspur notes".into()
        }
    );
    assert!(serde_json::from_str::<DestinationRequest>(r#"{"kind":"zip"}"#).is_err());
}

#[test]
fn refuses_names_that_are_not_one_safe_component_before_asking() {
    assert!(file_request("Kickoff.md", "md", Some(" attachments"))
        .check()
        .is_ok());
    for name in ["", ".", "..", "a/b", "/abs", "nul\0l"] {
        assert!(file_request(name, "md", None).check().is_err(), "{name:?}");
        let folder = DestinationRequest::Folder {
            folder_name: name.into(),
        };
        assert!(folder.check().is_err(), "{name:?}");
    }
    for extension in ["", ".md", "m/d", "p d f"] {
        assert!(
            file_request("Kickoff", extension, None).check().is_err(),
            "{extension:?}"
        );
    }
    for suffix in ["/x", "a\0"] {
        assert!(
            file_request("Kickoff.md", "md", Some(suffix))
                .check()
                .is_err(),
            "{suffix:?}"
        );
    }
    assert_eq!(
        file_request("", "md", None).check().unwrap_err(),
        "the file name is empty"
    );
}

#[test]
fn labels_the_dialog_s_filter_by_extension() {
    assert_eq!(filter_label("md"), "Markdown");
    assert_eq!(filter_label("pdf"), "PDF");
    assert_eq!(filter_label("html"), "HTML");
}

#[test]
fn a_chosen_file_keeps_or_gains_its_extension_and_names_its_companion() {
    let (_dir, root) = place();
    let grant = grant_file(&root.join("Kickoff.md"), "md", Some(" attachments")).unwrap();
    let Grant::File { file, companion } = &grant else {
        panic!("a file grant");
    };
    assert_eq!(file, &root.join("Kickoff.md"));
    let companion = companion.as_ref().unwrap();
    assert_eq!(companion.name, "Kickoff attachments");
    assert_eq!(companion.dir, root.join("Kickoff attachments"));
    // Made with the grant, so a folder of that name already there is never used (#502).
    assert!(companion.dir.is_dir());

    let grant = grant_file(&root.join("Kickoff"), "pdf", None).unwrap();
    assert_eq!(
        grant,
        Grant::File {
            file: root.join("Kickoff.pdf"),
            companion: None
        }
    );
    let grant = grant_file(&root.join("Kickoff.PDF"), "pdf", None).unwrap();
    assert!(matches!(grant, Grant::File { file, .. } if file == root.join("Kickoff.PDF")));
}

#[test]
fn a_companion_cannot_take_the_file_s_own_name() {
    let (_dir, root) = place();
    let error = grant_file(&root.join("Kickoff.md"), "md", Some(".md")).unwrap_err();
    assert_eq!(
        error,
        "the attachments folder would have the file's own name"
    );
}

#[test]
fn a_folder_export_makes_a_new_folder_and_never_reuses_one() {
    let (_dir, root) = place();
    fs::create_dir(root.join("Notes")).unwrap();
    fs::write(root.join("Notes").join("kept.md"), "old").unwrap();
    fs::write(root.join("Notes 2"), "a file, not a folder").unwrap();
    let third = grant_folder(&root, "Notes").unwrap();
    assert_eq!(
        third,
        Grant::Folder {
            root: root.join("Notes 3")
        }
    );
    let fourth = grant_folder(&root, "Notes").unwrap();
    assert_eq!(
        fourth,
        Grant::Folder {
            root: root.join("Notes 4")
        }
    );
    assert_eq!(names_in(&root.join("Notes")), ["kept.md"]);
    assert!(names_in(&root.join("Notes 3")).is_empty());
    let first = grant_folder(&root, "Fresh").unwrap();
    assert_eq!(
        first,
        Grant::Folder {
            root: root.join("Fresh")
        }
    );
    assert!(grant_folder(&root, "..").is_err());
}

#[test]
fn relative_paths_are_only_plain_names() {
    assert_eq!(relative_parts("").unwrap(), Vec::<&str>::new());
    assert_eq!(relative_parts("a/b c/d.md").unwrap(), ["a", "b c", "d.md"]);
    for path in [
        "/etc/passwd",
        "../out.md",
        "a/../b",
        "a//b",
        "a/",
        "./a",
        "a/./b",
        "a\0b",
    ] {
        let error = relative_parts(path).unwrap_err();
        assert!(
            error.ends_with("is not a path inside the export"),
            "{path:?}: {error}"
        );
    }
}

#[test]
fn writes_the_chosen_file_over_what_was_there() {
    let (_dir, root) = place();
    fs::write(root.join("Kickoff.md"), "old").unwrap();
    let grant = grant_file(&root.join("Kickoff.md"), "md", None).unwrap();
    assert_eq!(write_into(&grant, "", b"# Kickoff\n").unwrap(), 10);
    assert_eq!(fs::read(root.join("Kickoff.md")).unwrap(), b"# Kickoff\n");
    // Nothing staged is left beside it.
    assert_eq!(names_in(&root), ["Kickoff.md"]);
}

#[test]
fn writes_attachments_into_the_companion_made_with_the_grant() {
    let (_dir, root) = place();
    let grant = grant_file(&root.join("Kickoff.md"), "md", Some(" attachments")).unwrap();
    write_into(&grant, "", b"![[deck.png]]").unwrap();
    assert_eq!(names_in(&root), ["Kickoff attachments", "Kickoff.md"]);
    write_into(&grant, "Kickoff attachments/deck.png", b"png").unwrap();
    write_into(&grant, "Kickoff attachments/audio/call.m4a", b"m4a").unwrap();
    let companion = root.join("Kickoff attachments");
    assert_eq!(fs::read(companion.join("deck.png")).unwrap(), b"png");
    assert_eq!(fs::read(companion.join("audio/call.m4a")).unwrap(), b"m4a");
    assert_eq!(names_in(&root), ["Kickoff attachments", "Kickoff.md"]);
}

#[test]
fn a_file_grant_writes_nowhere_but_the_file_and_its_companion() {
    let (_dir, root) = place();
    let with = grant_file(&root.join("Kickoff.md"), "md", Some(" attachments")).unwrap();
    let without = grant_file(&root.join("Kickoff.md"), "md", None).unwrap();
    let refused = "an export's other files go in its attachments folder";
    assert_eq!(write_into(&with, "other.md", b"x").unwrap_err(), refused);
    assert_eq!(
        write_into(&with, "Kickoff attachments", b"x").unwrap_err(),
        refused
    );
    assert_eq!(
        write_into(&without, "Kickoff attachments/a.png", b"x").unwrap_err(),
        refused
    );
    assert!(write_into(&with, "Kickoff attachments/../x", b"x").is_err());
    // Only the attachments folder made with the grant, empty.
    assert_eq!(names_in(&root), ["Kickoff attachments"]);
    assert!(names_in(&root.join("Kickoff attachments")).is_empty());
}

#[test]
fn a_folder_grant_writes_files_below_it_and_never_the_folder_itself() {
    let (_dir, root) = place();
    let grant = grant_folder(&root, "Export").unwrap();
    assert_eq!(
        write_into(&grant, "", b"x").unwrap_err(),
        "a folder export needs a file's name"
    );
    write_into(&grant, "Kickoff.md", b"one").unwrap();
    write_into(&grant, "Kickoff attachments/deck.png", b"two").unwrap();
    let export = root.join("Export");
    assert_eq!(fs::read(export.join("Kickoff.md")).unwrap(), b"one");
    assert_eq!(
        fs::read(export.join("Kickoff attachments/deck.png")).unwrap(),
        b"two"
    );
    assert!(write_into(&grant, "../escape.md", b"x").is_err());
    assert!(!root.join("escape.md").exists());
}

#[cfg(unix)]
#[test]
fn a_link_in_the_folder_cannot_lead_a_write_out() {
    let (_dir, root) = place();
    let (_outside_dir, outside) = place();
    let grant = grant_folder(&root, "Export").unwrap();
    let export = root.join("Export");
    std::os::unix::fs::symlink(&outside, export.join("link")).unwrap();
    for path in ["link/stolen.md", "link/deeper/stolen.md"] {
        let error = write_into(&grant, path, b"x").unwrap_err();
        assert!(
            error.ends_with("is in the way: it is not a folder"),
            "{error}"
        );
    }
    assert!(names_in(&outside).is_empty(), "nothing is made outside");
}

#[cfg(unix)]
#[test]
fn a_link_in_the_companion_s_place_cannot_lead_a_write_out() {
    let (_dir, root) = place();
    let (_outside_dir, outside) = place();
    let grant = grant_file(&root.join("Kickoff.md"), "md", Some(" attachments")).unwrap();
    // Swapped for a link after the grant made it.
    fs::remove_dir(root.join("Kickoff attachments")).unwrap();
    std::os::unix::fs::symlink(&outside, root.join("Kickoff attachments")).unwrap();
    assert!(write_into(&grant, "Kickoff attachments/deck.png", b"x").is_err());
    assert!(names_in(&outside).is_empty());
}

#[test]
fn a_file_in_the_way_of_a_folder_is_reported() {
    let (_dir, root) = place();
    let grant = grant_folder(&root, "Export").unwrap();
    write_into(&grant, "a", b"file").unwrap();
    let error = write_into(&grant, "a/b.md", b"x").unwrap_err();
    assert!(
        error.ends_with("is in the way: it is not a folder"),
        "{error}"
    );
    assert_eq!(fs::read(root.join("Export/a")).unwrap(), b"file");
}

#[test]
fn refuses_a_body_over_the_cap() {
    let (_dir, root) = place();
    let grant = grant_folder(&root, "Export").unwrap();
    let big = vec![0u8; MAX_FILE_BYTES + 1];
    assert_eq!(
        write_into(&grant, "big.bin", &big).unwrap_err(),
        "a file to export is at most 512 MB"
    );
    assert!(!root.join("Export/big.bin").exists());
}

#[test]
fn grants_are_found_by_an_unguessable_id_until_finished() {
    let (_dir, root) = place();
    let grants = ExportGrants::default();
    let grant = grant_file(&root.join("Kickoff.md"), "md", Some(" attachments")).unwrap();
    let granted = grants.insert(grant.clone()).unwrap();
    assert_eq!(granted.id.len(), 64);
    assert!(granted.id.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_eq!(granted.path, root.join("Kickoff.md").to_string_lossy());
    assert_eq!(
        granted.companion.as_deref(),
        Some(root.join("Kickoff attachments").to_string_lossy().as_ref())
    );
    assert_eq!(grants.get(&granted.id).unwrap(), grant);
    let other = grants.insert(grant).unwrap();
    assert_ne!(other.id, granted.id);

    grants.finish(&granted.id);
    grants.finish(&granted.id);
    assert_eq!(
        grants.get(&granted.id).unwrap_err(),
        "this export's destination is no longer open; export again"
    );
    assert!(grants.get(&other.id).is_ok());
    assert!(grants.get("").is_err());
}

#[test]
fn a_folder_grant_is_reported_without_a_companion() {
    let (_dir, root) = place();
    let grants = ExportGrants::default();
    let granted = grants
        .insert(grant_folder(&root, "Export").unwrap())
        .unwrap();
    assert_eq!(granted.path, root.join("Export").to_string_lossy());
    assert_eq!(granted.companion, None);
    let json = serde_json::to_value(&granted).unwrap();
    assert!(json.get("companion").unwrap().is_null());
    assert!(json.get("path").is_some() && json.get("id").is_some());
}

// Attack on PR #502: a single-note export's attachments folder may already
// exist beside the chosen file, holding the person's own files. The save
// dialog only asked to replace the note's file, never anything in that folder.
#[test]
fn attack_502_an_existing_attachments_folder_s_files_are_never_overwritten() {
    let (_dir, root) = place();
    let companion = root.join("Kickoff attachments");
    fs::create_dir(&companion).unwrap();
    fs::write(companion.join("deck.png"), b"the person's own picture").unwrap();
    let grant = grant_file(&root.join("Kickoff.md"), "md", Some(" attachments")).unwrap();
    // Either refused or written under another name; never in place of theirs.
    let _ = write_into(&grant, "Kickoff attachments/deck.png", b"exported");
    assert_eq!(
        fs::read(companion.join("deck.png")).unwrap(),
        b"the person's own picture"
    );
}

#[test]
fn a_taken_attachments_folder_name_is_numbered_and_the_old_folder_left_alone() {
    let (_dir, root) = place();
    fs::create_dir(root.join("Kickoff attachments")).unwrap();
    fs::create_dir(root.join("Kickoff attachments 2")).unwrap();
    let grant = grant_file(&root.join("Kickoff.md"), "md", Some(" attachments")).unwrap();
    let Grant::File { companion, .. } = &grant else {
        panic!("a file grant");
    };
    assert_eq!(companion.as_ref().unwrap().name, "Kickoff attachments 3");
    write_into(&grant, "Kickoff attachments 3/deck.png", b"png").unwrap();
    assert!(names_in(&root.join("Kickoff attachments")).is_empty());
    assert_eq!(
        fs::read(root.join("Kickoff attachments 3/deck.png")).unwrap(),
        b"png"
    );
}

#[test]
fn an_extension_the_dialog_did_not_show_never_replaces_a_file_already_there() {
    let (_dir, root) = place();
    fs::write(root.join("Kickoff.md"), b"the person's own").unwrap();
    let refused = grant_file(&root.join("Kickoff"), "md", None).unwrap_err();
    assert!(
        refused.contains("\"Kickoff.md\" is already there"),
        "{refused}"
    );
    assert_eq!(
        fs::read(root.join("Kickoff.md")).unwrap(),
        b"the person's own"
    );
    // Chosen with its extension, the panel asked first: that one may be replaced.
    assert!(grant_file(&root.join("Kickoff.md"), "md", None).is_ok());
}

#[test]
fn a_place_inside_the_open_vault_is_refused() {
    let (_dir, root) = place();
    let vault = root.join("Vault");
    fs::create_dir_all(vault.join("Projects")).unwrap();
    let refused = outside_vaults(&vault.join("Projects"), std::slice::from_ref(&vault));
    assert!(refused.unwrap_err().contains("inside the vault"));
    assert!(outside_vaults(&vault, std::slice::from_ref(&vault)).is_err());
    assert!(outside_vaults(&root, std::slice::from_ref(&vault)).is_ok());
    // A sibling whose name starts the same is not inside it.
    fs::create_dir(root.join("Vault exports")).unwrap();
    assert!(outside_vaults(&root.join("Vault exports"), &[vault]).is_ok());
}

#[test]
fn a_failed_export_takes_back_only_what_it_made() {
    let (_dir, root) = place();
    fs::write(root.join("keep.txt"), b"theirs").unwrap();
    let grants = ExportGrants::default();
    let granted = grants
        .insert(grant_folder(&root, "Exported notes").unwrap())
        .unwrap();
    let grant = grants.get(&granted.id).unwrap();
    for path in ["Kickoff.md", "attachments/deck.png"] {
        let (_, made) = write_tracked(&grant, path, b"x").unwrap();
        grants.record_made(&granted.id, made);
    }
    remove_made(&grants.finish(&granted.id));
    assert_eq!(names_in(&root), ["keep.txt"]);
}

#[test]
fn taking_back_a_file_export_keeps_a_file_that_was_there_before() {
    let (_dir, root) = place();
    fs::write(root.join("Kickoff.md"), b"old").unwrap();
    let grants = ExportGrants::default();
    let granted = grants
        .insert(grant_file(&root.join("Kickoff.md"), "md", Some(" attachments")).unwrap())
        .unwrap();
    let grant = grants.get(&granted.id).unwrap();
    for path in ["", "Kickoff attachments/deck.png"] {
        let (_, made) = write_tracked(&grant, path, b"new").unwrap();
        grants.record_made(&granted.id, made);
    }
    remove_made(&grants.finish(&granted.id));
    // Replaced, as the dialog asked; the attachments folder it made is gone.
    assert_eq!(names_in(&root), ["Kickoff.md"]);
}
