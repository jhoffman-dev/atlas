import { blockIdAtEnd, newBlockId, standaloneBlockAnchor } from '../markdown/block-anchor.ts';
import { splitFrontmatter } from '../markdown/markdown-document.ts';
import {
  assertAnchor,
  DEFAULT_HIGHLIGHT_STYLE,
  highlightKey,
  InvalidHighlightAnchorError,
  kindlePlaceKey,
  type HighlightAnchor,
  type HighlightStyle,
  type KindleAnchor,
} from './anchor.ts';
import {
  commentBlockText,
  highlightBlockText,
  lineEndingOf,
  readHighlights,
  type HighlightBlock,
} from './highlight-block.ts';
import { looksLikeHighlightMarker, readHighlightMarker } from './highlight-marker.ts';
import { commentLines, plainQuote, quoteLines } from './highlight-text.ts';

/*
 * The writes a literature note takes (ADR-0043). Each changes only the bytes of
 * the highlight it is about — appending one adds text after the last byte,
 * a new comment replaces the comment's lines alone, a removal takes out its
 * block and the one blank line that parted it — so every other byte of the
 * note, the other highlights' quotes and comments included, stays as it was
 * (ADR-0003), however the person edited them.
 */

/** A highlight to add: the source's words, how it is drawn, where it is, and a first comment. */
export interface NewHighlight {
  /** The highlighted words, as the source gives them: text, not markdown. */
  readonly quote: string;
  readonly anchor: HighlightAnchor;
  readonly style?: HighlightStyle;
  /** The person's markdown; none when absent or blank. */
  readonly comment?: string;
}

/** What appending gave each highlight: the id it was written with, or the id it already had. */
export interface AppendedHighlight {
  readonly id: string;
  /** False when the note already held this passage (`highlightKey`), which was left as it was. */
  readonly added: boolean;
}

/** A highlight that is not in the note — never written, or removed since. */
export class HighlightNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`No highlight ^${id} is in this note any more.`);
    this.name = 'HighlightNotFoundError';
  }
}

/** The note holds a highlight marker this build cannot read, so it cannot tell what it already holds. */
export class UnreadableHighlightMarkerError extends Error {
  constructor(readonly line: number) {
    super(
      `Line ${line} of this note holds a highlight marker this version of DFAI cannot read ` +
        "(a newer version's, or one edited by hand). Highlights are not added until it is fixed or removed.",
    );
    this.name = 'UnreadableHighlightMarkerError';
  }
}

/** Highlights were appended that the note would not show: the note's own markdown hides them. */
export class HighlightNotReadBackError extends Error {
  constructor(readonly ids: readonly string[]) {
    super(
      'The note ends inside an unclosed code fence or HTML comment, which would hide ' +
        `the new highlight${ids.length === 1 ? '' : 's'} (${ids.map((id) => `^${id}`).join(', ')}). Nothing was written.`,
    );
    this.name = 'HighlightNotReadBackError';
  }
}

/**
 * The note with each highlight added at its end, in the order given, each
 * a block of its own after a blank line, with a new id drawn from `random`
 * (ADR-0022: six lower-case letters and digits, none the note already has).
 * A passage the note already holds — a sync run twice, the same words
 * highlighted again — is not added twice: its existing id is answered.
 * Throws, before anything is written: `InvalidHighlightAnchorError` for an
 * anchor the format would not read back or a quote with no words;
 * `UnreadableHighlightMarkerError` when the note holds a marker this build
 * cannot read, which may be a passage it would add twice;
 * `HighlightNotReadBackError` when a highlight added would not read back
 * from the note it was added to (an unclosed code fence or HTML comment).
 */
export function appendHighlights({
  text,
  highlights,
  random,
}: {
  text: string;
  highlights: readonly NewHighlight[];
  random: () => number;
}): { text: string; highlights: AppendedHighlight[] } {
  highlights.forEach(checkNewHighlight);
  assertMarkersReadable(text);
  const eol = lineEndingOf(text);
  const held = new HeldPassages();
  for (const block of readHighlights(text)) {
    held.add(block.id, block.anchor, plainQuote(block.quote));
  }
  const taken = blockIdsIn(text);
  let written = text;
  const answered = highlights.map((highlight): AppendedHighlight => {
    const anchor = exactWords(highlight);
    const existing = held.find(anchor, highlight.quote);
    if (existing !== undefined) return { id: existing, added: false };
    const id = newBlockId(random, taken);
    taken.add(id);
    held.add(id, anchor, highlight.quote);
    written = withBlockAppended(written, blockOf(id, highlight, anchor, eol), eol);
    return { id, added: true };
  });
  assertReadBack(
    written,
    answered.flatMap((entry) => (entry.added ? [entry.id] : [])),
  );
  return { text: written, highlights: answered };
}

/**
 * The passages a note holds, found by `highlightKey`; a Kindle one also by
 * its place and words, for an export that has an annotation id the copy
 * synced earlier lacked (or the reverse). Two different ids are two passages.
 */
class HeldPassages {
  private readonly byKey = new Map<string, string>();
  private readonly kindleByPlace = new Map<string, { id: string; annotationId: string | null }[]>();

