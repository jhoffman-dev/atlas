---
type: adr
id: ADR-0022
title: Block ids are Obsidian's, written only when first referred to; a shown block is its embed alone on a line
status: accepted
date: 2026-09-27
---

# ADR-0022 — Block ids are Obsidian's, and a shown block is its embed alone on a line

## Context

U-25 asks for block transclusion as Capacities has it, written as Obsidian
writes it: `![[Page#^block]]`, picked page first, then block. A block needs a
name that survives edits to it and moves within its note, that Obsidian reads
the same, and that costs nothing in a note nobody links into. Saves are
byte-preserving (ADR-0003) and every edited block reads back as the editor had
it (A21-01); links have one grammar (ADR-0004's note).

## Decision

- **Obsidian's `^id`.** A paragraph's, a heading's or a list item's id ends
  its own text after a space (`Pack the tent ^f3k9x2`, `## Packing ^h2k8d1`);
  a task's may follow its box alone (`- [ ] ^id`), and `- [ ]` with nothing
  after it is the empty task Obsidian draws; a table's, quote's, callout's,
  code's or whole list's id is `^id` on a line of its own after it, a blank
  line between. Where each can go is one rule, `anchorPlaces` /
  `isAnchorPlace`, asked by the editor, the writer and the index alike. New ids are six lower-case letters and digits, drawn from an
  injected `Rng`, never one the note already holds.
- **Written only when first referred to.** Picking a block with no id in the
  `#` picker writes one — to its own note through the normal save, refused
  while that note has unsaved typing in a pane (`UnsavedTypingError`); to the
  note being typed in, in the same transaction as the link, so one undo takes
  both. Nothing else ever writes an id.
- **One rule, read everywhere.** `trailingBlockAnchor` / `standaloneBlockAnchor`
  (domain) read an id; `linkFragment` reads `#^id` or `#Heading` off the part
  the wiki-link grammar already cuts. The editor, the index (a derived
  `blocks` table, schema 9) and the write to another note all go through them.
- **The editor holds the id off the text**, as an attribute of the block it
  names: kept through edits and moves (and cut and paste — it is written to
  the copied HTML), not given to the half of a block Enter splits off, and
  taken off a pasted copy while the original is still in the note.
- **An id follows its block whatever kind it becomes** (A26-01). A paragraph
  made a list item, a task, a quote or a heading, and back, keeps its id: the
  words are followed through the change and the nearest place around them
  that the file writes an id for takes it. Only what a change touched is
  looked at, so a keystroke costs the same however many ids a note holds.
- **Untouched text wins** (A26-01, ADR-0003 over this ADR's first "the first
  keeps it"). Two blocks the file gives one id — a copy pasted in Obsidian, a
  hand edit — are left as the file has them, when the note is read and when
  another block is typed in; a change only takes an id off a block it gave
  that id to (a retag, a split, a drop) while another holds it. The `#`
  picker never links a block by an id another block also holds: it asks the
  note for one of the block's own (`anchorBlock`), which keeps the id where
  it names the block and gives a later holder a new one.
- **An id is never let go without a trace.** One the editor holds where the
  file has no place — a second id in a quote that already has one — is
  written as words after the words it named, `Two ^b2`, and read back as
  text. Only an id on a block with no words at all, which names nothing to
  show, goes with it.
- **The id is drawn**, faint, after the words it follows (or under a quote
  or code), in both themes, never as text: a block something links to says
  so. A shown block's own id is not drawn.
- **Adding or removing an id changes nothing else.** Each block remembers
  where its ids are or would go in its bytes; a block changed only in its ids
  is written as its own bytes with the id spliced in. A caret typed where an
  id would be read is escaped, so text reads back as text.
- **A shown block is `![[Note#^id]]` (or `#Heading`) alone in one of the
  note's own paragraphs** — one domain rule, `shownBlockLink`, the reader's
  and the picker's — a node of its own, like a bookmark (ADR-0020). Only a
  note's block is shown: `![[Paper.pdf#page=3]]` names a page of a file,
  and stays a link.
  Anywhere else, or as a whole-note embed, it stays the link it was. It is
  drawn read-only and live from its note, named by that note, opens it at the
  block, and says when the block or the note is gone or archived. An embed
  inside a shown block is drawn as its link, so A in B in A stops at one level.

## Consequences

- An Obsidian vault's ids and embeds work unchanged, and Atlas's work in
  Obsidian. A note with no links into it never gains an id.
- `[[Note#^id]]` and `[[Note#Heading]]` links open their note scrolled to the
  block or heading.
- An id on a paragraph inside a quote or a callout is the quote's, where the
  quote has none; where it has one, the paragraph's is kept as words. A quote
  holding only code, whose id is taken, is the one block that loses a second
  id: it has no words to keep it after.
- A note with one id twice keeps both, and `[[Note#^id]]` opens the first,
  as it always did.
- Editing a shown block in place (P26-04) is not built: the embed is
  read-only, and its note's name opens the block where it is written.
