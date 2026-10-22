import {
  DEFAULT_HIGHLIGHT_STYLE,
  type HighlightStyle,
  type KindleAnchor,
} from '../highlights/anchor.ts';
import {
  appendHighlights,
  highlightNamed,
  withHighlightComment,
  type NewHighlight,
} from '../highlights/edit-highlights.ts';
import {
  readHighlights,
  type HighlightBlock,
  type ReadNoteBlocks,
} from '../highlights/highlight-block.ts';
import { kindleHighlightKey, kindleNoteKey } from './kindle-highlight-key.ts';
import type { KindleHighlight, KindleHighlightKey } from './kindle-types.ts';

/*
 * How a Kindle sync writes into a book's literature note (#508, ADR-0043,
 * ADR-0044). A passage is a highlight block, its Kindle place in the marker.
 * A note typed on a passage is that passage's comment: written with it when
 * both arrive together, and added after what the comment already says when
 * it arrives later, as a paragraph of its own — the comment's own bytes are
 * never rewritten (ADR-0003), whoever wrote them. A note at a place with no
 * passage is a block of its own, the note as its comment.
 *
 * What a note has recorded is read back from the note itself, so nothing is
 * kept anywhere else: a passage by its marker, a typed note by its words in
 * the comment of the passage it was typed on.
 */

/** A paragraph break in a comment: a blank line between two runs of text. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;

/** The most paragraphs of one comment read for the notes it holds: past it, only the first. */
const MAX_COMMENT_PARAGRAPHS = 64;

/** A Kindle highlight with no place the format can hold: no location, and no page in figures. */
export class KindleHighlightUnplaceableError extends Error {
  constructor(readonly key: KindleHighlightKey) {
    super(
      'A Kindle highlight has neither a location nor a page in figures, so DFAI cannot say where it is. ' +
        'Nothing of this book was written.',
    );
    this.name = 'KindleHighlightUnplaceableError';
  }
}

/** The key the passage of a Kindle block was synced under; null for a block of another source. */
function passageKeyOf(block: HighlightBlock, asin: string): KindleHighlightKey | null {
  if (block.anchor.kind !== 'kindle') return null;
  return kindleHighlightKey({
    asin,
    annotationId: block.anchor.annotationId,
    location: block.anchor.location?.start ?? null,
    words: block.anchor.exact ?? block.quote,
  });
}

/** Every run of consecutive paragraphs in `comment`: a note typed in paragraphs is one run of them. */
function paragraphRuns(comment: string): string[] {
  const paragraphs = comment
    .replace(/\r\n?/g, '\n')
    .split(PARAGRAPH_BREAK)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .slice(0, MAX_COMMENT_PARAGRAPHS);
  const runs: string[] = [];
  for (let first = 0; first < paragraphs.length; first += 1) {
    for (let last = first; last < paragraphs.length; last += 1) {
      runs.push(paragraphs.slice(first, last + 1).join('\n\n'));
    }
  }
  return runs;
}

/**
 * The keys one block has recorded: its passage's, the key of a note at a
 * place with no passage (whose words are its `exact`), and the key of every
 * note its comment holds whole, as paragraphs of their own.
 */
function keysOfBlock(block: HighlightBlock, asin: string): KindleHighlightKey[] {
  const passage = passageKeyOf(block, asin);
  if (passage === null) return [];
  const words = block.anchor.kind === 'kindle' ? (block.anchor.exact ?? block.quote) : block.quote;
  return [
    passage,
    kindleNoteKey(passage, words),
    ...paragraphRuns(block.comment).map((run) => kindleNoteKey(passage, run)),
  ];
}

/**
 * The keys of the Kindle highlights and typed notes the literature note
 * `text` holds for the book `asin`: what a sync need not add again. A
 * passage tidied in the note keeps its key (the marker keeps Kindle's
 * words); a typed note edited in the note no longer reads as recorded, and
 * Kindle's words arrive once more, after it — never in place of it.
 */
export function recordedKindleKeys(
  text: string,
  asin: string,
  noteBlocks: ReadNoteBlocks,
): Set<string> {
  const keys = new Set<string>();
  for (const block of readHighlights(text, noteBlocks)) {
    for (const key of keysOfBlock(block, asin)) keys.add(key);
  }
  return keys;
}

const PAGE_IN_FIGURES = /^[1-9]\d*$/;

function anchorOf(highlight: KindleHighlight, exact?: string): KindleAnchor {
  const page =
    highlight.page !== null && PAGE_IN_FIGURES.test(highlight.page)
      ? Number(highlight.page)
      : undefined;
  if (highlight.location === null && page === undefined) {
    throw new KindleHighlightUnplaceableError(highlight.key);
  }
  return {
    kind: 'kindle',
    location: highlight.location === null ? null : { start: highlight.location, end: null },
    ...(page !== undefined && { page }),
    annotationId: highlight.annotationId,
    ...(exact !== undefined && { exact }),
  };
}

function styleOf(highlight: KindleHighlight): HighlightStyle {
  if (highlight.style === 'underline') return { ...DEFAULT_HIGHLIGHT_STYLE, mark: 'underline' };
  if (highlight.style === 'note' || highlight.colour === null) return DEFAULT_HIGHLIGHT_STYLE;
  return { mark: 'highlight', color: highlight.colour };
}