  add(id: string, anchor: HighlightAnchor, quote: string): void {
    this.byKey.set(highlightKey(anchor, quote), id);
    if (anchor.kind !== 'kindle') return;
    const place = kindlePlaceKey(anchor, quote);
    const here = this.kindleByPlace.get(place) ?? [];
    here.push({ id, annotationId: anchor.annotationId });
    this.kindleByPlace.set(place, here);
  }

  find(anchor: HighlightAnchor, quote: string): string | undefined {
    const exact = this.byKey.get(highlightKey(anchor, quote));
    if (exact !== undefined || anchor.kind !== 'kindle') return exact;
    const here = this.kindleByPlace.get(kindlePlaceKey(anchor, quote)) ?? [];
    return here.find(
      (held) => held.annotationId === null || (anchor as KindleAnchor).annotationId === null,
    )?.id;
  }
}

/**
 * A Kindle anchor with the export's own words: the quote given, kept in the
 * marker as `exact`, so a later sync still knows the passage after the
 * person has tidied the quote. Other anchors already hold their words.
 */
function exactWords({ anchor, quote }: NewHighlight): HighlightAnchor {
  return anchor.kind === 'kindle' && anchor.exact === undefined
    ? { ...anchor, exact: quote }
    : anchor;
}

/** Throws unless every marker-looking line of `text` is one this build reads. */
function assertMarkersReadable(text: string): void {
  const lines = text.split('\n');
  lines.forEach((line, at) => {
    const content = line.replace(/\r$/, '').replace(/^[ \t]*>[ \t]?/, '');
    if (looksLikeHighlightMarker(content) && readHighlightMarker(content) === null) {
      throw new UnreadableHighlightMarkerError(at + 1);
    }
  });
}

/** Throws unless every id in `ids` is a highlight of `text`: a block that does not read back is lost. */
function assertReadBack(text: string, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const read = new Set(readHighlights(text).map((block) => block.id));
  const lost = ids.filter((id) => !read.has(id));
  if (lost.length > 0) throw new HighlightNotReadBackError(lost);
}

/** The note with the comment of highlight `id` made `comment`; blank takes the comment off. */
export function withHighlightComment({
  text,
  id,
  comment,
}: {
  text: string;
  id: string;
  comment: string;
}): string {
  const block = highlightNamed(text, id);
  const lines = commentBlockText(commentLines(comment), lineEndingOf(text));
  return text.slice(0, block.markerEnd) + lines + text.slice(block.quoteEnd);
}

/**
 * The note without highlight `id`: its block, and the blank line that parted
 * it from the block after it (or, last in the note, from the one before).
 * Only ever on the person's word: nothing removes a highlight by itself.
 */
export function withoutHighlight({ text, id }: { text: string; id: string }): string {
  const block = highlightNamed(text, id);
  const before = text.slice(0, block.start);
  const after = text.slice(block.end);
  const blank = /^[ \t]*\r?\n/.exec(after);
  if (blank !== null) return before + after.slice(blank[0].length);
  if (after !== '') return before + after;
  // A block written to a note with no final newline has none itself: the note gets back as it was.
  if (!text.endsWith('\n')) return before.replace(/\r?\n[ \t]*\r?\n$/, '');
  return before.replace(/\r?\n[ \t]*\r?\n$/, (ending) => ending.slice(0, ending.indexOf('\n') + 1));
}

/** The highlight with id `id`, the first if the note holds it twice; throws when there is none. */
export function highlightNamed(text: string, id: string): HighlightBlock {
  const block = readHighlights(text).find((candidate) => candidate.id === id);
  if (block === undefined) throw new HighlightNotFoundError(id);
  return block;
}

function checkNewHighlight(highlight: NewHighlight): void {
  assertAnchor(highlight.anchor);
  if (quoteLines(highlight.quote).length === 0) {
    throw new InvalidHighlightAnchorError('a highlight quotes some words');
  }
}

function blockOf(
  id: string,
  highlight: NewHighlight,
  anchor: HighlightAnchor,
  eol: '\n' | '\r\n',
): string {
  return highlightBlockText(
    {
      id,
      quoteLines: quoteLines(highlight.quote),
      commentLines: commentLines(highlight.comment ?? ''),
      style: highlight.style ?? DEFAULT_HIGHLIGHT_STYLE,
      anchor,
    },
    eol,
  );
}

/** `block` after the note's last byte, a blank line between it and what comes before. */
function withBlockAppended(text: string, block: string, eol: '\n' | '\r\n'): string {
  const ended = withLineEnded(text, eol);
  // A note that had no final newline keeps having none, so removing the block gives it back.
  const closed = ended === text || text === '' ? block : block.slice(0, -eol.length);
  if (splitFrontmatter(text).body.trim() === '') return ended + closed;
  return /\n[ \t]*\r?\n$/.test(ended) ? ended + closed : ended + eol + closed;
}

const withLineEnded = (text: string, eol: '\n' | '\r\n'): string =>
  text === '' || text.endsWith('\n') ? text : text + eol;

/**
 * Every id a line of the note could be read as giving a block — a little
 * more than the editor reads, since a line in code counts too, which only
 * ever rules out an id that was free.
 */
function blockIdsIn(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    const id = blockIdAtEnd(line)?.id ?? standaloneBlockAnchor(line.trim());
    if (id !== null) ids.add(id);
  }
  return ids;
}
