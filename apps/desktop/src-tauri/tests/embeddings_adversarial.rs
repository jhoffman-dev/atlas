//! Adversarial tests of the embedding host (P32-01, #32): what is on disk
//! under a model file's own name, and what the tokenizer quietly does to a
//! text it cannot read. Reuses the model the `embeddings` integration test
//! fetched into the build's temporary folder; never fetches it again.

use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use atlas_lib::embeddings::fetch::ensure_model;
use atlas_lib::embeddings::model::{Embedder, ModelSpec, Purpose};
use atlas_lib::embeddings::{model_folder, MODEL};
use tempfile::{tempdir_in, TempDir};

/// The app's model at a repository that does not exist: a fix that refetches
/// a bad file gets a refusal from the network, never the real file.
const NOWHERE: ModelSpec = ModelSpec {
    repository: "atlas-test/no-such-model",
    ..MODEL
};

/// The checked model, fetched once into the build's temporary folder.
async fn cached_model() -> PathBuf {
    let folder = model_folder(Path::new(env!("CARGO_TARGET_TMPDIR")), &MODEL);
    ensure_model(&folder, &MODEL)
        .await
        .expect("the model is fetched (the first run needs the network)");
    folder
}

/// A copy of the checked model's files in a folder of its own.
async fn copy_of_model() -> TempDir {
    let source = cached_model().await;
    let copy = tempdir_in(env!("CARGO_TARGET_TMPDIR")).unwrap();
    for file in MODEL.files {
        fs::copy(source.join(file.name), copy.path().join(file.name)).unwrap();
    }
    copy
}

#[tokio::test]
async fn a_model_file_cut_short_on_disk_is_not_taken_as_the_model() {
    let folder = copy_of_model().await;
    let weights = folder.path().join("model.safetensors");
    let bytes = fs::read(&weights).unwrap();
    fs::write(&weights, &bytes[..1_000_000]).unwrap();

    let fetched = ensure_model(folder.path(), &NOWHERE).await;
    let loaded = fetched
        .clone()
        .and_then(|()| Embedder::load(folder.path(), &NOWHERE).map(|_| ()));

    // ensure_model says the model is here; the load then fails, and will fail
    // the same way on every call after, since the file is never looked at again.
    assert!(
        fetched.is_err() || loaded.is_ok(),
        "ensure_model accepted a 1 MB model.safetensors (pinned at {} bytes); \
         load then failed: {loaded:?}",
        MODEL.files[2].bytes
    );
}

#[tokio::test]
async fn weights_that_are_not_the_pinned_file_are_never_used_to_embed() {
    let folder = copy_of_model().await;
    let genuine = Embedder::load(folder.path(), &MODEL).unwrap();
    let text = vec!["Larkspur Payroll pays Mara Quill every other Friday.".to_string()];
    let expected = genuine.embed(&text, Purpose::Passage).unwrap();

    // A megabyte of zeros in the middle of the weights, the size unchanged:
    // what a second writer's truncation of the shared `.part` leaves behind.
    let mut weights = fs::OpenOptions::new()
        .write(true)
        .open(folder.path().join("model.safetensors"))
        .unwrap();
    weights.seek(SeekFrom::Start(70_000_000)).unwrap();
    weights.write_all(&vec![0u8; 1_000_000]).unwrap();
    drop(weights);

    let outcome = match ensure_model(folder.path(), &NOWHERE).await {
        Err(refused) => Err(refused),
        Ok(()) => Embedder::load(folder.path(), &NOWHERE)
            .and_then(|embedder| embedder.embed(&text, Purpose::Passage)),
    };

    let drift = outcome.as_ref().map(|vectors| {
        1.0 - vectors[0]
            .iter()
            .zip(&expected[0])
            .map(|(a, b)| a * b)
            .sum::<f32>()
    });
    assert!(
        outcome.is_err(),
        "weights that fail their pinned SHA-256 were loaded and embedded without a word; \
         1 - cosine to the real vector = {drift:?}"
    );
}

#[tokio::test]
async fn two_different_texts_are_not_given_the_same_vector() {
    let embedder = Embedder::load(&cached_model().await, &MODEL).unwrap();
    // Two runs of more than 100 letters with no space or punctuation: the
    // tokenizer reads each as one unknown word. Scripts written without
    // spaces (Thai, Khmer, Lao) and pasted data blobs arrive like this.
    let first = "ก".repeat(101);
    let second = "ข".repeat(101);

    let outcome = embedder.embed(&[first.clone(), second.clone()], Purpose::Passage);

    // Refusing the text (so the chunker can split it) or reading it are both
    // fine; handing back one shared [UNK] vector for both is not.
    let same = matches!(&outcome, Ok(vectors) if vectors[0] == vectors[1]);
    assert!(
        !same,
        "two different texts embed to the identical vector; each is read as {} tokens",
        embedder.token_count(&first, Purpose::Passage).unwrap()
    );
}
