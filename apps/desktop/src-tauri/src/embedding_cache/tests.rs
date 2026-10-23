use super::*;

const GENERATION: &str = "chunks-1";

fn note(path: &str, digest: &str) -> CachedNote {
    CachedNote {
        path: path.into(),
        digest: digest.into(),
        title: format!("Title of {path}"),
    }
}

fn block(ordinal: i64, digest: &str, vector: Option<Vec<f32>>) -> BlockToPut {
    BlockToPut {
        block: CachedBlock {
            ordinal,
            digest: digest.into(),
            anchor: (ordinal == 0).then(|| "k3x9a1".to_string()),
            heading: Some("Payroll".into()),
            excerpt: format!("Block {ordinal}"),
        },
        vector,
    }
}

fn put(path: &str, digest: &str, blocks: Vec<BlockToPut>) -> NoteToPut {
    NoteToPut {
        note: note(path, digest),
        blocks,
    }
}

/// The load's bytes, split back into its header and its vectors.
fn read_back(bytes: &[u8]) -> (serde_json::Value, Vec<f32>) {
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let header = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    let vectors = bytes[4 + length..]
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect();
    (header, vectors)
}

fn opened(root: &Path) -> EmbeddingCacheState {
    let state = EmbeddingCacheState::default();
    assert!(state.open(root, GENERATION).unwrap().fresh);
    state
}

fn loaded(state: &EmbeddingCacheState) -> (serde_json::Value, Vec<f32>) {
    read_back(&state.with(None, |connection| load(connection)).unwrap())
}

#[test]
fn puts_and_loads_a_note_s_blocks_with_their_vectors_in_order() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    state
        .with(None, |connection| {
            put_notes(
                connection,
                &[
                    put("b.md", "nb", vec![block(0, "d2", Some(vec![0.5, -0.5]))]),
                    put(
                        "a.md",
                        "na",
                        vec![
                            block(1, "d1", Some(vec![0.0, 1.0])),
                            block(0, "d0", Some(vec![1.0, 0.0])),
                        ],
                    ),
                ],
            )
        })
        .unwrap();
    let (header, vectors) = loaded(&state);
    assert_eq!(
        header["notes"][0],
        serde_json::json!({"path": "a.md", "digest": "na", "title": "Title of a.md"})
    );
    let order: Vec<(String, i64)> = header["blocks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["path"].as_str().unwrap().into(),
                row["ordinal"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        order,
        vec![("a.md".into(), 0), ("a.md".into(), 1), ("b.md".into(), 0)]
    );
    assert_eq!(header["blocks"][0]["anchor"], "k3x9a1");
    assert_eq!(header["blocks"][1]["anchor"], serde_json::Value::Null);
    assert_eq!(header["blocks"][0]["heading"], "Payroll");
    assert_eq!(header["blocks"][0]["embedded"], true);
    assert_eq!(vectors, vec![1.0, 0.0, 0.0, 1.0, 0.5, -0.5]);
}

#[test]
fn reads_back_the_words_of_the_blocks_asked_for_in_order_and_none_for_a_block_it_lacks() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    state
        .with(None, |connection| {
            put_notes(
                connection,
                &[put(
                    "a.md",
                    "1",
                    vec![block(0, "d0", None), block(1, "d1", None)],
                )],
            )
        })
        .unwrap();
    let keys = [("a.md", 1), ("gone.md", 0), ("a.md", 0)].map(|(path, ordinal)| BlockKey {
        path: path.into(),
        ordinal,
    });
    let words = state
        .with(None, |connection| excerpts(connection, &keys))
        .unwrap();
    assert_eq!(
        words,
        vec!["Block 1".to_string(), String::new(), "Block 0".to_string()]
    );
}

#[test]
fn the_load_carries_no_block_s_words() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    state
        .with(None, |connection| {
            put_notes(connection, &[put("a.md", "1", vec![block(0, "d0", None)])])
        })
        .unwrap();
    assert!(loaded(&state).0["blocks"][0].get("excerpt").is_none());
}

