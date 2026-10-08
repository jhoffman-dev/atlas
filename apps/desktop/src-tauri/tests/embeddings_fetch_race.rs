//! Two fetches of the same model file at once, as two Atlas processes on one
//! Mac (they share `~/Library/Application Support/dev.jhoffman.atlas`, and the
//! in-process lock does not reach across processes) make on a first use.
//!
//! Needs the network: the 711 KB tokenizer is fetched through a local CONNECT
//! proxy that paces each tunnel, so the interleaving is the same every run.
//! The other two files are copied from the model the `embeddings` test fetched.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use atlas_lib::embeddings::fetch::ensure_model;
use atlas_lib::embeddings::{model_folder, MODEL};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

/// One proxied connection: bytes from the server reach the client only up to
/// its budget, and cutting it drops both ends.
struct Tunnel {
    budget: watch::Sender<u64>,
    forwarded: AtomicU64,
    cut: watch::Sender<bool>,
}

type Tunnels = Arc<Mutex<Vec<Arc<Tunnel>>>>;

async fn serve(listener: TcpListener, tunnels: Tunnels) {
    loop {
        let (client, _) = listener.accept().await.unwrap();
        let tunnel = Arc::new(Tunnel {
            budget: watch::channel(0).0,
            forwarded: AtomicU64::new(0),
            cut: watch::channel(false).0,
        });
        tunnels.lock().unwrap().push(Arc::clone(&tunnel));
        tokio::spawn(relay(client, tunnel));
    }
}

async fn relay(mut client: TcpStream, tunnel: Arc<Tunnel>) {
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        let mut byte = [0u8; 1];
        if client.read(&mut byte).await.unwrap_or(0) == 0 {
            return;
        }
        head.push(byte[0]);
    }
    let head = String::from_utf8_lossy(&head);
    let target = head.split_whitespace().nth(1).unwrap().to_string();
    let server = TcpStream::connect(&target).await.unwrap();
    client
        .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
        .await
        .unwrap();
    let (mut from_client, mut to_client) = client.into_split();
    let (mut from_server, mut to_server) = server.into_split();
    let mut cut = tunnel.cut.subscribe();
    let upstream = async {
        let _ = tokio::io::copy(&mut from_client, &mut to_server).await;
    };
    let downstream = async {
        let mut budget = tunnel.budget.subscribe();
        let mut buffer = vec![0u8; 16 * 1024];
        loop {
            let read = match from_server.read(&mut buffer).await {
                Ok(0) | Err(_) => return,
                Ok(read) => read,
            };
            let mut sent = 0;
            while sent < read {
                let allowed = *budget.borrow_and_update();
                let done = tunnel.forwarded.load(Ordering::SeqCst);
                if allowed <= done {
                    if budget.changed().await.is_err() {
                        return;
                    }
                    continue;
                }
                let take = (read - sent).min((allowed - done) as usize);
                if to_client
                    .write_all(&buffer[sent..sent + take])
                    .await
                    .is_err()
                {
                    return;
                }
                sent += take;
                tunnel.forwarded.fetch_add(take as u64, Ordering::SeqCst);
            }
        }
    };
    tokio::select! {
        _ = upstream => {}
        _ = downstream => {}
        _ = cut.wait_for(|cut| *cut) => {}
    }
}

async fn until(what: &str, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(120);
    while !condition() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        tokio::task::yield_now().await;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

fn length(path: &Path) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

fn sha256(path: &Path) -> String {
    Sha256::digest(std::fs::read(path).unwrap())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn zeros(path: &Path) -> usize {
    std::fs::read(path)
        .unwrap()
        .iter()
        .filter(|&&byte| byte == 0)
        .count()
}

fn tunnel(tunnels: &Tunnels, index: usize) -> Arc<Tunnel> {
    Arc::clone(&tunnels.lock().unwrap()[index])
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_file_put_in_place_is_the_file_that_was_checked_when_two_fetch_it_at_once() {
    let cached = model_folder(Path::new(env!("CARGO_TARGET_TMPDIR")), &MODEL);
    ensure_model(&cached, &MODEL)
        .await
        .expect("the model is fetched (the first run needs the network)");
    let home = tempfile::tempdir_in(env!("CARGO_TARGET_TMPDIR")).unwrap();
    let folder: PathBuf = home.path().to_path_buf();
    for name in ["config.json", "model.safetensors"] {
        std::fs::copy(cached.join(name), folder.join(name)).unwrap();
    }

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let tunnels: Tunnels = Arc::default();
    tokio::spawn(serve(listener, Arc::clone(&tunnels)));
    // This binary holds this one test, so nothing else reads the variables.
    std::env::set_var("HTTPS_PROXY", format!("http://{address}"));
    std::env::remove_var("NO_PROXY");
    std::env::remove_var("no_proxy");

    let staged = folder.join("tokenizer.json.part");

    // The first process gets about half the tokenizer onto disk, then stalls.
    let first = tokio::spawn({
        let folder = folder.clone();
        async move { ensure_model(&folder, &MODEL).await }
    });
    until("the first tunnel", || tunnels.lock().unwrap().len() == 1).await;
    tunnel(&tunnels, 0).budget.send_replace(360_000);
    until("the first fetch to write 300 KB", || {
        length(&staged) >= 300_000
    })
    .await;

    // The second process starts the same file, truncating the shared `.part`,
    // writes the head of it, and loses its connection.
    let second = tokio::spawn({
        let folder = folder.clone();
        async move { ensure_model(&folder, &MODEL).await }
    });
    until("the second tunnel", || tunnels.lock().unwrap().len() == 2).await;
    tunnel(&tunnels, 1).budget.send_replace(100_000);
    until("the second fetch to truncate and rewrite the head", || {
        let written = length(&staged);
        (60_000..300_000).contains(&written)
    })
    .await;
    tunnel(&tunnels, 1).cut.send_replace(true);
    let second = second.await.unwrap();
    assert!(second.is_err(), "the second fetch lost its connection");

    // The first process carries on to the end; its stream checks out.
    tunnel(&tunnels, 0).budget.send_replace(u64::MAX);
    first.await.unwrap().expect("the first fetch finishes");

    let pinned = &MODEL.files[1];
    assert_eq!(pinned.name, "tokenizer.json");
    assert_eq!(
        sha256(&folder.join("tokenizer.json")),
        pinned.sha256,
        "tokenizer.json was put in place, under its own name, with bytes that were never \
         checked: {} bytes on disk, {} of them zero (the hole the second fetch's \
         truncation left)",
        length(&folder.join("tokenizer.json")),
        zeros(&folder.join("tokenizer.json"))
    );
}
