---
type: adr
id: ADR-0043
title: A highlight is a quote block in its literature note, with an id and a hidden anchor
status: proposed
date: 2026-10-21
---

# ADR-0043 — A highlight is a quote block in its literature note, with an id and a hidden anchor

## Context

The research and study area (epic #509) reads PDFs and EPUBs in the app,
takes highlights and underlines with a comment on each, pulls highlights into
other notes, opens the document at a highlight's place, and brings Kindle
highlights in the same way. Five later pieces read and write one format —
the PDF reader (#504), EPUB (#505), jump-to-location (#506), the library
(#507) and Kindle sync (#508) — so the format is decided first (#503).

What it has to hold to: markdown is the truth and the index is derived
(ADR-0005); untouched bytes stay untouched (ADR-0003); block ids are
Obsidian's (ADR-0022), so `[[Source#^id]]` and `![[Source#^id]]` need no new
grammar; a marker DFAI reads is hidden from every other reader (ADR-0020);
every type has a home folder (ADR-0038). And the note must read well in
Obsidian, where the person will also edit it.

Options weighed for where a highlight lives:

- **In the PDF itself** (annotations). Every reader shows them, but DFAI would
  write into a file it did not make, sync would carry a changed binary, and an
  EPUB or a Kindle book has nowhere to put one.
- **In a sidecar file** (JSON beside the PDF). Easy to write, but invisible in
  Obsidian, outside the index's notes, and no block id can name it.
- **In a note, one block per highlight.** Readable anywhere, linkable by
  `^id`, searchable, synced like any note. Chosen.

## Decision

1. **One literature note per source.** A PDF or EPUB lives in the vault, in its
   type's home folder, `Library` by default (ADR-0038's table gains
   `literature → Library`), and syncs with it. DFAI never writes into the file,
   so it stays byte-identical. Its note declares what it is:

   ```markdown
   ---
   type: literature
   kind: pdf
   title: 'The Art of War'
   author: 'Sun Tzu'
   file: '[[Library/The Art of War.pdf]]'
   ---
   ```

   The type is `literature`, after the Zettelkasten literature note: the note
   you write about something you read. It is not `source`, which a data
   source's `atlas: source` already reserves (so a `source` type file could
   not be defined). `kind` is `pdf`, `epub` or `kindle`. A Kindle book has no
   file in the vault, so it has no `file`; it may have an `asin` (Amazon's id
   for the book), and a Kindle sync finds a book's note by `asin`, falling
   back to its title and author. DFAI writes every value quoted; it reads a
   `file` written as a link (alias or heading aside) or as a bare path.

   The `file:` is a wiki link, and `#`, `^`, `|`, `[` and `]` mean something
   inside one, so a file with one in its name would read back as another
   file. The writer refuses it (`UnsafeSourceFileError`), and the importer
   (#504) names the files it saves with `safeSourceFileName`, which makes
   each of those characters a hyphen.

2. **A highlight is one quote block, then its id.** The quoted words, the
   hidden marker, and the person's comment are all one quote; the block's
   `^id` sits on a line of its own after it, a blank line between, as
   ADR-0022 writes a quote's id:

   ```markdown
   > All warfare is based on deception.
   > <!-- atlas:highlight {"v":1,"mark":"highlight","color":"yellow","kind":"pdf","page":3,"exact":"All warfare is based on deception.","prefix":"Sun Tzu said: ","suffix":" Hence, when","rects":[[0.12,0.31,0.62,0.02]]} -->
   >
   > The line every summary quotes. Compare [[Larkspur Payroll]]'s pitch.

   ^k3x9q2
   ```

   The marker parts the quote from the comment: the lines before it are the
   quote, the lines after it the comment. So `![[The Art of War#^k3x9q2]]`
   shows the quote and its comment, and `[[The Art of War#^k3x9q2]]` opens
   the note at it. In Obsidian's reading view, on GitHub and in any
   CommonMark reader the marker is invisible.

   The format stays this: not a callout, and not a nested quote for the
   comment. The blank `>` line DFAI writes between the marker and the
   comment only separates them (the quote is the lines before the marker, the
   comment the lines after it). A comment line that lost its `>` in Obsidian
   is a CommonMark lazy continuation, still part of the quote there, so it is
   still part of the highlight; the next comment write puts the `>` back. A
   line ends the quote only when CommonMark lets it interrupt a paragraph,
   and what follows is then no highlight: an ATX heading (`#` to `######`
   then a space, a tab or the line's end — `#tag` is text), a thematic break,
   a fence (three or more backticks or tildes; `~~struck~~` and `` `code` ``
   are text), a `>`, a list item that may interrupt (a bullet, or an ordered
   item numbered 1, with words after it — `-`, `1.` and `2. more` are text),
   and HTML blocks 1 to 6 (`<pre>`, `<!--`, `<div>`, …; inline HTML such as
   `<b>` and an autolink `<https://…>` are text). A setext underline cannot
   be lazy, so `===` and `--` stay text, and `---` is a thematic break.

3. **The marker holds the anchor and the style, as one line of JSON.**
   `<!-- atlas:highlight {…} -->`, `atlas:` as every marker is (ADR-0042),
   `v` its version. `<` and `>` in the JSON are written `<` and
   `>`, so no quoted words can close the comment. The anchor is:

   | Kind     | Fields                                                                                           |
   | -------- | ------------------------------------------------------------------------------------------------ |
   | `pdf`    | `page` (from 1), `exact` + `prefix` + `suffix`, `rects` as `[x, y, w, h]`                        |
   | `epub`   | `cfi` (`epubcfi(…)`), `exact` + `prefix` + `suffix`                                              |
   | `kindle` | `location` (from 1) or `page` (from 1), optional `locationEnd`, optional `annotationId`, `exact` |

   `exact`/`prefix`/`suffix` is the W3C TextQuoteSelector. A Kindle highlight
   has `location` or, for a book whose export has pages and no locations,
   `page`; its `exact` is the export's own words, written when it is added. A PDF box is in
   fractions of its page from the top-left, so it holds at any zoom. A PDF
   highlight with no words — an area on a scanned page — has no `exact` and
   at least one box. The style is `mark` (`highlight` or `underline`) and
   `color` (yellow, green, blue, pink, purple, orange); one this build does
   not know is drawn as a yellow highlight, and its bytes are kept.

   The marker is one line and hides in every reader: `<`, `>`, U+2028 and
   U+2029 are written as JSON escapes (a PDF's text layer holds the last two,
   which some readers take for a line end). A marker whose JSON holds a raw
   `-->` is not read, since CommonMark ends the comment there and shows the
   rest as text. An anchor is refused when its `exact` (a Kindle one's too)
   is empty or only whitespace, or a
   PDF box runs off its page (past the right or bottom edge, within a rounding
   of 1e-6).

4. **The quote and comment are the person's; the anchor is the source's.**
   The person may edit the quote — tidy an OCR slip, cut it shorter — and the
   comment, in DFAI or in Obsidian; the marker and the `^id` stay. The anchor
   keeps the source's own words in `exact`, so a tidied quote still finds its
   passage. DFAI writes the quote from the source's words escaped as text,
   one line per paragraph (a PDF's line breaks are its page's, not the
   author's), so `*`, `#word`, `==`, `%%` or `^id` in a book never become
   markup, a tag, a highlight, a comment or an id. A paragraph that is only a
   list number (`1.`, `2)`) is escaped too, since alone it is an empty list
   item.

5. **Writes change only their highlight's bytes** (ADR-0003). Adding appends
   a block after the note's last byte, after a blank line of its own — never
   one the note already ended in, which is the person's — and at the very
   start of an empty body with none. A new comment
   replaces the comment's lines and nothing else; written back as it reads,
   a comment is the same bytes. Removing takes out the block and the one
   blank line that parted it. A highlight is removed only on the person's
   command: nothing removes one by itself, sync included. A note with no final
   newline stays so: the block is written without one, and removing it gives
   the note back byte for byte. So removing every highlight added gives the
   note back byte for byte, whatever it ended in (`\n\n`, `\n  \n`,
   `\r\n\r\n`, no line ending). Each write goes
   through the vault against the version just read, and is refused while a
   pane holds unsaved typing in the note (as linking a block is, ADR-0022).

   Appending checks itself before it writes. Every highlight added must read
   back from the note it was added to, or `HighlightNotReadBackError` is
   thrown and nothing is written: a note that ends inside an unclosed code
   fence, raw HTML block (`<pre>`, `<script>`, `<style>`, `<textarea>`), HTML
   comment or Obsidian `%%` comment would hide the block, and every sync would add the
   same passage again. And a note that holds a marker this build cannot read
   (a newer version's, or one broken by hand) is refused with
   `UnreadableHighlightMarkerError`, because that marker may be a passage the
   build would add a second time; editing a comment or removing a highlight
   still work around it.

6. **Ids per ADR-0022.** Six lower-case letters and digits from the injected
   `Rng`, never one a line of the note could already be read as holding.

7. **Adding a passage twice adds it once.** What makes two highlights the
   same passage is `highlightKey`: a PDF page and its selector (so a PDF
   key relies on `prefix` and `suffix` to tell two copies of a phrase on one
   page apart), a PDF area's page and boxes, an EPUB CFI, Kindle's
   `annotationId`, or without one a Kindle place (location or page) and the
   export's words, `exact`, never the quote as the person has since edited it.
   An export that learns an annotation id later still matches the copy synced
   without one, on place and words (`kindlePlaceKey`): the place is where the
   location starts — My Clippings gives `Location 77-79` where the notebook
   export gives `Location 77` — or the page when there is no location, so two
   different words at one place stay two passages; two different ids are two
   passages. An export that gives blank words for `exact` gives none, and the
   quote stands in for them.
   Adding one the note holds answers the id it has. So a Kindle sync can hand
   over every highlight each time.

8. **What is a highlight is read from the lines, one rule.** A quote at a
   line's first column, after a blank line or the start of the body, outside
   a code fence, holding exactly one marker this build reads with words
   before it, then a blank line and `^id`. A quote without the id, with two
   markers, a broken or newer marker, inside a list, or inside a code fence,
   an HTML comment, a raw HTML block (CommonMark block 1: `<pre>`,
   `<script>`, `<style>`, `<textarea>`, to the line that closes the tag) or
   an Obsidian `%%` comment (a line with an odd number of `%%` outside HTML
   comments and inline code opens or closes one), closed or not: not a
   highlight, and kept exactly as written. One nobody closed runs to the end
   of the note — except that a fence or HTML block opened in a list item ends
   with the item, at the first non-blank line indented less than the item's
   content (CommonMark's container rule), so a list that ends in a fence
   neither refuses appends nor hides the highlights after it. Only a note that says `type: literature` has
   highlights; the same text pasted elsewhere is a quote.

9. **Re-anchoring uses the words first.** `findQuote` looks for `exact` in a
   page's or chapter's text, whitespace compared loosely, and of two copies
   takes the one whose surroundings match `prefix` and `suffix`;
   `findQuoteNear` looks on the named page first, then outward. So a file
   downloaded again, or another edition, still finds its highlights; changed
   words are not found rather than found in the wrong place. Space at either
   end of `exact` counts as surroundings, so a selection that began on a space
   finds its own copy. A copy wins only on surroundings that are not
   whitespace: only the non-whitespace characters of `prefix` and `suffix`
   it matches count, so copies whose surroundings differ in whitespace alone
   tie, and copies that tie are no match at all rather than the first. The page `near` is made a section index first: a fraction rounds
   down, a number out of range is the nearest end, and NaN is the first.

10. **The index has a `highlights` table** (schema 19): `path, idx, id, kind,
quote, comment, mark, color, anchor` — the quote's plain words, the
    comment's markdown, and the marker's JSON. TypeScript reads the rows
    (`highlightRows`); Rust stores them (ADR-0005). `/v1/sql` reads it.

## Consequences

- A literature note reads as a list of quotes with comments in Obsidian; its
  highlights link and transclude with Obsidian's own grammar; search finds
  quotes and comments and never the marker.
- DFAI's editor shows a highlight as one raw block, written back untouched,
  until a highlight node is built (the reader's views edit comments through
  `editHighlightComment` meanwhile).
- The domain's public API — `appendHighlights`, `withHighlightComment`,
  `withoutHighlight`, `readHighlights`, `findQuote`, `literatureNoteText` — is
  pure; the application's `addHighlight(s)`, `editHighlightComment` and
  `removeHighlight` are the vault writes the readers and sync call.
- The note type is `literature`, so a vault can define a `literature` type
  file (its views and columns) and the library (#507) reads it from
  `files.note_type`; the `highlights` table holds the rest.
- A marker of another version is left alone, so an older DFAI on another Mac
  never rewrites a newer one's highlights.

## Alternatives rejected

- **A callout (`> [!quote]`).** Reads well, but the callout's own title line
  would hold the source or page, which the person then edits as words.
- **The comment as a paragraph after the quote, outside it.** An embed of the
  `^id` would show the quote alone, and the comment would belong to no block.
- **The anchor in frontmatter, keyed by id.** One place for every anchor, but
  every highlight write would rewrite the frontmatter, and a highlight copied
  to another note would lose its place.
- **Key=value pairs in the marker.** Shorter, but quoted words with `=`, `"`
  or a line break need an escaping scheme of their own; JSON already has one.
