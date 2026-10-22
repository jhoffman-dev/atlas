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
 * `^id`. Outside a code fence, an HTML comment, a raw HTML block and an
 * Obsidian `%%` comment, which hide what they hold from every reader. Anything else is not a highlight and is kept exactly
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
    // Its lines are text, which can still open a `%%` comment that hides what follows.
    lines.slice(index + 1, after).forEach((quoted) => hidden.passText(quoted));
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
function continuesParagraph(line: Line): boolean {
  const text = line.text.replace(/\r$/, '');
  return text.trim() !== '' && !PARAGRAPH_INTERRUPTERS.some((start) => start.test(text));
}

/*
 * The lines that start a block of their own even straight after a paragraph's
 * line (CommonMark's "can interrupt a paragraph"); any other line is lazy
 * continuation text. A setext underline (`===`, `--`) is not among them: it
 * cannot be lazy, so it stays text, and `---` is a thematic break.
 */
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
/** A fence's opening line: a backtick fence's info string holds no backtick. */
const FENCE_OPEN = /^ {0,3}(?:`{3,}[^`]*|~{3,}.*)$/;
const QUOTE_START = /^ {0,3}>/;
/** A list item that may interrupt a paragraph: a bullet, or an ordered item numbered 1, with words. */
const INTERRUPTING_LIST_ITEM = /^ {0,3}(?:[-*+]|1[.)])[ \t]+\S/;
/** CommonMark HTML blocks 1 to 6; block 7 (any other tag, inline HTML, an autolink) cannot interrupt. */
const INTERRUPTING_HTML = new RegExp(
  '^ {0,3}<(?:(?:script|pre|style|textarea)(?:[ \\t>]|$)|!--|\\?|![A-Za-z]|!\\[CDATA\\[|' +
    '/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|' +
    'details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|' +
    'h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|' +
    'optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|' +
    'track|ul)(?:[ \\t]|/?>|$))',
  'i',
);
const PARAGRAPH_INTERRUPTERS = [
  ATX_HEADING,
  THEMATIC_BREAK,
  FENCE_OPEN,
  QUOTE_START,
  INTERRUPTING_LIST_ITEM,
  INTERRUPTING_HTML,
];

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
/** CommonMark HTML block 1: its lines are kept as raw HTML until one closes the tag. */
const RAW_HTML_START = /^ {0,3}<(?:pre|script|style|textarea)(?:[ \t>]|$)/i;
const RAW_HTML_END = /<\/(?:pre|script|style|textarea)>/i;
const LIST_MARKER = /^( *)([-*+]|\d{1,9}[.)])([ \t]+|$)/;

/** A fence or HTML block open on the lines so far, and what ends it. */
interface OpenBlock {
  /** Whether `text`, a line inside the block, is its last. */
  readonly endsAt: (text: string) => boolean;
  /** The content column of the list item it is in, or null outside one: the block ends with the item. */
  readonly item: number | null;
}

/**
 * Whether a line is inside a fenced code block, an HTML comment, a raw HTML
 * block (`<pre>`, `<script>`, `<style>`, `<textarea>`) or an Obsidian `%%`
 * comment, where nothing is a highlight. One nobody closed runs to the end of
 * the note, as every markdown reader has it — except that a fence or HTML
 * block opened in a list item ends when the item does (CommonMark's container
 * rule): at the first non-blank line indented less than the item's content.
 */
class HiddenBlockTracker {
  private open: OpenBlock | null = null;
  private obsidianComment = false;
  /** The content column of the list item the lines are in, or null. */
  private item: number | null = null;

  /** True for the lines of a hidden block, its own and everything between. */
  inside(line: Line): boolean {
    const text = line.text.replace(/\r$/, '');
    if (this.obsidianComment) {
      if (togglesObsidianComment(text)) this.obsidianComment = false;
      return true;
    }
    if (this.open !== null && !this.leavesItem(this.open.item, text)) {
      if (this.open.endsAt(this.withinItem(this.open.item, text))) this.open = null;
      return true;
    }
    this.open = null;
    this.followItem(text);
    return this.opens(text);
  }

  /** Takes in a line known to be paragraph text, outside any hidden block. */
  passText(line: Line): void {
    const text = line.text.replace(/\r$/, '');
    if (this.leavesItem(this.item, text)) this.item = null;
    if (togglesObsidianComment(text)) this.obsidianComment = !this.obsidianComment;
  }

  private opens(text: string): boolean {
    const content = this.withinItem(this.item, text);
    const item = this.item;
    const run = FENCE_OPEN.test(content) ? FENCE.exec(content)?.[1] : undefined;
    if (run !== undefined) {
      this.open = { endsAt: (inner) => closesFence(inner, run), item };
      return true;
    }
    if (togglesObsidianComment(text)) {
      this.obsidianComment = true;
      return true;
    }
    if (COMMENT_START.test(content)) {
      this.openUnlessClosed(content.slice(content.indexOf('<!--') + 4), (inner) =>
        inner.includes('-->'),
      );
      return true;
    }
    if (RAW_HTML_START.test(content)) {
      this.openUnlessClosed(content, (inner) => RAW_HTML_END.test(inner));
      return true;
    }
    return false;
  }

  private openUnlessClosed(rest: string, endsAt: (text: string) => boolean): void {
    if (!endsAt(rest)) this.open = { endsAt, item: this.item };
  }

  /** Follows list items: one starts at its marker and ends at a line indented less than its content. */
  private followItem(text: string): void {
    const marker = THEMATIC_BREAK.test(text) ? null : LIST_MARKER.exec(text);
    const indent = marker?.[1]?.length ?? 0;
    if (marker !== null && indent < (this.item ?? 0) + 4) {
      const spaces = marker[3] as string;
      const gap = spaces.length === 0 || spaces.length > 4 ? 1 : spaces.length;
      this.item = indent + (marker[2] as string).length + gap;
    } else if (this.leavesItem(this.item, text)) {
      this.item = null;
    }
  }

  private leavesItem(item: number | null, text: string): boolean {
    return item !== null && text.trim() !== '' && indentOf(text) < item;
  }

  /** The line as its list item's content sees it: the item's indent, or its marker, taken off. */
  private withinItem(item: number | null, text: string): string {
    const inItem = item !== null && (indentOf(text) >= item || LIST_MARKER.test(text));
    return inItem ? text.slice(item) : text;
  }
}

function closesFence(text: string, open: string): boolean {
  const run = FENCE.exec(text)?.[1];
  return (
    run !== undefined && run[0] === open[0] && run.length >= open.length && text.trim() === run
  );
}

/** Whether a line opens or closes an Obsidian `%%` comment: an odd number of `%%` outside HTML comments and code. */
function togglesObsidianComment(text: string): boolean {
  const visible = text.replace(/<!--.*?(?:-->|$)/g, '').replace(/`[^`]*`/g, '');
  return ((visible.match(/%%/g) ?? []).length & 1) === 1;
}

const indentOf = (text: string): number => /^ */.exec(text)?.[0].length ?? 0;
