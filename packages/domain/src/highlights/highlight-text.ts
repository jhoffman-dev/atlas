import { looksLikeHighlightMarker } from './highlight-marker.ts';

/*
 * The visible words of a highlight block: its quote, which DFAI writes from
 * the source's text, and its comment, which is the person's markdown.
 *
 * Words from a book are text, not markdown, so the quote is escaped where
 * markdown or Obsidian would read them as something else: `*` as emphasis,
 * `#word` as a tag, `==` as a highlight, `%%` as a comment, `^id` as a block
 * id, `- ` or `1. ` at a line's start as a list, `---` as a rule. Each
 * paragraph is one line, since a PDF's line breaks are where its page ran
 * out, not the author's.
 */

const ESCAPED = /[\\`*_[\]<>#~|^=$%&]/g;
const LIST_START = /^([-+])|^(\d+)([.)])(?=\s|$)/;
const UNESCAPE = /\\([!-/:-@[-`{-~])/g;

/** The lines of a quote written from the source's words, `>` not yet before them. */
export function quoteLines(words: string): string[] {
  return paragraphsOf(words).map((paragraph) =>
    paragraph.replace(ESCAPED, '\\$&').replace(LIST_START, '$2\\$1$3'),
  );
}

/**
 * The words a quote's markdown shows, its escapes taken off and its lines
 * joined: what the index stores and search reads.
 */
export function plainQuote(markdown: string): string {
  return markdown.replace(UNESCAPE, '$1');
}

/**
 * The lines of a comment, as the person's markdown: line endings made one
 * kind, the blank lines at either end taken off. A line that would read as a
 * second marker is escaped, so the block stays one highlight.
 */
export function commentLines(comment: string): string[] {
  const lines = comment.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop();
  return lines.map((line) => (looksLikeHighlightMarker(line) ? line.replace('<', '\\<') : line));
}

function paragraphsOf(words: string): string[] {
  return words
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph !== '');
}
