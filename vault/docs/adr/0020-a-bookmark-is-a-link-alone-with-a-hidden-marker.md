---
type: adr
id: ADR-0020
title: A bookmark is a link alone on its line, with a marker every reader hides
status: accepted
date: 2026-09-27
---

# ADR-0020 — A bookmark is a link alone on its line, with a marker every reader hides

## Context

U-21 asks for Notion's bookmark: a link shown as a card with the page's
picture, title and a line of what it says, switchable back to a plain link.
The card is Atlas's drawing; the file has to say which links are cards, and
say it in a way that plain Obsidian (and any other markdown reader) still
shows as a working link. It must round-trip byte for byte (ADR-0003) and
survive the A21-01 writer, which only writes a block as typed when it reads
back as the editor's document.

Options weighed:

- **`[[Note]]` alone on a line means a bookmark.** No marker at all — but every
  existing note with a link on its own line would turn into cards overnight,
  and switching back to a link would be impossible to write.
- **An embed, `![[Note]]`.** Obsidian transcludes the whole note in place: not
  a link, and already means something else in Atlas.
- **An alias or title, `[[Note|bookmark]]` / `[Note](Note.md "bookmark")`.**
  Changes what Obsidian shows as the link's text, or its syntax.
- **Obsidian's own comment, `%%bookmark%%`.** Hidden in Obsidian, but shown as
  text by every other reader (GitHub, a previewer).
- **An HTML comment after the link.** Hidden by CommonMark, GitHub and
  Obsidian's reading view; the link before it stays a working link.

## Decision

A bookmark is a top-level paragraph holding exactly one wiki link (not an
embed), then the marker comment, and nothing else:

```markdown
[[Some Note]] <!-- atlas:bookmark -->
```

- Atlas writes one space and `<!-- atlas:bookmark -->`; it reads the marker
  with any spacing inside the comment, and with or without the space before
  it. An untouched bookmark keeps its bytes whatever they were.
- It is read from the paragraph's own line, not from how markdown splits it:
  a note named `_draft_`, `a*b*c` or `a<b>` is markup to a parser, but the
  line is still one link and the marker (A22-01).
- The comment is namespaced (`atlas:`) so no other comment is ever read as one.
- A link alone on its line without the marker stays a link. Words before or
  after, two links, an embed, a web link, the marker first (an HTML block),
  or the line inside a list or quote: none of these is a bookmark, and each is
  kept exactly as written.
- In the editor a bookmark is its own block atom, `bookmark`, holding the
  link's target, heading and alias. The writer (`bookmark-block.ts`) makes it
  `wikiLink` + space + `html`, which reads back as the same node, so A21-01's
  check passes and the as-typed form is used.
- The link is still an ordinary `[[…]]` in the text, so the index, backlinks,
  the graph and renaming a note (which re-points links in the text) all treat a
  bookmark as the link it is, with no change.
- A card is one of the note's own blocks only. The editor's schema lets only
  the document hold one, so no quote, callout, list item or table cell can,
  by drag, paste or command. A card pasted inside one goes in as its link, at
  the caret. And should the writer ever be handed a card inside another block,
  it writes the link alone in a paragraph there, so a link is never lost (in a
  table cell it once was) and it reads back as the link it is (A22-01).
- Switching a link to a bookmark takes its paragraph apart: text before stays a
  paragraph, the card follows, text after goes below. Only that paragraph is
  rewritten. Switching back gives the link alone in a paragraph, `[[Note]]`.
- Only notes can be bookmarked for now. A web link with the marker is kept as
  written but not drawn as a card: fetching a page's title and picture is
  network I/O, and inline web links have no click-through in the app yet.

## Consequences

- On a selected card, Enter starts a new paragraph after it, as Enter does
  after any block; Mod-Enter opens its note, as a click does (A22-01).
- A link to a heading in the same note, `[[#Plans]]`, is a card of that note.
- In Obsidian's live preview the comment may show dimmed while the caret is on
  that line; in its reading view, on GitHub and in any CommonMark reader it is
  invisible.
- The card is derived: its title, summary (the `description` or `summary`
  property, else the first paragraph) and picture (the thumbnail property and
  its cached page picture, then the cover or first image) are read from the
  linked note. Nothing about the card is stored in the file but the marker.
  A note's cards are read together, in one read, and a card is read again
  only when the index says the note it opens has changed, so a save elsewhere,
  the note's own autosave above all, costs one question to the index. Its
  picture is kept with it and let go when the card is read anew (A22-01).
- A `description` or `summary` shows as words, its markdown taken off, as a
  board card or a list row shows it.
- Bookmarks inside lists, quotes and tables are not offered; a card there would
  need a different shape for the list item's first paragraph.

## Note — `<!--` inside a link's name (A21-04)

A link is read before a comment can start inside it (ADR-0004), so
`[[a<!--b]] <!-- atlas:bookmark -->` is a bookmark of `a<!--b`, and the only
comment on its line is the marker. Plain text, tags and search read it the
same way: the `<!--` in the name hides nothing.