/** What a note at a place with no passage shows as its quote: where it was typed. */
function placeOfNote(highlight: KindleHighlight): string {
  if (highlight.location !== null) return `Note at location ${highlight.location}`;
  return `Note on page ${highlight.page ?? ''}`.trim();
}

/** A passage as a new block; what was typed on it follows as its comment. */
function passageBlock(highlight: KindleHighlight): NewHighlight {
  return { quote: highlight.quote, anchor: anchorOf(highlight), style: styleOf(highlight) };
}

/** A note at a place with no passage as a block of its own: its words are its `exact`, so its key reads back. */
function noteBlock(highlight: KindleHighlight): NewHighlight {
  const note = highlight.note ?? '';
  return {
    quote: placeOfNote(highlight),
    anchor: anchorOf(highlight, note),
    style: DEFAULT_HIGHLIGHT_STYLE,
    comment: note,
  };
}

/** The note's Kindle blocks by the key their passage was synced under; the first of two. */
function blocksByPassage(
  text: string,
  asin: string,
  noteBlocks: ReadNoteBlocks,
): Map<string, string> {
  const held = new Map<string, string>();
  for (const block of readHighlights(text, noteBlocks)) {
    const key = passageKeyOf(block, asin);
    if (key !== null && !held.has(key)) held.set(key, block.id);
  }
  return held;
}

/** The key a typed note goes after: its passage's, or, for a note with none, its own annotation's. */
function passageOf(highlight: KindleHighlight): KindleHighlightKey {
  if (highlight.commentOn !== null) return highlight.commentOn;
  return kindleHighlightKey({ ...highlight, words: highlight.note ?? '' });
}

/**
 * Whether `highlight` is typed words that go after a block's comment: a note
 * on a passage, or a note with no passage under an annotation id the note
 * already has a block for — Kindle's edit of a note synced before, which the
 * format would not add twice, as it dedupes a Kindle block by its id.
 */
function isFollowUp(highlight: KindleHighlight, held: ReadonlyMap<string, string>): boolean {
  if (highlight.commentOn !== null) return true;
  return (
    highlight.style === 'note' && highlight.annotationId !== null && held.has(passageOf(highlight))
  );
}

/** A typed note's passage is no longer in the literature note: it changed since it was read. */
export class KindlePassageGoneError extends Error {
  constructor() {
    super(
      'A highlight a Kindle note was typed on is no longer in its literature note. ' +
        'Nothing of this book was written; the next sync adds the highlight and its note again.',
    );
    this.name = 'KindlePassageGoneError';
  }
}

/** `note` after what the comment of block `id` says, unless the comment holds it already. */
function withFollowUp(args: {
  readonly text: string;
  readonly id: string;
  readonly asin: string;
  readonly note: string;
  readonly noteBlocks: ReadNoteBlocks;
}): { readonly text: string; readonly added: boolean } {
  const block = highlightNamed(args.text, args.id, args.noteBlocks);
  const passage = passageKeyOf(block, args.asin);
  if (
    passage === null ||
    keysOfBlock(block, args.asin).includes(kindleNoteKey(passage, args.note))
  ) {
    return { text: args.text, added: false };
  }
  const comment = block.comment.trim() === '' ? args.note : `${block.comment}\n\n${args.note}`;
  return { text: withHighlightComment({ ...args, comment }), added: true };
}

/**
 * The literature note `text` with a book's new Kindle highlights written in
 * (#508). Passages, and notes at a place with no passage, are blocks after
 * the last, ids drawn from `random`; a passage the note holds already is not
 * added again (`appendHighlights`). Then each typed note goes after its
 * passage's comment, as a paragraph of its own — the whole comment when it
 * has none — unless the comment holds it already; the comment's bytes are
 * kept. `written` is how many entries changed the note. Throws, writing
 * nothing, what `appendHighlights` and `withHighlightComment` throw,
 * `KindleHighlightUnplaceableError` for a highlight with no place, and
 * `KindlePassageGoneError` for a note whose passage is not in the note.
 */
export function withKindleHighlights(args: {
  readonly text: string;
  readonly asin: string;
  readonly highlights: readonly KindleHighlight[];
  readonly random: () => number;
  readonly noteBlocks: ReadNoteBlocks;
}): { readonly text: string; readonly written: number } {
  const { asin, noteBlocks } = args;
  const held = blocksByPassage(args.text, asin, noteBlocks);
  const blocks = args.highlights.filter((highlight) => !isFollowUp(highlight, held));
  const appended = appendHighlights({
    text: args.text,
    highlights: blocks.map((h) => (h.style === 'note' ? noteBlock(h) : passageBlock(h))),
    random: args.random,
    noteBlocks,
  });
  const ids = new Map(held);
  blocks.forEach((highlight, at) => {
    const answer = appended.highlights[at];
    if (answer !== undefined && highlight.style !== 'note') ids.set(highlight.key, answer.id);
  });
  let text = appended.text;
  let written = appended.highlights.filter((answer) => answer.added).length;
  for (const highlight of args.highlights.filter((h) => isFollowUp(h, held))) {
    const id = ids.get(passageOf(highlight));
    if (id === undefined) throw new KindlePassageGoneError();
    const followed = withFollowUp({ text, id, asin, note: highlight.note ?? '', noteBlocks });
    text = followed.text;
    if (followed.added) written += 1;
  }
  return { text, written };
}
