use std::fs;
use std::path::Path;

use tempfile::tempdir;

use super::fetch::{ensure_model, FileCheck};
use super::model::{passes, Embedder, ModelFile, ModelSpec, PASS_TOKENS};
use super::{check_batch, model_folder, MAX_BATCH_BYTES, MAX_TEXTS, MODEL};

#[test]
fn an_empty_call_is_a_call_the_host_takes() {
    assert_eq!(check_batch(&[]), Ok(()));
}

#[test]
fn takes_as_many_texts_as_the_most_and_refuses_one_more() {
    let most = vec!["a".to_string(); MAX_TEXTS];
    assert_eq!(check_batch(&most), Ok(()));

    let over = vec!["a".to_string(); MAX_TEXTS + 1];
    let error = check_batch(&over).unwrap_err();

    assert_eq!(
        error,
        format!(
            "{} texts were sent to embed at once; the most is {MAX_TEXTS}",
            MAX_TEXTS + 1
        )
    );
}

#[test]
fn refuses_more_text_than_the_most_in_bytes_counted_across_the_call() {
    let half = "x".repeat(MAX_BATCH_BYTES / 2);
    assert_eq!(check_batch(&[half.clone(), half.clone()]), Ok(()));

    let error = check_batch(&[half.clone(), half, "y".into()]).unwrap_err();

    assert!(
        error.contains(&format!("{} bytes", MAX_BATCH_BYTES + 1)),
        "{error}"
    );
}

#[test]
fn a_model_is_kept_in_the_data_folder_under_its_revision() {
    let folder = model_folder(Path::new("/data"), &MODEL);

    assert_eq!(
        folder,
        Path::new("/data/models/snowflake-arctic-embed-xs-d8c86521100d")
    );
}

#[test]
fn every_text_is_in_exactly_one_pass() {
    let lengths = [40, 512, 3, 200, 90, 90, 7, 256, 12];

    let mut seen: Vec<usize> = passes(&lengths).into_iter().flatten().collect();
    seen.sort_unstable();

    assert_eq!(seen, (0..lengths.len()).collect::<Vec<_>>());
}

#[test]
fn a_pass_padded_to_its_longest_text_stays_within_the_budget() {
    let lengths = [40, 30, 3, 200, 90, 90, 7, 60, 12, 64, 64, 64, 64];

    for pass in passes(&lengths) {
        let longest = pass.iter().map(|&index| lengths[index]).max().unwrap();
        assert!(
            pass.len() * longest <= PASS_TOKENS,
            "{pass:?} pads to {}",
            pass.len() * longest
        );
    }
}

#[test]
fn short_texts_share_a_pass_and_a_text_over_the_budget_runs_alone() {
    let lengths = [512, 8, 8, 8];

    let passes = passes(&lengths);

    assert_eq!(passes, vec![vec![1, 2, 3], vec![0]]);
}

#[test]
fn texts_each_over_the_budget_run_one_to_a_pass() {
    let lengths = [300, 512];

    assert_eq!(passes(&lengths), vec![vec![0], vec![1]]);
}

#[test]
fn no_texts_make_no_passes() {
    assert!(passes(&[]).is_empty());
}

// SHA-256 of the three bytes "abc".
const ABC: ModelFile = ModelFile {
    name: "model.safetensors",
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    bytes: 3,
};

#[test]
fn a_file_with_its_pinned_bytes_passes_however_it_arrives() {
    let mut check = FileCheck::new(&ABC);
    check.take(b"a").unwrap();
    check.take(b"bc").unwrap();

    assert_eq!(check.finish(), Ok(()));
}

#[test]
fn a_file_with_other_bytes_of_the_same_size_is_refused() {
    let mut check = FileCheck::new(&ABC);
    check.take(b"abd").unwrap();

    assert_eq!(
        check.finish(),
        Err("the embedding model's model.safetensors is not the file it was pinned at".into())
    );
}

#[test]
fn a_file_cut_short_is_refused() {
    let mut check = FileCheck::new(&ABC);
    check.take(b"ab").unwrap();

    assert!(check.finish().is_err());
}

#[test]
fn a_file_longer_than_pinned_is_refused_as_soon_as_it_passes_the_size() {
    let mut check = FileCheck::new(&ABC);
    check.take(b"abc").unwrap();

    let error = check.take(b"d").unwrap_err();

    assert_eq!(
        error,
        "the embedding model's model.safetensors is larger than the 3 bytes it was pinned at"
    );
}

/// The app's model, at a repository that does not exist: any attempt to fetch
/// it fails, so a call that succeeds made none.
const UNREACHABLE: ModelSpec = ModelSpec {
    repository: "atlas-test/no-such-model",
    ..MODEL
};

#[tokio::test]
async fn a_model_already_on_this_mac_is_not_fetched_again() {
    let folder = tempdir().unwrap();
    for file in UNREACHABLE.files {
        fs::write(folder.path().join(file.name), b"kept").unwrap();
    }

    assert_eq!(ensure_model(folder.path(), &UNREACHABLE).await, Ok(()));
}

#[tokio::test]
async fn a_model_folder_that_cannot_be_made_is_refused() {
    let error = ensure_model(Path::new("/dev/null/models"), &MODEL)
        .await
        .unwrap_err();

    assert!(
        error.starts_with("cannot make the embedding model's folder"),
        "{error}"
    );
}

#[test]
fn a_model_folder_without_the_files_is_refused_when_loading() {
    let folder = tempdir().unwrap();

    let error = Embedder::load(folder.path(), &MODEL).err().unwrap();

    assert!(
        error.starts_with("cannot read the embedding model's config"),
        "{error}"
    );
}

#[test]
fn a_model_whose_config_is_not_json_is_refused_when_loading() {
    let folder = tempdir().unwrap();
    fs::write(folder.path().join("config.json"), "{ not json").unwrap();

    let error = Embedder::load(folder.path(), &MODEL).err().unwrap();

    assert!(
        error.starts_with("the embedding model's config is not valid"),
        "{error}"
    );
}