#[test]
fn a_block_the_model_would_not_read_is_kept_without_a_vector() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    state
        .with(None, |connection| {
            put_notes(
                connection,
                &[put(
                    "a.md",
                    "na",
                    vec![block(0, "d0", None), block(1, "d1", Some(vec![1.0]))],
                )],
            )
        })
        .unwrap();
    let (header, vectors) = loaded(&state);
    assert_eq!(header["blocks"][0]["embedded"], false);
    assert_eq!(header["blocks"][1]["embedded"], true);
    assert_eq!(vectors, vec![1.0]);
}

#[test]
fn putting_a_note_again_replaces_every_block_it_had() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    let blocks = |count: i64| {
        (0..count)
            .map(|at| block(at, "d", Some(vec![1.0])))
            .collect()
    };
    state
        .with(None, |connection| {
            put_notes(connection, &[put("a.md", "1", blocks(3))])
        })
        .unwrap();
    state
        .with(None, |connection| {
            put_notes(connection, &[put("a.md", "2", blocks(1))])
        })
        .unwrap();
    let (header, _) = loaded(&state);
    assert_eq!(header["blocks"].as_array().unwrap().len(), 1);
    assert_eq!(header["notes"][0]["digest"], "2");
}

#[test]
fn removing_a_note_takes_its_blocks_and_its_row() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    state
        .with(None, |connection| {
            put_notes(
                connection,
                &[
                    put("a.md", "1", vec![block(0, "d", Some(vec![1.0]))]),
                    put("b.md", "1", vec![]),
                ],
            )
        })
        .unwrap();
    state
        .with(None, |connection| {
            remove_notes(connection, &["a.md".into()])
        })
        .unwrap();
    let (header, vectors) = loaded(&state);
    assert_eq!(header["notes"].as_array().unwrap().len(), 1);
    assert_eq!(header["blocks"], serde_json::json!([]));
    assert!(vectors.is_empty());
}

#[test]
fn a_write_that_fails_part_way_leaves_every_note_as_it_was() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    state
        .with(None, |connection| {
            put_notes(
                connection,
                &[put("a.md", "1", vec![block(0, "old", Some(vec![1.0]))])],
            )
        })
        .unwrap();
    // Two blocks at one ordinal break the key on the second note: the first must not land either.
    let failed = state.with(None, |connection| {
        put_notes(
            connection,
            &[
                put("a.md", "2", vec![block(0, "new", Some(vec![2.0]))]),
                put("b.md", "1", vec![block(0, "x", None), block(0, "y", None)]),
            ],
        )
    });
    assert!(failed.is_err());
    let (header, vectors) = loaded(&state);
    assert_eq!(header["notes"].as_array().unwrap().len(), 1);
    assert_eq!(header["notes"][0]["digest"], "1");
    assert_eq!(vectors, vec![1.0]);
}

#[test]
fn a_cache_reopened_after_a_quit_holds_what_was_written_and_is_not_fresh() {
    let vault = tempfile::tempdir().unwrap();
    {
        let state = opened(vault.path());
        state
            .with(None, |connection| {
                put_notes(
                    connection,
                    &[put("a.md", "1", vec![block(0, "d", Some(vec![0.25]))])],
                )
            })
            .unwrap();
    }
    let state = EmbeddingCacheState::default();
    assert!(!state.open(vault.path(), GENERATION).unwrap().fresh);
    let (header, vectors) = loaded(&state);
    assert_eq!(header["notes"][0]["path"], "a.md");
    assert_eq!(vectors, vec![0.25]);
}

#[test]
fn another_generation_throws_the_cache_away() {
    let vault = tempfile::tempdir().unwrap();
    {
        let state = opened(vault.path());
        state
            .with(None, |connection| {
                put_notes(connection, &[put("a.md", "1", vec![])])
            })
            .unwrap();
    }
    let state = EmbeddingCacheState::default();
    assert!(state.open(vault.path(), "chunks-2").unwrap().fresh);
    let (header, _) = loaded(&state);
    assert_eq!(header["notes"], serde_json::json!([]));
}

#[test]
fn the_generation_names_the_model_so_a_new_model_rebuilds() {
    assert_eq!(
        full_generation("chunks-1"),
        format!("chunks-1+snowflake-arctic-embed-xs@{}", MODEL.revision)
    );
}

