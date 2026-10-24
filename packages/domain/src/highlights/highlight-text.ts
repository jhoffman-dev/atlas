import { escapeUnbalancedMarks } from './comment-marks.ts';
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
 * second marker is escaped, so the block stays one highlight; so is a `%%`
 * that would leave an Obsidian comment open past the comment's own text (an
 * unbalanced one outside code, as `%\%`), so a comment never hides the rest
 * of the note. Markdown that holds neither — a balanced `%%private%%`, code
 * with a `%%` in it — is kept as written, so a comment written back as it
 * reads is the same bytes.
 */
export function commentLines(comment: string): string[] {
  const lines = comment.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && lines[0]?.trim() === '') lines.shift();
  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop();
  return escapeUnbalancedMarks(lines).map((line) =>
    looksLikeHighlightMarker(line) ? line.replace('<', '\\<') : line,
  );
}

/** One quote line's `>`, and the space after it. */
const QUOTE_MARK = /^ {0,3}>[ \t]?/;

/**
 * A highlight block's markdown as a plain quote (#534): its words and its
 * comment as they are written, its marker line taken out, and the blank
 * quote lines that leaves at either edge. A copy pasted is no second
 * highlight of the passage. `''` when nothing is left to show; null when the
 * block holds no marker, so is no highlight.
 */
export function highlightAsPlainQuote(markdown: string): string | null {
  const lines = markdown.split('\n');
  const shown = (line: string) => line.replace(/\r$/, '').replace(QUOTE_MARK, '');
  const kept = lines.filter((line) => !looksLikeHighlightMarker(shown(line)));
  if (kept.length === lines.length) return null;
  while (kept.length > 0 && shown(kept[0] ?? '').trim() === '') kept.shift();
  while (kept.length > 0 && shown(kept.at(-1) ?? '').trim() === '') kept.pop();
  return kept.join('\n');
}

/**
 * A comment as it was before {@link commentLines} escaped it: the `%\%` it
 * wrote for an unbalanced `%%` made `%%` again, and the `\<` it put before a
 * line that would read as a marker, `<`. For telling a comment DFAI wrote
 * from the words it was written from; a person's own `%\%` reads the same.
 */
export function undoCommentEscapes(comment: string): string {
  return comment
    .replace(/%(?:\\%)+/g, (run) => '%'.repeat((run.length - 1) / 2 + 1))
    .split('\n')
    .map((line) => {
      const unescaped = line.replace('\\<', '<');
      return looksLikeHighlightMarker(unescaped) ? unescaped : line;
    })
    .join('\n');
}

/**
 * Whether a comment the editor started from is the one the file holds: both
 * as the file would hold them, so a comment typed with a new `%%` matches the
 * `%\%` written from it, and one shown as written (escapes visible) matches
 * itself — `commentLines` leaves a comment it wrote as it is.
 */
export function sameComment(typed: string, written: string): boolean {
  return commentLines(typed).join('\n') === commentLines(written).join('\n');
}

function paragraphsOf(words: string): string[] {
  return words
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph !== '');
}
