import { standaloneBlockAnchor } from '../markdown/block-anchor.ts';
import { splitFrontmatter } from '../markdown/markdown-document.ts';
import type { HighlightAnchor, HighlightStyle } from './anchor.ts';
import { highlightMarker, readHighlightMarker } from './highlight-marker.ts';

/*
 * A highlight in its literature note (ADR-0043): a quote, the hidden marker, the
 * person's comment, all one quote block, and the block's Obsidian id on a
 * line of its own after it, a blank line between (ADR-0022):
 *
 *     > It is a truth universally acknowledged, that a single man in
 *     > possession of a good fortune, must be in want of a wife.
 *     > <!-- atlas:highlight {"v":1,…} -->
 *     >
 *     > The irony starts in the first line.
 *
 *     ^k3x9q2
 *
 * Which lines make a quote block, and which the note hides, is the markdown
 * parser's to say, not this module's: it is handed them as `NoteBlocks`,
 * worked out by the same parser that renders the note, so DFAI, its index
 * and the editor agree on every note however it is written. Here only a
 * quote block's own lines are read. The marker is what makes it a highlight
 * and what parts the quote from the comment: the lines before it are the
 * quote, the lines after it the comment, and the blank `>` line DFAI writes
 * between marker and comment is only the separator. A line without its `>`
 * that the parser keeps in the block (CommonMark's lazy continuation, which
 * Obsidian shows as part of the quote) belongs to it; the next comment write
 * puts its `>` back. A block is a highlight when it holds exactly one marker
 * this build reads with words before it, a blank line and `^id` follow it,
 * and its first line is not in an Obsidian `%%` comment.
 * Anything else is not a highlight and is kept exactly as written.
 */

/** A stretch of a note's text, by offset into the whole note, frontmatter included. */
export interface TextSpan {
  readonly start: number;
  /** Just after its last character. */
  readonly end: number;
}

/** A block quote at the top level of a note's body, as the parser reads it. */
export interface QuoteBlockSpan extends TextSpan {
  /** The top-level paragraph straight after the quote; null when the next block is another kind, or there is none. */
  readonly paragraphAfter: TextSpan | null;
}

/** What the markdown parser says of a note's blocks that highlights are read from (ADR-0043 §2). */
export interface NoteBlocks {
  /** Every block quote at the top level of the body, in the order written; none in the frontmatter. */
  readonly quotes: readonly QuoteBlockSpan[];
  /** What Obsidian `%%` comments hide, in order; one never closed runs to the end of the note. */
  readonly hidden: readonly TextSpan[];
}

/** Works out a note's `NoteBlocks` from its whole text: the markdown port's `noteBlocks`. */
export type ReadNoteBlocks = (text: string) => NoteBlocks;

/** A highlight block as the note holds it, with where its parts are in the note's text. */
export interface HighlightBlock {
  readonly id: string;
  /** The quote's markdown as written, `>` taken off, its lines joined by `\n`. */
  readonly quote: string;
  /** The comment's markdown as written, `>` taken off; empty when there is none. */
  readonly comment: string;
  readonly style: HighlightStyle;
  readonly anchor: HighlightAnchor;
  /** Where the block's first line starts. */
  readonly start: number;
  /** Just after the marker's line: where the comment's lines would start. */
  readonly markerEnd: number;
  /** Just after the quote block's last line: where the comment's lines end. */
  readonly quoteEnd: number;
  /** Just after the id's line. */
  readonly end: number;
}

interface Line {
  /** The line without its ending. */
  readonly text: string;
  readonly start: number;
  /** Just after its ending. */
  readonly end: number;
}

/** Every highlight in a note's text, in the order written, read from the blocks `noteBlocks` finds. */
export function readHighlights(text: string, noteBlocks: ReadNoteBlocks): HighlightBlock[] {
  const { quotes, hidden } = noteBlocks(text);
  const shown = (offset: number) =>
    !hidden.some((span) => span.start <= offset && offset < span.end);
  return quotes.flatMap((quote) => {
    const block = highlightOf(text, quote, shown);
    return block === null ? [] : [block];
  });
}

/**
 * The highlight the quote block `quote` and the line after it make, or null;
 * null too when a `%%` comment hides its first line, so Obsidian shows no
 * quote there.
 */
