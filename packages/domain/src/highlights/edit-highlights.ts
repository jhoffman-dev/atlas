import { blockIdAtEnd, newBlockId, standaloneBlockAnchor } from '../markdown/block-anchor.ts';
import { splitFrontmatter } from '../markdown/markdown-document.ts';
import {
  assertAnchor,
  DEFAULT_HIGHLIGHT_STYLE,
  highlightKey,
  InvalidHighlightAnchorError,
  type HighlightAnchor,
  type HighlightStyle,
} from './anchor.ts';
import {
  commentBlockText,
  highlightBlockText,
  lineEndingOf,
  readHighlights,
  type HighlightBlock,
} from './highlight-block.ts';
import { commentLines, plainQuote, quoteLines } from './highlight-text.ts';

/*
 * The writes a source note takes (ADR-0043). Each changes only the bytes of
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

/**
 * The note with each highlight added at its end, in the order given, each
 * a block of its own after a blank line, with a new id drawn from `random`
 * (ADR-0022: six lower-case letters and digits, none the note already has).
 * A passage the note already holds — a sync run twice, the same words
 * highlighted again — is not added twice: its existing id is answered.
 * Throws `InvalidHighlightAnchorError` for an anchor the format would not
 * read back, or a quote with no words, before anything is written.
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
  const eol = lineEndingOf(text);
  const held = new Map(readHighlights(text).map((block) => [keyOfBlock(block), block.id]));
  const taken = blockIdsIn(text);
  let written = text;
  const answered = highlights.map((highlight): AppendedHighlight => {
    const key = highlightKey(highlight.anchor, highlight.quote);
    const existing = held.get(key);
    if (existing !== undefined) return { id: existing, added: false };
    const id = newBlockId(random, taken);
    taken.add(id);
    held.set(key, id);
    written = withBlockAppended(written, blockOf(id, highlight, eol), eol);
    return { id, added: true };
  });
  return { text: written, highlights: answered };
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

function blockOf(id: string, highlight: NewHighlight, eol: '\n' | '\r\n'): string {
  return highlightBlockText(
    {
      id,
      quoteLines: quoteLines(highlight.quote),
      commentLines: commentLines(highlight.comment ?? ''),
      style: highlight.style ?? DEFAULT_HIGHLIGHT_STYLE,
      anchor: highlight.anchor,
    },
    eol,
  );
}

const keyOfBlock = (block: HighlightBlock): string =>
  highlightKey(block.anchor, plainQuote(block.quote));

/** `block` after the note's last byte, a blank line between it and what comes before. */
function withBlockAppended(text: string, block: string, eol: '\n' | '\r\n'): string {
  if (splitFrontmatter(text).body.trim() === '') return withLineEnded(text, eol) + block;
  const ended = withLineEnded(text, eol);
  return /\n[ \t]*\r?\n$/.test(ended) ? ended + block : ended + eol + block;
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
