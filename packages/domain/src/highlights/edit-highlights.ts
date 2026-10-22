import { blockIdAtEnd, newBlockId, standaloneBlockAnchor } from '../markdown/block-anchor.ts';
import {
  assertAnchor,
  DEFAULT_HIGHLIGHT_STYLE,
  InvalidHighlightAnchorError,
  type HighlightAnchor,
  type HighlightStyle,
} from './anchor.ts';
import {
  bodyStartOf,
  commentBlockText,
  highlightBlockText,
  lineEndingOf,
  readHighlights,
  type HighlightBlock,
  type ReadNoteBlocks,
} from './highlight-block.ts';
import { looksLikeHighlightMarker, readHighlightMarker } from './highlight-marker.ts';
import { commentLines, plainQuote, quoteLines } from './highlight-text.ts';
import { matchPassages, type PassageMatch } from './passage-match.ts';

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

/** A write would leave highlights the note would not show: the note's own markdown would hide them. */
export class HighlightNotReadBackError extends Error {
  constructor(readonly ids: readonly string[]) {
    super(
      'The note would hide ' +
        `highlight${ids.length === 1 ? '' : 's'} ${ids.map((id) => `^${id}`).join(', ')} after this change, ` +
        'inside an unclosed code fence, HTML block or comment. Nothing was written.',
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
 * from the note it was added to, as `noteBlocks` parses it (an unclosed
 * code fence, raw HTML block, HTML comment or Obsidian `%%` comment).
 */
export function appendHighlights({
  text,
  highlights,
  random,
  noteBlocks,
}: {
  text: string;
  highlights: readonly NewHighlight[];
  random: () => number;
  noteBlocks: ReadNoteBlocks;
}): { text: string; highlights: AppendedHighlight[] } {
  const anchors = highlights.map(exactWords);
  highlights.forEach((highlight, at) =>
    checkNewHighlight(highlight, anchors[at] as HighlightAnchor),
  );
  assertMarkersReadable(text);
  const eol = lineEndingOf(text);
  const before = readHighlights(text, noteBlocks);
  const matches = passagesOf(before, highlights, anchors);
  const taken = blockIdsIn(text);
  const writtenIds = new Map<number, string>();
  let written = text;
  const answered = matches.map((match, at): AppendedHighlight => {
    if ('held' in match) return { id: match.held, added: false };
    let id = writtenIds.get(match.writer);
    if (id === undefined) {
      id = newBlockId(random, taken);
      taken.add(id);
      writtenIds.set(match.writer, id);
      const writer = highlights[match.writer] as NewHighlight;
      const block = blockOf(id, writer, anchors[match.writer] as HighlightAnchor, eol);
      written = withBlockAppended(written, block, eol);
    }
    return { id, added: match.writer === at };
  });
  assertReadBack({
    before,
    after: readHighlights(written, noteBlocks),
    added: [...writtenIds.values()],
    removed: null,
  });
  return { text: written, highlights: answered };
}

/** Which passage each highlight is, one the note holds `before` or one appended (ADR-0043 §7). */
function passagesOf(
  before: readonly HighlightBlock[],
  highlights: readonly NewHighlight[],
  anchors: readonly HighlightAnchor[],
): PassageMatch[] {
  return matchPassages(
    before.map((block) => ({ id: block.id, anchor: block.anchor, quote: plainQuote(block.quote) })),
    highlights.map((highlight, at) => ({
      anchor: anchors[at] as HighlightAnchor,
      quote: highlight.quote,
      written: JSON.stringify([anchors[at], highlight.quote, highlight.style, highlight.comment]),
    })),
  );
}

/**
 * A Kindle anchor with the export's own words: the quote given, kept in the
 * marker as `exact`, so a later sync still knows the passage after the
 * person has tidied the quote. An export that gave blank words gives none,
 * so the quote stands in for them too. Other anchors already hold their words.
 */
function exactWords({ anchor, quote }: NewHighlight): HighlightAnchor {
  return anchor.kind === 'kindle' && (anchor.exact === undefined || anchor.exact.trim() === '')
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

/**
 * Every write's postcondition (ADR-0043 §5): each highlight the note read
 * `before`, but the one `removed`, and each one `added`, reads back `after`.
 * A block that does not read back is lost to DFAI and hidden in Obsidian.
 */
function assertReadBack({
  before,
  after,
  added,
  removed,
}: {
  before: readonly HighlightBlock[];
  after: readonly HighlightBlock[];
  added: readonly string[];
  removed: string | null;
}): void {
  const read = new Set(after.map((block) => block.id));
  const kept = before.map((block) => block.id).filter((id) => id !== removed);
  const lost = [...new Set([...kept, ...added])].filter((id) => !read.has(id));
  if (lost.length > 0) throw new HighlightNotReadBackError(lost);
}

/**
 * The note with the comment of highlight `id` made `comment`; blank takes the
 * comment off. Throws `HighlightNotReadBackError`, writing nothing, when the
 * note would then hide a highlight it shows now.
 */
export function withHighlightComment({
  text,
  id,
  comment,
  noteBlocks,
}: {
  text: string;
  id: string;
  comment: string;
  noteBlocks: ReadNoteBlocks;
}): string {
  const before = readHighlights(text, noteBlocks);
  const block = namedIn(before, id);
  const lines = commentBlockText(commentLines(comment), lineEndingOf(text));
  const written = text.slice(0, block.markerEnd) + lines + text.slice(block.quoteEnd);
  assertReadBack({ before, after: readHighlights(written, noteBlocks), added: [], removed: null });
  return written;
}

/**
 * The note without highlight `id`: its block, and the blank line that parted
 * it from the block after it (or, last in the note, from the one before).
 * Only ever on the person's word: nothing removes a highlight by itself.
 * Throws `HighlightNotReadBackError`, writing nothing, when the note would
 * then hide another highlight it shows now.
 */
export function withoutHighlight({
  text,
  id,
  noteBlocks,
}: {
  text: string;
  id: string;
  noteBlocks: ReadNoteBlocks;
}): string {
  const blocks = readHighlights(text, noteBlocks);
  const written = textWithout(text, namedIn(blocks, id));
  assertReadBack({
    before: blocks,
    after: readHighlights(written, noteBlocks),
    added: [],
    removed: id,
  });
  return written;
}

function textWithout(text: string, block: HighlightBlock): string {
  const before = text.slice(0, block.start);
  const after = text.slice(block.end);
  const blank = /^[ \t]*\r?\n/.exec(after);
  if (blank !== null) return before + after.slice(blank[0].length);
  if (after !== '') return before + after;
  // A block written to a note with no final newline has none itself: the note gets back as it
  // was. Appended first in the body it followed only the line ending put after the frontmatter.
  if (!text.endsWith('\n')) {
    const first = bodyStartOf(text) === block.start;
    return before.replace(first ? /\r?\n$/ : /\r?\n[ \t]*\r?\n$/, '');
  }
  return before.replace(/\r?\n[ \t]*\r?\n$/, (ending) => ending.slice(0, ending.indexOf('\n') + 1));
}

/** The highlight with id `id`, the first if the note holds it twice; throws when there is none. */
export function highlightNamed(
  text: string,
  id: string,
  noteBlocks: ReadNoteBlocks,
): HighlightBlock {
  return namedIn(readHighlights(text, noteBlocks), id);
}

function namedIn(blocks: readonly HighlightBlock[], id: string): HighlightBlock {
  const block = blocks.find((candidate) => candidate.id === id);
  if (block === undefined) throw new HighlightNotFoundError(id);
  return block;
}

function checkNewHighlight(highlight: NewHighlight, anchor: HighlightAnchor): void {
  assertAnchor(anchor);
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

/**
 * `block` after the note's last byte, after a blank line of its own — never one
 * the note already ended in — so removing it takes out exactly what was added.
 * At the very start of the body no blank line is needed, and none is added.
 */
function withBlockAppended(text: string, block: string, eol: '\n' | '\r\n'): string {
  const ended = withLineEnded(text, eol);
  // A note that had no final newline keeps having none, so removing the block gives it back.
  const closed = ended === text || text === '' ? block : block.slice(0, -eol.length);
  return bodyStartOf(ended) === ended.length ? ended + closed : ended + eol + closed;
}

// A byte order mark alone is an empty note: the block goes straight after it.
const withLineEnded = (text: string, eol: '\n' | '\r\n'): string =>
  text.replace(/^\uFEFF/, '') === '' || text.endsWith('\n') ? text : text + eol;

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
