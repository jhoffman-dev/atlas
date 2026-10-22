import { standaloneBlockAnchor } from '../markdown/block-anchor.ts';
import { splitFrontmatter } from '../markdown/markdown-document.ts';
import type { HighlightAnchor, HighlightStyle } from './anchor.ts';
import {
  highlightMarker,
  looksLikeHighlightMarker,
  readHighlightMarker,
} from './highlight-marker.ts';

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
 * The marker is what makes it a highlight and what parts the quote from the
 * comment: the lines before it are the quote, the lines after it the comment,
 * and the blank `>` line DFAI writes between marker and comment is only the
 * separator. A line without its `>` that continues a paragraph of the block
 * (CommonMark's lazy continuation, which Obsidian still shows as part of the
 * quote) belongs to the block; the next comment write puts its `>` back.
 * The block is read from its lines, not from how markdown parses it, as a
 * bookmark is (ADR-0020): a quote starting at a line's first column, after a
 * blank line or the start of the body, outside a code fence, holding exactly
 * one marker this build reads with words before it, then a blank line and
 * `^id`. Outside a code fence and an HTML comment, which hide what they hold
 * from every reader. Anything else is not a highlight and is kept exactly
 * as written.
 */

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

/** Every highlight in a note's text, in the order written. The frontmatter holds none. */
export function readHighlights(text: string): HighlightBlock[] {
  const lines = linesOf(text, splitFrontmatter(text).bodyOffset);
  const blocks: HighlightBlock[] = [];
  const hidden = new HiddenBlockTracker();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as Line;
    const opensQuote = isQuoteLine(line) && (index === 0 || isBlank(lines[index - 1]));
    if (hidden.inside(line) || !opensQuote) {
      index += 1;
      continue;
    }
    const after = quoteEnd(lines, index);
    const block = highlightOf(lines, index, after);
    if (block !== null) blocks.push(block);
    index = after;
  }
  return blocks;
}

/** Just past the last line of the quote block that starts at line `first`. */
function quoteEnd(lines: readonly Line[], first: number): number {
  let after = first;
  let paragraphOpen = false;
  while (after < lines.length) {
    const line = lines[after] as Line;
    const quoted = isQuoteLine(line);
    if (!quoted && !(paragraphOpen && continuesParagraph(line))) break;
    const content = quoted ? quoteContent(line.text) : line.text.replace(/\r$/, '');
    paragraphOpen = content.trim() !== '' && !looksLikeHighlightMarker(content);
    after += 1;
  }
  return after;
}

/** Whether an unquoted line is plain text, which a paragraph above it takes in, not a block of its own. */
const continuesParagraph = (line: Line): boolean =>
  line.text.trim() !== '' && !BLOCK_START.test(line.text);

const BLOCK_START = /^ {0,3}(?:[#>`~<]|[-*+](?:\s|$)|1[.)](?:\s|$)|(?:[-_*][ \t]*){3,}$|=+[ \t]*$)/;

/** The highlight the quote lines `[first, after)` and the lines below them make, or null. */
function highlightOf(lines: readonly Line[], first: number, after: number): HighlightBlock | null {
  const idLine = lines[after + 1];
  if (!isBlank(lines[after]) || idLine === undefined) return null;
  const id = standaloneBlockAnchor(idLine.text.replace(/\r$/, ''));
  if (id === null) return null;
  const contents = lines
    .slice(first, after)
    .map((line) => (isQuoteLine(line) ? quoteContent(line.text) : line.text.replace(/\r$/, '')));
  const markers = contents.flatMap((content, at) => {
    const marker = readHighlightMarker(content);
    return marker === null ? [] : [{ at, marker }];
  });
  if (markers.length !== 1) return null;
  const [{ at, marker }] = markers as [(typeof markers)[number]];
  const quote = trimBlankLines(contents.slice(0, at));
  if (quote === '') return null;
  return {
    id,
    quote,
    comment: trimBlankLines(contents.slice(at + 1)),
    ...marker,
    start: (lines[first] as Line).start,
    markerEnd: (lines[first + at] as Line).end,
    quoteEnd: (lines[after - 1] as Line).end,
    end: idLine.end,
  };
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

function linesOf(text: string, from: number): Line[] {
  const lines: Line[] = [];
  let start = from;
  while (start < text.length) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline + 1;
    lines.push({ text: text.slice(start, newline === -1 ? end : newline), start, end });
    start = end;
  }
  return lines;
}

const isQuoteLine = (line: Line): boolean => line.text.startsWith('>');

const isBlank = (line: Line | undefined): boolean => line !== undefined && line.text.trim() === '';

/** A quote line's own text: the `>`, and the one space after it, taken off. */
function quoteContent(line: string): string {
  const rest = line.replace(/\r$/, '').slice(1);
  return rest.startsWith(' ') ? rest.slice(1) : rest;
}

function trimBlankLines(lines: readonly string[]): string {
  let first = 0;
  let last = lines.length;
  while (first < last && lines[first]?.trim() === '') first += 1;
  while (last > first && lines[last - 1]?.trim() === '') last -= 1;
  return lines.slice(first, last).join('\n');
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const COMMENT_START = /^ {0,3}<!--/;

/**
 * Whether a line is inside a fenced code block or an HTML comment, where
 * nothing is a highlight. A fence or a comment nobody closed runs to the end
 * of the note, as every markdown reader has it.
 */
class HiddenBlockTracker {
  private fence: string | null = null;
  private inComment = false;

  /** True for the lines of a fence or a comment, its own and everything between. */
  inside(line: Line): boolean {
    if (this.inComment) {
      if (line.text.includes('-->')) this.inComment = false;
      return true;
    }
    return this.fence === null ? this.opens(line) : this.continuesFence(line);
  }

  private opens(line: Line): boolean {
    const run = FENCE.exec(line.text)?.[1];
    if (run !== undefined) {
      this.fence = run;
      return true;
    }
    if (!COMMENT_START.test(line.text)) return false;
    this.inComment = !line.text.slice(line.text.indexOf('<!--') + 4).includes('-->');
    return true;
  }

  private continuesFence(line: Line): true {
    const open = this.fence as string;
    const run = FENCE.exec(line.text)?.[1];
    const closes =
      run !== undefined &&
      run[0] === open[0] &&
      run.length >= open.length &&
      line.text.trim() === run;
    if (closes) this.fence = null;
    return true;
  }
}
