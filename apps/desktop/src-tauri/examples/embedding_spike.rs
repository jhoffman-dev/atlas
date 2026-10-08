//! The embedding spike (ADR-0031): one candidate model measured against a
//! vault and a set of questions, using the same loading and embedding code the
//! app runs.
//!
//! ```sh
//! cargo run --release --example embedding_spike -- \
//!   <model> <models-folder> <vault-folder> <questions.jsonl>
//! ```
//!
//! `<model>` is one of the candidates below (`arctic-xs` is the one the app
//! runs); its files are fetched into `<models-folder>` the first time. Each line of the questions file is
//! `{"q": "...", "relevant": [{"note": "<vault-relative path>", "contains": "..."}]}`:
//! a block counts as an answer when it is in that note and holds that text.
//! Run one model per process, so the memory numbers are that model's alone.
//!
//! It prints aggregate numbers only — never a note, a block or a question —
//! so its output can go into an ADR about a private vault.
//!
//! The blocks are an approximation of the app's: the body after the
//! frontmatter, cut at blank lines and at the start of each list item, with
//! dotted folders skipped. A block longer than the model reads is halved at a
//! space until each piece fits, and a piece the model refuses as unreadable is
//! left out; how the app chunks is P32-02's to decide.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use atlas_lib::embeddings::fetch::ensure_model;
use atlas_lib::embeddings::model::{Embedder, ModelFile, ModelSpec, Pooling, Purpose};
use atlas_lib::embeddings::refusal::RefusalReason;
use atlas_lib::embeddings::MODEL;
use serde_json::{json, Value};

const MINILM: ModelSpec = ModelSpec {
    folder: "all-MiniLM-L6-v2",
    repository: "sentence-transformers/all-MiniLM-L6-v2",
    revision: "1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
    files: &[
        ModelFile {
            name: "config.json",
            sha256: "953f9c0d463486b10a6871cc2fd59f223b2c70184f49815e7efbcab5d8908b41",
            bytes: 612,
        },
        ModelFile {
            name: "tokenizer.json",
            sha256: "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037",
            bytes: 466_247,
        },
        ModelFile {
            name: "model.safetensors",
            sha256: "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db",
            bytes: 90_868_376,
        },
    ],
    pooling: Pooling::Mean,
    query_prefix: "",
    max_tokens: 256,
};

const BGE_SMALL: ModelSpec = ModelSpec {
    folder: "bge-small-en-v1.5",
    repository: "BAAI/bge-small-en-v1.5",
    revision: "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
    files: &[
        ModelFile {
            name: "config.json",
            sha256: "094f8e891b932f2000c92cfc663bac4c62069f5d8af5b5278c4306aef3084750",
            bytes: 743,
        },
        ModelFile {
            name: "tokenizer.json",
            sha256: "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
            bytes: 711_396,
        },
        ModelFile {
            name: "model.safetensors",
            sha256: "3c9f31665447c8911517620762200d2245a2518d6e7208acc78cd9db317e21ad",
            bytes: 133_466_304,
        },
    ],
    pooling: Pooling::Cls,
    query_prefix: "Represent this sentence for searching relevant passages: ",
    max_tokens: 512,
};

const CANDIDATES: [(&str, &ModelSpec); 3] = [
    ("minilm", &MINILM),
    ("bge-small", &BGE_SMALL),
    ("arctic-xs", &MODEL),
];

/// How many blocks go to the model per call, as the cache build would send them.
const CALL_SIZE: usize = 64;

struct Block {
    note: String,
    text: String,
}

struct Question {
    text: String,
    relevant: Vec<(String, String)>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [name, models, vault, questions] = args.as_slice() else {
        return Err(
            "usage: embedding_spike <model> <models-folder> <vault> <questions.jsonl>".into(),
        );
    };
    let spec = CANDIDATES
        .iter()
        .find(|(candidate, _)| candidate == name)
        .map(|(_, spec)| *spec)
        .ok_or_else(|| format!("unknown model {name}; one of minilm, bge-small, arctic-xs"))?;
    let folder = PathBuf::from(models).join(spec.folder);
    let started = Instant::now();
    ensure_model(&folder, spec).await?;
    // With the files already here, this is the check of their digests.
    let check_ms = started.elapsed().as_secs_f64() * 1000.0;

    let blocks = vault_blocks(Path::new(vault))?;
    let questions = read_questions(Path::new(questions))?;
    check_answerable(&questions, &blocks)?;
    let mut report = measure(&folder, spec, &blocks, &questions)?;
    report["check_ms"] = json!(check_ms);
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?
    );
    Ok(())
}

