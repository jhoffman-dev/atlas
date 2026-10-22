import {
  DEFAULT_HIGHLIGHT_STYLE,
  type HighlightStyle,
  type KindleAnchor,
} from '../highlights/anchor.ts';
import {
  appendHighlights,
  highlightNamed,
  withHighlightCommentAfter,
  type NewHighlight,
} from '../highlights/edit-highlights.ts';
import {
  readHighlights,
  type HighlightBlock,
  type ReadNoteBlocks,
} from '../highlights/highlight-block.ts';
import { readKindleTombstone } from '../highlights/highlight-marker.ts';
import { undoCommentEscapes } from '../highlights/highlight-text.ts';
import {
  kindleHighlightKey,
  kindleKeyOfWordsHash,
  kindleNoteKey,
  noteHasWords,
  kindleNoteKeysOfRuns,
  removedKindleKey,
} from './kindle-highlight-key.ts';
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
 * the comment of the passage it was typed on, a passage the person removed by
 * the tombstone it left (ADR-0043 §5). A highlight with no place the format
 * can hold is skipped, and said so; the rest of its book is written.
 */

/** A paragraph break in a comment: a blank line between two runs of text. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/;

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

/** The paragraphs of a comment, in order. */
const paragraphsOf = (comment: string): string[] =>
  comment.replace(/\r\n?/g, '\n').split(PARAGRAPH_BREAK);

/**
 * The keys one block has recorded: its passage's, the key of a note at a
 * place with no passage (whose words are its `exact`), and the key of every
 * note its comment holds whole, as paragraphs of their own. A comment holds a
 * note as DFAI wrote it, `%%` escaped where it would hide the note; the notes
 * are keyed as they were typed too (`undoCommentEscapes`).
 */
function keysOfBlock(block: HighlightBlock, asin: string): KindleHighlightKey[] {
  const passage = passageKeyOf(block, asin);
  if (passage === null) return [];
  const words = block.anchor.kind === 'kindle' ? (block.anchor.exact ?? block.quote) : block.quote;
  const comments = new Set([block.comment, undoCommentEscapes(block.comment)]);
  return [
    passage,
    kindleNoteKey(passage, words),
    ...[...comments].flatMap((comment) => kindleNoteKeysOfRuns(passage, paragraphsOf(comment))),
  ];
}

/** The keys of the Kindle highlights the person removed from `text`, one tombstone each. */
function removedKeysOf(text: string, asin: string): KindleHighlightKey[] {
  return text.split('\n').flatMap((line) => {
    const tombstone = readKindleTombstone(line);
    return tombstone === null ? [] : [kindleKeyOfWordsHash({ asin, ...tombstone })];
  });
}

/**
 * The keys of the Kindle highlights and typed notes the literature note
 * `text` holds for the book `asin`: what a sync need not add again. A
 * passage tidied in the note keeps its key (the marker keeps Kindle's
 * words); a typed note edited in the note no longer reads as recorded, and
 * Kindle's words arrive once more, after it — never in place of it. A passage
 * the person removed counts as recorded, and so does every note typed on it
 * (`removedKindleKey`): a removed highlight stays removed.
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
  for (const passage of removedKeysOf(text, asin)) {
    keys.add(passage);
    keys.add(removedKindleKey(passage));
  }
  return keys;
}

const PAGE_IN_FIGURES = /^[1-9]\d*$/;

/** Where a highlight is in the book, or null when it has neither a location nor a page in figures. */
function anchorOf(highlight: KindleHighlight, exact?: string): KindleAnchor | null {
  const page =
    highlight.page !== null && PAGE_IN_FIGURES.test(highlight.page)
      ? Number(highlight.page)
      : undefined;
  if (highlight.location === null && page === undefined) return null;
  return {
    kind: 'kindle',
    location: highlight.location === null ? null : { start: highlight.location, end: null },
    ...(page !== undefined && { page }),
    annotationId: highlight.annotationId,
    ...(exact !== undefined && { exact }),
  };
}

