---
type: adr
id: ADR-0018
title: One tag grammar, read the same everywhere
status: accepted
date: 2026-09-27
---

# ADR-0018 — One tag grammar, read the same everywhere

## Context

A `#tag` is read in three places: the editor draws it, the serializer writes
it, and the index counts it. Phase 20 gave them one grammar, `findTags` in
`packages/domain/src/tags`, but the review of it (A20-03) found places where
they still disagreed, or where the grammar and markdown did:

- `#_draft_` was drawn and indexed as a tag, and saved as emphasis — so after
  a save it was no tag at all.
- `See [[Page]]#heading` was drawn as a tag in the editor, where the link is a
  node of its own, but not indexed, because in the file the `#` follows `]]`.
- `#todo fix the F# build` was read as the closed tag `todo fix the F`.

## Decision

`findTags` decides what a tag is. The others hand it the same text:

- **The index** reads each run of plain text the markdown parser finds.
- **The editor** reads each run of text as the file has it: a run ends where
  the marks change and at any node that is not text, except a wiki link, which
  is text in the file and so stays inside its run (as a character that is
  neither a word nor a space). It rereads only the blocks an edit touched.
- **The serializer** writes every tag verbatim, so a `#` opening a line is
  never escaped.

Two rules of the grammar are set by markdown and by how people write:

1. **A tag's name, and each part and word of it, may not start or end with
   `_`.** Inside is fine: `#my_tag`. `#_draft_` is no tag, and `#draft_` is
   the tag `draft` with an `_` after it. A rename to such a name is refused
   with that reason.
2. **A single-letter word does not close a multi-word tag.** Its `#` is `C#`
   or `F#`, not Bear's closing `#`, so `#todo fix the F# build` is the tag
   `todo`. A single word may still be closed: `#a#`. So a rename to a name of
   several words whose last is one letter (`plan a`) is refused: no spelling
   of it reads back. And a rename reads each note back through this grammar
   before writing it: where a closed name would run into what follows it
   (`#idea_` or `#idea#x` renamed to `my tag`), that note keeps the old name
   and says why (A20-04).

When `#` is typed, the tag typed comes first in the suggestions — the one of
that name, or else the offer to create it — and the cap never drops it, so
Enter writes what was typed rather than a longer tag that is used more.

## Consequences

- What is drawn as a tag is what is counted, clicked and renamed; the tests in
  `packages/ui/src/editor/tags.adversarial.test.ts` and
  `packages/adapters/src/markdown/tag-round-trip.adversarial.test.ts` hold
  the editor and the file to it.
- Text that was a tag under the old grammar (`#_private`, `#learn C#`) reads
  differently now. No file is rewritten; the index's version went up (6), so
  it is rebuilt from the files and counts them the new way.
- The grammar's shields (code, links, URLs, HTML) are linear scans, so a long
  pasted line costs time in proportion to its length.
