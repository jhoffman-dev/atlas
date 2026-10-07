---
type: adr
id: ADR-0005
title: The index stores; TypeScript decides
status: accepted
date: 2026-09-20
---

# ADR-0005 — The index stores; TypeScript decides

## Context

Indexing a vault is mostly file reading and SQL, both of which live on the Rust side.
The tempting shape is to put the whole job there: walk the vault, parse the
frontmatter, find the links, write the rows. It would be fast and self-contained.

It would also mean two implementations of what a note _is_. Rust would decide what
counts as a property and where `[[today]]` points, while the editor decides the same
things in TypeScript — and the two would drift. A search result or a backlink that
disagrees with what the editor shows is worse than a slow index.

## Decision

Rust reads files and stores rows. Every decision stays in TypeScript.

- `read_notes` returns a batch of note texts; `list_notes` returns names with size
  and modification time. Neither interprets anything. (`list_notes` did not hold to
  this — it skipped dotted directories on its own judgement until ADR-0014, which
  says how it is told what to skip instead.)
- The refresh use-case splits frontmatter, extracts properties, pulls out links and
  resolves them — using the same domain functions the editor uses — and hands the
  result to `index_put` as rows.
- The index has no opinion about markdown. Its schema is files, properties, links
  and a full-text table.

Only notes whose size or modification time differ are re-read, so an ordinary launch
does almost no work.

## Consequences

- A link resolves the same way in the backlinks panel, when clicked, and in the
  index, because it is literally the same function.
- Indexing costs IPC: note text crosses the boundary in batches of 200. For a vault
  of a few thousand notes this is a second of work on first open and nothing
  afterwards. If that ever stops being true, the batch size is one constant.
- The database is derived and disposable. `PRAGMA user_version` mismatches delete it
  rather than migrating it, and the Rebuild button does the same on demand — which
  is the standing proof that nothing depends on it surviving.
