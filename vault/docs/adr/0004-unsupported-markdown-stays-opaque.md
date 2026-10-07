---
type: adr
id: ADR-0004
title: Wiki links and callouts are nodes, not text
status: accepted
date: 2026-09-20
---

# ADR-0004 — Wiki links and callouts are nodes, not text

## Context

Neither `[[Another Note]]` nor `> [!warning]` is markdown. remark hands both back as
ordinary text, and the obvious approach — leave them as text and let the editor treat
them as characters — fails in a way that only shows up on save: the serializer escapes
the brackets, and `[[Note]]` is written back as `\[\[Note]]`. The link is dead, and the
damage is invisible until the file is reopened.

Round-trip tests did not catch it at first, because an unedited block is written back
from its original bytes. The corruption only appears when the paragraph _containing_
the link is edited.

## Decision

Both become real nodes.

- mdast's node registry is extended (`wikiLink`, `calloutMarker`) by declaration
  merging rather than casting, so the serializer's handler map accepts them.
- Each gets a `toMarkdown` handler that writes its text verbatim, bypassing escaping.
- In the editor a wiki link is an inline atom and a callout is a block whose marker
  lives in attributes with a non-editable header, so neither can be half-edited into
  something that no longer parses.

## Consequences

- Editing a paragraph around a link leaves the link intact, which is now an explicit
  test rather than an accident of the splicing.
- A callout's `[!kind]`, fold marker and title survive editing its body.
- Anything still unmodelled — raw HTML, footnote definitions — remains an opaque raw
  block, shown as source and saved untouched. Tables and images left that category in
  this phase; the rest can follow the same route when they need to.

## Note — one token, one grammar (A21-03, A21-04)

A wiki link is one token to the parser (`wiki-link-syntax.ts`), read before
emphasis, code or HTML can claim its characters. Its grammar lives once, in
the domain (`WikiLinkReader`): the editor's tokenizer feeds it code by code,
and `wikiLinkSpans` feeds it the raw text for the index, a rename, tags and
plain text, so none of them can find a link the editor does not show.

- `\[[x]]` is text; `\|` in a link is its alias's pipe, in a table or not; a
  link does not run over a line break.
- A code span that would cross a link's edge wins, as CommonMark's code spans
  win over its brackets: `[[a`b]] c` d` holds no link. One wholly inside a
  link is part of its name, as a code span nests in a markdown link's text:
  `[[x `y` z]]` links to `x `y` z`.
- A link in a fenced block, a comment, or a table row split at an unescaped
  `|` is no link. HTML blocks and tags, autolinks and indented code are not
  modelled on the raw-text side; a property test
  (`wiki-link-grammar.cross-check.property.test.ts`) holds the two readers
  equal everywhere else.
- `#^id` after a link's name names a block (P26, ADR-0022): read off the part
  the grammar already cuts (`linkFragment`), never by a second link reader.
  A block id itself, `^id` at the end of a block, has its own rule beside
  this one (`trailingBlockAnchor`), read by the editor, the index and a write
  alike.
