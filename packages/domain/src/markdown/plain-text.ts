import { wikiLinkLabel } from './wikilink.ts';
import { scanMarkdown } from './wikilink-spans.ts';

/**
 * A line of markdown as the words a person reads: what a card's summary shows.
 *
 * A summary is the opening line of a note, taken as written, so it carries the
 * note's markup — backticks round a file name, a `-` from a list, a link's URL.
 * On a card that markup is noise, so it is taken off and the words kept: a link
 * reads as its text, a wiki link as its label, code as the code.
 *
 * Deliberately a line-level cleaner, not a markdown parser: a summary is one
 * line, and a rule that mis-reads an odd construct costs a stray character on a
 * card, never a changed file.
 */
export function plainText(markdown: string): string {
  return REWRITES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    linksReadAndCommentsDropped(markdown),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Each wiki link as its label — its alias when it has one, else its target —
 * and each comment taken out, since a comment is hidden wherever markdown is
 * read (a bookmark's marker, say). Both are found by the one link grammar
 * (`scanMarkdown`), so `<!--` in code or in a link's name opens nothing.
 */
function linksReadAndCommentsDropped(markdown: string): string {
  const { links, comments } = scanMarkdown(markdown);
  const spans = [
    ...links.map(({ start, end, link }) => ({ start, end, text: wikiLinkLabel(link) })),
    ...comments.map(({ start, end }) => ({ start, end, text: '' })),
  ].sort((left, right) => left.start - right.start);
  let cursor = 0;
  let read = '';
  for (const { start, end, text } of spans) {
    read += markdown.slice(cursor, start) + text;
    cursor = end;
  }
  return read + markdown.slice(cursor);
}

/** Applied in order: the block markers first, then links, then inline marks. */
const REWRITES: readonly (readonly [RegExp, string])[] = [
  // Block markers at the start of a line: heading, quote, list item, task box.
  [/^[ \t]*#{1,6}[ \t]+/gm, ''],
  [/^[ \t]*(?:>[ \t]?)+/gm, ''],
  [/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/gm, ''],
  [/^[ \t]*\[[ xX]\][ \t]+/gm, ''],
  // An image reads as its description; a link as its text.
  [/!\[([^\]]*)\]\([^)]*\)/g, '$1'],
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'],
  // Code keeps its text and loses its fences.
  [/`+([^`]*)`+/g, '$1'],
  // Emphasis: strong before emphasis, so `**x**` is not read as two `*`.
  [/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2'],
  [/~~(?=\S)([\s\S]*?\S)~~/g, '$1'],
  [/\*(?=\S)([^*]*?\S)\*/g, '$1'],
  // Underscores only at word edges: `blocked_by` is a name, not emphasis.
  [/(^|\W)_(?=\S)([^_]*?\S)_(?=\W|$)/g, '$1$2'],
  // A mark whose other half was cut off with the rest of a long line.
  [/\*\*|~~/g, ''],
];
