//! Fetching against a server on this machine that answers what each test
//! needs, so every failure a real fetch can meet is met here without the
//! network.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tempfile::{tempdir, NamedTempFile};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::super::model::{ModelFile, ModelSpec, Pooling};
use super::{ensure_model, ensure_model_from, put_in_place};

// SHA-256 of the three bytes "abc".
static ABC: ModelFile = ModelFile {
    name: "model.safetensors",
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    bytes: 3,
};

static TINY: ModelSpec = ModelSpec {
    folder: "tiny",
    repository: "atlas-test/tiny",
    revision: "0123456789abcdef",
    files: std::slice::from_ref(&ABC),
    pooling: Pooling::Cls,
    query_prefix: "",
    max_tokens: 8,
};

/// A server that answers every request with `status` and `body`, and counts
/// the requests. Its address is the fetch's source.
async fn serve(status: u16, body: &'static [u8]) -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let source = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&requests);
    tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            counted.fetch_add(1, Ordering::SeqCst);
            let mut head = Vec::new();
            let mut byte = [0u8; 1];
            while !head.ends_with(b"\r\n\r\n") && stream.read(&mut byte).await.unwrap() == 1 {
                head.push(byte[0]);
            }
            let answer = format!(
                "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(answer.as_bytes()).await.unwrap();
            stream.write_all(body).await.unwrap();
        }
    });
    (source, requests)
}

/// A source nothing listens on: its port was taken and let go.
async fn unreachable_source() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let source = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    source
}

fn names_in(folder: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[tokio::test]
async fn the_pinned_file_is_fetched_into_place_and_nothing_else_is_left() {
    let folder = tempdir().unwrap();
    let (source, _) = serve(200, b"abc").await;

    ensure_model_from(&source, folder.path(), &TINY)
        .await
        .unwrap();

    assert_eq!(names_in(folder.path()), vec!["model.safetensors"]);
    assert_eq!(
        fs::read(folder.path().join("model.safetensors")).unwrap(),
        b"abc"
    );
}

#[tokio::test]
async fn bytes_that_are_not_the_pinned_file_are_never_put_in_place() {
    let folder = tempdir().unwrap();
    let (source, _) = serve(200, b"abd").await;

    let error = ensure_model_from(&source, folder.path(), &TINY)
        .await
        .unwrap_err();

    assert_eq!(
        error,
        "the embedding model's model.safetensors is not the file it was pinned at"
    );
    assert!(
        names_in(folder.path()).is_empty(),
        "{:?}",
        names_in(folder.path())
    );
}

#[tokio::test]
async fn a_file_larger_than_pinned_is_refused_and_not_kept() {
    let folder = tempdir().unwrap();
    let (source, _) = serve(200, b"abcd").await;

    let error = ensure_model_from(&source, folder.path(), &TINY)
        .await
        .unwrap_err();

    assert!(error.contains("is larger than the 3 bytes"), "{error}");
    assert!(names_in(folder.path()).is_empty());
}

#[tokio::test]
async fn a_server_that_does_not_answer_success_is_refused() {
    let folder = tempdir().unwrap();
    let (source, _) = serve(404, b"not here").await;

    let error = ensure_model_from(&source, folder.path(), &TINY)
        .await
        .unwrap_err();

    assert!(error.contains("answered 404"), "{error}");
    assert!(names_in(folder.path()).is_empty());
}

#[tokio::test]
async fn a_source_that_cannot_be_reached_asks_whether_this_mac_is_online() {
    let folder = tempdir().unwrap();

    let error = ensure_model_from(&unreachable_source().await, folder.path(), &TINY)
        .await
        .unwrap_err();

    assert!(
        error.starts_with(
            "cannot fetch the embedding model's model.safetensors (is this Mac online?)"
        ),
        "{error}"
    );
}

// Changed expectation (review of P32-01): a file already here used to be
// trusted for being there. It is now read back and checked, so this test
// holds the pinned bytes; `a_file_here_that_is_not_pinned_...` holds others.
#[tokio::test]
async fn a_pinned_file_already_here_is_checked_and_not_fetched_again() {
    let folder = tempdir().unwrap();
    fs::write(folder.path().join("model.safetensors"), b"abc").unwrap();
    let (source, requests) = serve(200, b"abc").await;

    ensure_model_from(&source, folder.path(), &TINY)
        .await
        .unwrap();

    assert_eq!(requests.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_file_here_that_is_not_pinned_is_replaced_by_the_pinned_one() {
    let folder = tempdir().unwrap();
    fs::write(folder.path().join("model.safetensors"), b"abd").unwrap();
    let (source, requests) = serve(200, b"abc").await;

    ensure_model_from(&source, folder.path(), &TINY)
        .await
        .unwrap();

    assert_eq!(requests.load(Ordering::SeqCst), 1);
    assert_eq!(
        fs::read(folder.path().join("model.safetensors")).unwrap(),
        b"abc"
    );
}

#[tokio::test]
async fn a_file_here_cut_short_is_removed_and_said_so_when_it_cannot_be_fetched() {
    let folder = tempdir().unwrap();
    fs::write(folder.path().join("model.safetensors"), b"ab").unwrap();

    let error = ensure_model_from(&unreachable_source().await, folder.path(), &TINY)
        .await
        .unwrap_err();

    assert!(
        error.starts_with(
            "the embedding model's model.safetensors on this Mac was not the pinned file, \
             so it was removed; fetching it again failed: cannot fetch"
        ),
        "{error}"
    );
    assert!(names_in(folder.path()).is_empty());
}

#[tokio::test]
async fn a_file_another_fetch_put_in_place_first_is_kept_when_it_is_the_pinned_file() {
    let folder = tempdir().unwrap();
    let path = folder.path().join("model.safetensors");
    fs::write(&path, b"abc").unwrap();
    let staged = NamedTempFile::new_in(folder.path()).unwrap();
    fs::write(staged.path(), b"abc").unwrap();

    put_in_place(staged, &path, &ABC).await.unwrap();

    assert_eq!(names_in(folder.path()), vec!["model.safetensors"]);
}

#[tokio::test]
async fn a_file_another_fetch_put_in_place_first_is_never_written_over() {
    let folder = tempdir().unwrap();
    let path = folder.path().join("model.safetensors");
    fs::write(&path, b"abd").unwrap();
    let staged = NamedTempFile::new_in(folder.path()).unwrap();
    fs::write(staged.path(), b"abc").unwrap();

    let error = put_in_place(staged, &path, &ABC).await.unwrap_err();

    assert!(error.contains("put in place by another fetch"), "{error}");
    assert_eq!(fs::read(&path).unwrap(), b"abd");
}

#[tokio::test]
async fn a_model_folder_that_cannot_be_made_is_refused() {
    let error = ensure_model(Path::new("/dev/null/models"), &TINY)
        .await
        .unwrap_err();

    assert!(
        error.starts_with("cannot make the embedding model's folder"),
        "{error}"
    );
}
