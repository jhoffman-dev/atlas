---
type: adr
id: ADR-0031
title: Embeddings are a disposable local cache, made on this Mac
status: proposed
date: 2026-10-07
---

# ADR-0031 — Embeddings are a disposable local cache, made on this Mac

## Context

James wants related-note suggestions, a trail through a line of thought, and
"what did <colleague> say about X" answered semantically, in the app and over MCP.
That needs vector embeddings of blocks. Work notes must not leave the Mac for
a third-party embedding API without James choosing that.

## Decision

**Embeddings are derived and disposable, like the index (ADR-0005):** a
`block_embeddings` table in `.atlas-cache/` keyed by note path, block
ordinal and a digest of the block's text, rebuilt from the files, never
synced, never in a note. Every block is embedded, not only those with a
`^id` (the index's `blocks` table holds only those); a block id is written
only when a suggestion or answer is accepted and needs to cite one
(ADR-0022's "written only when first referred to" holds).

**They are computed locally** by a small open embedding model run by the
host. The host loads the model and returns vectors; which blocks to embed,
chunking, ranking and thresholds are TypeScript. Search is brute-force cosine
over the vault's blocks until measured to be too slow.

**The model is Snowflake Arctic Embed XS** (`Snowflake/snowflake-arctic-embed-xs`,
Apache-2.0, 22M parameters, 384 dimensions, 512-token window), chosen by the
spike below: the best of three on the questions, inside the 100 MB budget, and
about a millisecond per block slower than the fastest.

**A suggestion is never a link until accepted.** "Related notes" proposes;
Accept writes a real `[[link]]` through the normal save.

## The spike (P32-01, 2026-10-08)

Three small open BERT-family models, each run through the code the app ships
(`src-tauri/examples/embedding_spike.rs`, which calls the same `Embedder`):

- **all-MiniLM-L6-v2** — the usual small default; mean pooling; 256-token window.
- **bge-small-en-v1.5** — a stronger retriever, but 134 MB, over the budget;
  there to show what the extra size buys.
- **snowflake-arctic-embed-xs** — a newer retriever at MiniLM's size.

**Corpus.** A copy of James's vault, outside the repository: about 100 Markdown
files, of which 32 notes have body text, cut into 2,099 blocks (313 KB). Blocks
approximate the app's: the body after frontmatter, cut at blank lines and at
each list item. A block longer than a model reads was halved at a space until
it fit: 10 blocks for the 512-token models, 20 for MiniLM.

**Questions.** 20 questions, each naming the note and a phrase of the block
that answers it, worded to share few words with the answer. A hit is an
answering block in the top _k_ by cosine. Questions and corpus stay on James's
Mac; only these totals are recorded.

| Model               | Download | Block recall@5 | @10  |   MRR@10 | Note recall@5 | ms / block |  32 blocks | One query | Peak memory |
| ------------------- | -------: | -------------: | ---- | -------: | ------------: | ---------: | ---------: | --------: | ----------: |
| all-MiniLM-L6-v2    |    91 MB |           0.75 | 0.80 |     0.54 |          1.00 |        4.4 |   58–60 ms |   3.3–3.6 |  240–350 MB |
| bge-small-en-v1.5   |   134 MB |           0.75 | 0.85 |     0.52 |          0.95 |  10.7–11.2 | 139–142 ms |   9.3–9.9 |  350–510 MB |
| **arctic-embed-xs** |    91 MB |       **0.80** | 0.85 | **0.59** |          0.95 |    5.5–5.9 |   71–74 ms |   4.5–4.7 |  310–430 MB |

- Apple M5, 10 cores, 24 GB, CPU with Apple's Accelerate. **The machine was
  heavily loaded** by parallel builds throughout: load averages of 12 to 40 on
  10 cores during these runs, up to 160 earlier. Each figure is the range over
  two or three runs; on a quiet Mac expect the times lower.
- _ms / block_ is the whole corpus embedded in calls of 64, in vault order.
  _32 blocks_ is the median of five calls with the corpus's first 32 blocks;
  _one query_ is in milliseconds. Loading took 25–50 ms with the files in the
  OS cache; reading them cold adds the disk.
- Peak memory is the process's peak resident size after embedding the corpus;
  about 200 MB of it (290 MB for bge) is the model once loaded.
- Recall at 5 and 10 did not move between runs or pass sizes. At other pass
  sizes, float rounding moved one answer by a place for bge and Arctic
  (MRR ±0.03).

**What decided it.** Arctic answered one more question in the top five than
either other model and ranked answers higher (MRR 0.59 against 0.54 and 0.52),
at MiniLM's size and about 1.3× its time. Its 512-token window also halves the
blocks that need splitting. bge-small bought nothing on these questions for
1.5× the download and twice Arctic's time.

**Limits of the spike.** The questions were written by an agent from the copy's
content, not by James, so they are a guess at what he asks. Twenty questions
make each one worth 0.05: the gap between Arctic and MiniLM is one question at
_k_ = 5, which a different question set could reverse. Re-running the harness
on questions James writes is cheap (the command is in the file's header) and
is the way to revisit the choice.

**Pass size.** The host runs the model in passes of at most 256 tokens,
padding included, grouping texts of similar length. Measured with Arctic: 256
and 512 were equally fast per block, and peak memory rose with the pass — about
0.35 GB at 256, 0.5 at 512, 0.74 at 1,024 and 2.5 GB at 8,192, which was also
twice as slow.

## The host command

`embed(texts, purpose)` (`src-tauri/src/embeddings.rs`), behind
`EmbeddingPort` in the application layer and `tauriEmbeddings` in adapters.

- **One unit-length vector per text, in order**, so cosine similarity is a dot
  product. `purpose` is `query` or `passage`: Arctic reads a query behind the
  prefix it was trained with, and the host adds it, since it is the model's
  contract, not a choice about the vault.
- **Budget, on this Mac: 100 ms for a call of 32 blocks and 10 ms for one
  query**; measured at 71–74 ms and 4.5–4.7 ms under the load above. The first
  build of the cache for a vault this size is about 12 s.
- **Refusals, before any work**: more than 256 texts or 1 MB of text in one
  call, and any text longer than 512 tokens — named by position, so the chunker
  can split it. A long text is never cut, since a cut would silently drop its
  end from every search; how to split a block is the chunker's to decide.
- **The model is fetched on first use, not bundled.** 91 MB from its pinned
  Hugging Face revision (`d8c86521100d`), each file checked against a pinned
  size and SHA-256 as it arrives and renamed into place only once it matches,
  into `~/Library/Application Support/dev.jhoffman.atlas/models/`. It is kept
  per Mac, never in a vault and never synced.
- **Offline**: once fetched, nothing touches the network. A first use with no
  network fails with a message that says so, and the next call tries again.

**Dependencies.** Candle 0.11 (`candle-core`, `candle-nn`,
`candle-transformers`, MIT or Apache-2.0) and `tokenizers` 0.22 (Apache-2.0),
Hugging Face's own pure-Rust framework and tokenizer: they read the
safetensors and tokenizer files these models publish as they are, and build
offline from the crate cache. Chosen over ONNX Runtime (`ort`, `fastembed`),
which downloads a native library at build time and ships it beside the app;
`tract` (pure-Rust ONNX) was not measured. Candle adds 78 crates to the lock
file, all under MIT, Apache-2.0, BSD or Zlib terms; the release `atlas` binary
grows from 18.1 MB to 22.1 MB. Metal was not tried: the CPU met the budget.

## Consequences

- First build of the cache takes seconds to minutes depending on the vault; it
  runs in the background and resumes.
- The app download does not grow by the model. The first semantic feature used
  on a Mac waits for a 91 MB download, and does not work on a Mac that has
  never been online since installing Atlas.
- The integration tests fetch the model into the build's temporary folder the
  first time they run, so a first `cargo test` on a machine needs the network.
- A remote embedding provider can be a second implementation of the port,
  off by default.
- Changing the model means a new pinned revision and digests, and every cached
  vector is rebuilt: vectors from two models are not comparable.
