import type { NoteBlocks, QuoteBlockSpan, TextSpan } from '../highlights/highlight-block.ts';
import { splitFrontmatter } from '../markdown/markdown-document.ts';

/**
 * A stand-in for the markdown port's `noteBlocks`, for tests of the rules that
 * read highlights out of a note: a top-level quote is a run of lines starting
 * with `>`, at the start of the body or after a blank line; the paragraph after
 * it is the run of non-blank lines that follows; nothing is hidden. Right for
 * notes written the way DFAI writes them. Every other shape is the parser's to
 * read, and is tested against it (`noteBlocks` in packages/adapters).
 */
export function lineNoteBlocks(text: string): NoteBlocks {
  const lines = linesFrom(text, splitFrontmatter(text).bodyOffset);
  const quotes: QuoteBlockSpan[] = [];
  let at = 0;
  while (at < lines.length) {
    const opens = isQuote(lines[at]) && (at === 0 || isBlank(lines[at - 1]));
    if (!opens) {
      at += 1;
      continue;
    }
    const first = at;
    while (isQuote(lines[at])) at += 1;
    quotes.push({
      start: (lines[first] as TextSpan).start,
      end: (lines[at - 1] as TextSpan).end,
      paragraphAfter: paragraphAt(lines, at + 1),
    });
  }
  return { quotes, hidden: [] };
}

interface Line extends TextSpan {
  readonly text: string;
}

function paragraphAt(lines: readonly Line[], from: number): TextSpan | null {
  const first = lines[from];
  if (first === undefined || !isBlank(lines[from - 1]) || isBlank(first) || isQuote(first)) {
    return null;
  }
  let last = from;
  while (lines[last + 1] !== undefined && !isBlank(lines[last + 1])) last += 1;
  return { start: first.start, end: (lines[last] as Line).end };
}

/** Each line from `from`, its span ending before its line ending, as the parser's would. */
function linesFrom(text: string, from: number): Line[] {
  const lines: Line[] = [];
  for (let start = from; start < text.length;) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    const own = text.slice(start, end);
    lines.push({ text: own, start, end: own.endsWith('\r') ? end - 1 : end });
    start = end + 1;
  }
  return lines;
}

const isQuote = (line: Line | undefined): boolean => line?.text.startsWith('>') ?? false;

const isBlank = (line: Line | undefined): boolean => line !== undefined && line.text.trim() === '';