fn measure(
    folder: &Path,
    spec: &ModelSpec,
    blocks: &[Block],
    questions: &[Question],
) -> Result<Value, String> {
    let started = Instant::now();
    let embedder = Embedder::load(folder, spec)?;
    let load_ms = started.elapsed().as_secs_f64() * 1000.0;
    let peak_after_load = peak_memory_mb();

    let Fitted {
        pieces,
        over_limit,
        unreadable,
    } = fitted_pieces(&embedder, blocks);
    let texts: Vec<String> = pieces.iter().map(|(_, text)| text.clone()).collect();
    let started = Instant::now();
    let mut vectors = Vec::with_capacity(texts.len());
    for call in texts.chunks(CALL_SIZE) {
        vectors.extend(embedder.embed(call, Purpose::Passage)?);
    }
    let embed_ms = started.elapsed().as_secs_f64() * 1000.0;

    let batch_ms = median_ms(5, || {
        embedder.embed(&texts[..32.min(texts.len())], Purpose::Passage)
    })?;
    let query_ms = median_ms(5, || {
        embedder.embed(&[questions[0].text.clone()], Purpose::Query)
    })?;
    let ranks = question_ranks(&embedder, questions, blocks, &pieces, &vectors)?;

    Ok(json!({
        "model": spec.repository,
        "download_mb": spec.files.iter().map(|file| file.bytes).sum::<u64>() as f64 / 1e6,
        "vault": {
            "notes_with_text": blocks.iter().map(|b| &b.note).collect::<std::collections::BTreeSet<_>>().len(),
            "blocks": blocks.len(),
            "bytes": blocks.iter().map(|b| b.text.len()).sum::<usize>(),
            "blocks_over_token_limit": over_limit,
            "pieces_unreadable": unreadable,
            "pieces_embedded": pieces.len(),
        },
        "load_ms": load_ms,
        "embed_all_ms": embed_ms,
        "ms_per_block": embed_ms / pieces.len() as f64,
        "batch_of_32_ms_median": batch_ms,
        "one_query_ms_median": query_ms,
        "peak_memory_mb_after_load": peak_after_load,
        "peak_memory_mb_after_embedding": peak_memory_mb(),
        "quality": quality(&ranks),
    }))
}

/// What fitting the vault's blocks to the model came to.
struct Fitted {
    /// Each piece the model can read, with the index of its block.
    pieces: Vec<(usize, String)>,
    /// Blocks longer than the model reads, split into pieces.
    over_limit: usize,
    /// Pieces the model refuses as unreadable, left out.
    unreadable: usize,
}

/// Each block as one or more pieces the model can read.
fn fitted_pieces(embedder: &Embedder, blocks: &[Block]) -> Fitted {
    let mut fitted = Fitted {
        pieces: Vec::new(),
        over_limit: 0,
        unreadable: 0,
    };
    for (index, block) in blocks.iter().enumerate() {
        let mut pending = vec![block.text.clone()];
        let mut split = false;
        while let Some(text) = pending.pop() {
            match embedder.read(std::slice::from_ref(&text), Purpose::Passage) {
                Ok(_) => fitted.pieces.push((index, text)),
                Err(failure) if failure.reason == Some(RefusalReason::TooLong) => {
                    split = true;
                    let (head, tail) = halves(&text);
                    pending.push(tail);
                    pending.push(head);
                }
                Err(_) => fitted.unreadable += 1,
            }
        }
        fitted.over_limit += usize::from(split);
    }
    fitted
}

fn halves(text: &str) -> (String, String) {
    let middle = text.len() / 2;
    let cut = text[..middle]
        .rfind(char::is_whitespace)
        .filter(|&at| at > 0)
        .unwrap_or_else(|| {
            (middle..=text.len())
                .find(|&at| text.is_char_boundary(at))
                .unwrap_or(text.len())
        });
    (text[..cut].to_string(), text[cut..].to_string())
}

/// The rank (1-based) of the first answering block for each question, if any
/// is in the top ten.
fn question_ranks(
    embedder: &Embedder,
    questions: &[Question],
    blocks: &[Block],
    pieces: &[(usize, String)],
    vectors: &[Vec<f32>],
) -> Result<Vec<(Option<usize>, bool)>, String> {
    let texts: Vec<String> = questions.iter().map(|q| q.text.clone()).collect();
    let asked = embedder.embed(&texts, Purpose::Query)?;
    Ok(questions
        .iter()
        .zip(asked)
        .map(|(question, query)| {
            let mut scored: Vec<(f32, usize)> = vectors
                .iter()
                .enumerate()
                .map(|(i, v)| (v.iter().zip(&query).map(|(a, b)| a * b).sum(), pieces[i].0))
                .collect();
            scored.sort_by(|a, b| b.0.total_cmp(&a.0));
            let answers = |block: usize| {
                question.relevant.iter().any(|(note, contains)| {
                    blocks[block].note == *note && blocks[block].text.contains(contains.as_str())
                })
            };
            let rank = scored
                .iter()
                .take(10)
                .position(|&(_, block)| answers(block))
                .map(|p| p + 1);
            let note_in_top5 = scored.iter().take(5).any(|&(_, block)| {
                question
                    .relevant
                    .iter()
                    .any(|(note, _)| blocks[block].note == *note)
            });
            (rank, note_in_top5)
        })
        .collect())
}

