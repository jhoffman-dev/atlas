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
host (a sentence-embedding model of roughly 100 MB or less, chosen by a
measured spike on James's vault: quality on his questions, MB, ms per block).
The host loads the model and returns vectors; which blocks to embed, chunking,
ranking and thresholds are TypeScript. Search is brute-force cosine over the
vault's blocks until measured to be too slow.

**A suggestion is never a link until accepted.** "Related notes" proposes;
Accept writes a real `[[link]]` through the normal save.

## Consequences

- First build of the cache takes minutes on a large vault; it runs in the
  background and resumes.
- The app download grows by the model, or the model downloads once on first
  use — decided in the spike.
- A remote embedding provider can be a second implementation of the port,
  off by default.