#[test]
fn a_file_that_is_not_a_database_is_made_again_rather_than_failing() {
    let vault = tempfile::tempdir().unwrap();
    let path = database_path(vault.path()).unwrap();
    fs::write(&path, b"not a database, cut short").unwrap();
    let state = EmbeddingCacheState::default();
    assert!(state.open(vault.path(), GENERATION).unwrap().fresh);
    assert_eq!(loaded(&state).0["notes"], serde_json::json!([]));
}

#[test]
fn an_older_shape_is_thrown_away() {
    let vault = tempfile::tempdir().unwrap();
    let path = database_path(vault.path()).unwrap();
    Connection::open(&path)
        .unwrap()
        .execute_batch("CREATE TABLE old (x); PRAGMA user_version = 0;")
        .unwrap();
    let state = EmbeddingCacheState::default();
    assert!(state.open(vault.path(), GENERATION).unwrap().fresh);
}

#[test]
fn clearing_empties_the_cache_and_keeps_its_generation() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    state
        .with(None, |connection| {
            put_notes(connection, &[put("a.md", "1", vec![])])
        })
        .unwrap();
    state.clear().unwrap();
    assert_eq!(loaded(&state).0["notes"], serde_json::json!([]));
    drop(state);
    // Cleared, it is still this generation's: opened again it is not fresh.
    assert!(
        !EmbeddingCacheState::default()
            .open(vault.path(), GENERATION)
            .unwrap()
            .fresh
    );
}

#[test]
fn a_write_meant_for_another_vault_is_refused() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    let refused = state.with(Some("/somewhere/else"), |connection| {
        put_notes(connection, &[put("a.md", "1", vec![])])
    });
    assert_eq!(
        refused.unwrap_err(),
        "another vault was opened before this could be cached"
    );
    let root = vault.path().to_str().unwrap();
    assert!(state
        .with(Some(root), |connection| put_notes(connection, &[]))
        .is_ok());
}

#[test]
fn nothing_is_read_or_written_before_the_cache_is_opened() {
    let state = EmbeddingCacheState::default();
    assert!(state.with(None, |connection| load(connection)).is_err());
    assert!(state.clear().is_err());
}

#[test]
fn the_cache_lives_in_the_vault_s_cache_folder_beside_the_index() {
    let vault = tempfile::tempdir().unwrap();
    let _state = opened(vault.path());
    assert!(vault
        .path()
        .join(".atlas-cache")
        .join("embeddings.sqlite")
        .exists());
}

// Attack tests for PR #538: a damaged cache is discarded and built again, never trusted.

#[test]
fn attack_538_a_damaged_database_is_made_again_rather_than_failing_every_launch() {
    let vault = tempfile::tempdir().unwrap();
    {
        let state = opened(vault.path());
        state
            .with(None, |connection| {
                put_notes(
                    connection,
                    &[put("a.md", "1", vec![block(0, "d", Some(vec![0.25]))])],
                )
            })
            .unwrap();
    }
    // A sync tool or a crash tore the file: its 100-byte header is whole, every page after is not.
    let path = database_path(vault.path()).unwrap();
    let mut bytes = fs::read(&path).unwrap();
    for byte in bytes.iter_mut().skip(100) {
        *byte = 0xA5;
    }
    fs::write(&path, &bytes).unwrap();
    let state = EmbeddingCacheState::default();
    let opened = state.open(vault.path(), GENERATION);
    assert!(opened.is_ok(), "open failed: {opened:?}");
    assert!(opened.unwrap().fresh);
    assert_eq!(loaded(&state).0["notes"], serde_json::json!([]));
}

#[test]
fn attack_538_a_load_never_hands_back_vectors_of_different_lengths_as_if_one() {
    let vault = tempfile::tempdir().unwrap();
    let state = opened(vault.path());
    state
        .with(None, |connection| {
            put_notes(
                connection,
                &[put(
                    "a.md",
                    "1",
                    vec![
                        block(0, "d0", Some(vec![1.0])),
                        block(1, "d1", Some(vec![0.0, 0.0, 1.0])),
                    ],
                )],
            )
        })
        .unwrap();
    // Read as the window reads it, 4 floats over 2 vectors are two of 2: [1, 0] and [0, 1], neither stored.
    let result = state.with(None, |connection| load(connection));
    assert!(
        result.is_err(),
        "the load handed back vectors that cannot be split back into what was stored"
    );
}