/// Refuses a question no block answers: it could only ever count as a miss.
fn check_answerable(questions: &[Question], blocks: &[Block]) -> Result<(), String> {
    let unanswerable = questions
        .iter()
        .filter(|question| {
            !blocks.iter().any(|block| {
                question.relevant.iter().any(|(note, contains)| {
                    block.note == *note && block.text.contains(contains.as_str())
                })
            })
        })
        .count();
    match unanswerable {
        0 => Ok(()),
        count => Err(format!("{count} questions have no answering block")),
    }
}

fn quality(ranks: &[(Option<usize>, bool)]) -> Value {
    let count = ranks.len() as f64;
    let recall = |k: usize| {
        ranks
            .iter()
            .filter(|(r, _)| r.is_some_and(|r| r <= k))
            .count() as f64
            / count
    };
    let mrr = ranks
        .iter()
        .map(|(r, _)| r.map_or(0.0, |r| 1.0 / r as f64))
        .sum::<f64>()
        / count;
    json!({
        "questions": ranks.len(),
        "block_recall_at_1": recall(1),
        "block_recall_at_5": recall(5),
        "block_recall_at_10": recall(10),
        "block_mrr_at_10": mrr,
        "note_recall_at_5": ranks.iter().filter(|(_, n)| *n).count() as f64 / count,
    })
}

fn median_ms<T>(runs: usize, mut work: impl FnMut() -> Result<T, String>) -> Result<f64, String> {
    let mut times = Vec::with_capacity(runs);
    for _ in 0..runs {
        let started = Instant::now();
        work()?;
        times.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    Ok(times[runs / 2])
}

/// The process's peak resident memory so far, in megabytes.
fn peak_memory_mb() -> f64 {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: getrusage writes a whole rusage into the pointer it is given,
    // which points at one; it is read only after the call reports success.
    let usage = unsafe {
        if libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr()) != 0 {
            return f64::NAN;
        }
        usage.assume_init()
    };
    // Bytes on macOS, kilobytes on Linux.
    let scale = if cfg!(target_os = "macos") {
        1.0
    } else {
        1024.0
    };
    usage.ru_maxrss as f64 * scale / 1e6
}

fn vault_blocks(vault: &Path) -> Result<Vec<Block>, String> {
    let mut notes = Vec::new();
    collect_notes(vault, vault, &mut notes)?;
    notes.sort();
    let mut blocks = Vec::new();
    for (note, path) in notes {
        let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        blocks.extend(note_blocks(&text).into_iter().map(|text| Block {
            note: note.clone(),
            text,
        }));
    }
    Ok(blocks)
}

fn collect_notes(
    root: &Path,
    folder: &Path,
    notes: &mut Vec<(String, PathBuf)>,
) -> Result<(), String> {
    for entry in fs::read_dir(folder).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        if path.is_dir() && !name.starts_with('.') {
            collect_notes(root, &path, notes)?;
        } else if name.ends_with(".md") {
            let relative = path.strip_prefix(root).map_err(|e| e.to_string())?;
            notes.push((relative.to_string_lossy().into_owned(), path));
        }
    }
    Ok(())
}

fn note_blocks(text: &str) -> Vec<String> {
    let body = text
        .strip_prefix("---\n")
        .and_then(|rest| rest.find("\n---").map(|end| &rest[end + 4..]))
        .unwrap_or(text);
    let mut blocks = Vec::new();
    for paragraph in body.split("\n\n") {
        let mut current: Vec<&str> = Vec::new();
        for line in paragraph.lines() {
            if starts_list_item(line) && !current.is_empty() {
                blocks.push(current.join("\n"));
                current.clear();
            }
            current.push(line);
        }
        blocks.push(current.join("\n"));
    }
    blocks
        .into_iter()
        .map(|block| block.trim().to_string())
        .filter(|block| !block.is_empty())
        .collect()
}

fn starts_list_item(line: &str) -> bool {
    let line = line.trim_start();
    let marker = line.trim_start_matches(|c: char| c.is_ascii_digit());
    line.starts_with("- ")
        || line.starts_with("* ")
        || line.starts_with("+ ")
        || (marker.len() < line.len() && marker.starts_with(". "))
}

fn read_questions(path: &Path) -> Result<Vec<Question>, String> {
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    text.lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let value: Value = serde_json::from_str(line).map_err(|e| e.to_string())?;
            let relevant = value["relevant"]
                .as_array()
                .ok_or("a question has no relevant notes")?
                .iter()
                .map(|r| {
                    (
                        r["note"].as_str().unwrap_or_default().to_string(),
                        r["contains"].as_str().unwrap_or_default().to_string(),
                    )
                })
                .collect();
            Ok(Question {
                text: value["q"]
                    .as_str()
                    .ok_or("a question has no text")?
                    .to_string(),
                relevant,
            })
        })
        .collect()
}