/** What names a highlight that cannot be placed in the message that says so. */
function unplacedPlace(highlight: KindleHighlight): string {
  return highlight.page === null ? 'an unknown place' : `page ${highlight.page}`;
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
function passageBlock(highlight: KindleHighlight, anchor: KindleAnchor): NewHighlight {
  return { quote: highlight.quote, anchor, style: styleOf(highlight) };
}

/** A note at a place with no passage as a block of its own: its words are its `exact`, so its key reads back. */
function noteBlock(highlight: KindleHighlight): NewHighlight | null {
  const note = highlight.note ?? '';
  const anchor = anchorOf(highlight, note);
  if (anchor === null) return null;
  return {
    quote: placeOfNote(highlight),
    anchor,
    style: DEFAULT_HIGHLIGHT_STYLE,
    comment: note,
  };
}

/** A highlight as the block it is written as; null when it has no place to be written at. */
function newBlockOf(highlight: KindleHighlight): NewHighlight | null {
  if (highlight.style === 'note') return noteBlock(highlight);
  const anchor = anchorOf(highlight);
  return anchor === null ? null : passageBlock(highlight, anchor);
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
  const text = withHighlightCommentAfter(args);
  return { text, added: text !== args.text };
}

/** Whether `highlight` is written at all: a typed note with no words (`noteHasWords`) is not. */
const isWritten = (highlight: KindleHighlight): boolean =>
  highlight.style !== 'note' || noteHasWords(highlight.note ?? '');

/** What a write of a book's Kindle highlights did to its note. */
export interface KindleNoteWrite {
  readonly text: string;
  /** How many entries changed the note. */
  readonly written: number;
  /** Where each highlight skipped for having no place the format holds was (`page xiv`). */
  readonly unplaced: readonly string[];
}

/**
 * The literature note `text` with a book's new Kindle highlights written in
 * (#508). Passages, and notes at a place with no passage, are blocks after
 * the last, ids drawn from `random`; a passage the note holds already is not
 * added again (`appendHighlights`). Then each typed note goes after its
 * passage's comment, as a paragraph of its own — the whole comment when it
 * has none — unless the comment holds it already; the comment's bytes are
 * kept. `written` is how many entries changed the note. A highlight with
 * neither a location nor a page in figures (a page `xiv`), and a note typed
 * on one, has no place the format holds: it is skipped and named in
 * `unplaced`, and the rest is written. Throws, writing nothing, what
 * `appendHighlights` and `withHighlightCommentAfter` throw, and
 * `KindlePassageGoneError` for a note whose passage is not in the note.
 */
export function withKindleHighlights(args: {
  readonly text: string;
  readonly asin: string;
  readonly highlights: readonly KindleHighlight[];
  readonly random: () => number;
  readonly noteBlocks: ReadNoteBlocks;
}): KindleNoteWrite {
  const { asin, noteBlocks } = args;
  const highlights = args.highlights.filter(isWritten);
  const held = blocksByPassage(args.text, asin, noteBlocks);
  const unplaced = new Map<string, string>();
  const blocks = highlights.flatMap((highlight) => {
    if (isFollowUp(highlight, held)) return [];
    const block = newBlockOf(highlight);
    if (block === null) unplaced.set(highlight.key, unplacedPlace(highlight));
    return block === null ? [] : [{ highlight, block }];
  });
  const appended = appendHighlights({
    text: args.text,
    highlights: blocks.map(({ block }) => block),
    random: args.random,
    noteBlocks,
  });
  const ids = new Map(held);
  blocks.forEach(({ highlight }, at) => {
    const answer = appended.highlights[at];
    if (answer !== undefined && highlight.style !== 'note') ids.set(highlight.key, answer.id);
  });
  let text = appended.text;
  let written = appended.highlights.filter((answer) => answer.added).length;
  const skipped: string[] = [];
  for (const highlight of highlights.filter((h) => isFollowUp(h, held))) {
    const passage = passageOf(highlight);
    const id = ids.get(passage);
    if (id === undefined && unplaced.has(passage)) {
      skipped.push(unplacedPlace(highlight));
      continue;
    }
    if (id === undefined) throw new KindlePassageGoneError();
    const followed = withFollowUp({ text, id, asin, note: highlight.note ?? '', noteBlocks });
    text = followed.text;
    if (followed.added) written += 1;
  }
  return { text, written, unplaced: [...unplaced.values(), ...skipped] };
}