function highlightOf(
  text: string,
  quote: QuoteBlockSpan,
  shown: (offset: number) => boolean,
): HighlightBlock | null {
  const lines = linesOf(text, lineStartAt(text, quote.start), quote.end);
  const first = lines[0] as Line;
  const quoteEnd = (lines.at(-1) as Line).end;
  const id = idAfter(text, quoteEnd, quote.paragraphAfter);
  if (id === null || !shown(first.start)) return null;
  const contents = lines.map((line) => quoteContent(line.text));
  const markers = contents.flatMap((content, at) => {
    const marker = readHighlightMarker(content);
    return marker === null ? [] : [{ at, marker }];
  });
  if (markers.length !== 1) return null;
  const [{ at, marker }] = markers as [(typeof markers)[number]];
  const words = trimBlankLines(contents.slice(0, at));
  if (words === '') return null;
  return {
    id: id.id,
    quote: words,
    comment: trimBlankLines(contents.slice(at + 1)),
    ...marker,
    start: first.start,
    markerEnd: (lines[at] as Line).end,
    quoteEnd,
    end: id.end,
  };
}

/**
 * The id the paragraph after a quote gives it (ADR-0022), and just after its
 * line: a paragraph of one line, `^id` alone, after exactly one blank line.
 */
function idAfter(
  text: string,
  quoteEnd: number,
  paragraph: TextSpan | null,
): { id: string; end: number } | null {
  if (paragraph === null) return null;
  const [line] = linesOf(text, lineStartAt(text, paragraph.start), paragraph.end);
  if (line === undefined || line.end < paragraph.end) return null;
  if (!/^[ \t]*\r?\n$/.test(text.slice(quoteEnd, line.start))) return null;
  const id = standaloneBlockAnchor(line.text);
  return id === null ? null : { id, end: line.end };
}

/** What a new highlight block is written from: its id, words, marker and comment. */
export interface HighlightBlockParts {
  readonly id: string;
  readonly quoteLines: readonly string[];
  readonly commentLines: readonly string[];
  readonly style: HighlightStyle;
  readonly anchor: HighlightAnchor;
}

/** A highlight block's text, ending in its line ending, in the note's own line ending. */
export function highlightBlockText(parts: HighlightBlockParts, eol: LineEnding): string {
  const quoted = parts.quoteLines.flatMap((line, at) => (at === 0 ? [line] : ['', line]));
  const lines = [...quoted, highlightMarker(parts)].map(quoteLine);
  return `${lines.join(eol)}${eol}${commentBlockText(parts.commentLines, eol)}${eol}^${parts.id}${eol}`;
}

/** The comment's lines as they follow the marker: a blank quote line, then each line quoted. */
export function commentBlockText(lines: readonly string[], eol: LineEnding): string {
  if (lines.length === 0) return '';
  return ['>', ...lines.map(quoteLine)].map((line) => `${line}${eol}`).join('');
}

export type LineEnding = '\n' | '\r\n';

/** The line ending a note is written in: Windows' when any line has it. */
export function lineEndingOf(text: string): LineEnding {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

const quoteLine = (line: string): string => (line === '' ? '>' : `> ${line}`);

/** The lines from `from`, a line's start, through the one `to` falls in, each without its `\r`. */
function linesOf(text: string, from: number, to: number): Line[] {
  const lines: Line[] = [];
  let start = from;
  while (start < text.length && (start < to || lines.length === 0)) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    const own = text.slice(start, newline === -1 ? end : newline);
    lines.push({ text: own.replace(/\r$/, ''), start, end });
    start = end;
  }
  return lines;
}

/** Where the line `offset` is in starts; a byte order mark before the first line is not the line's. */
function lineStartAt(text: string, offset: number): number {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  return start === 0 && text.startsWith(BYTE_ORDER_MARK) ? 1 : start;
}

const BYTE_ORDER_MARK = '\uFEFF';

/**
 * Where a note's body starts: after its frontmatter, or, with none, after a
 * byte order mark, which is the file's and not the body's, so no write moves
 * or removes it.
 */
export function bodyStartOf(text: string): number {
  const { frontmatter, bodyOffset } = splitFrontmatter(text);
  return frontmatter === null && text.startsWith(BYTE_ORDER_MARK) ? 1 : bodyOffset;
}

/**
 * A quote line's own text: its `>` — up to three spaces in, as CommonMark
 * allows — and the one space after it taken off. A lazy line, which has no
 * `>`, is its own text.
 */
function quoteContent(line: string): string {
  const quoted = /^ {0,3}> ?/.exec(line);
  return quoted === null ? line : line.slice(quoted[0].length);
}

function trimBlankLines(lines: readonly string[]): string {
  let first = 0;
  let last = lines.length;
  while (first < last && lines[first]?.trim() === '') first += 1;
  while (last > first && lines[last - 1]?.trim() === '') last -= 1;
  return lines.slice(first, last).join('\n');
}
