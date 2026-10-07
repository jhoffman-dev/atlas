import { scanMarkdown } from '../markdown/wikilink-spans.ts';

/** Where a run of markup is in a text: from `start`, up to but not including `end`. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/**
 * Markup whose `#` is never a tag: code, wiki links and embeds (`[[Page#Heading]]`,
 * `![[Page#^block]]`), markdown links and their anchors, URLs, HTML and comments.
 *
 * Each is found by a scan that looks at a character a bounded number of times,
 * so a long line — a pasted log, a minified file — costs time in proportion to
 * its length. Patterns with nested repetition backtrack quadratically on
 * unclosed brackets, and a line of them froze the editor for seconds.
 */
const SHIELDS: readonly ((text: string) => Span[])[] = [
  codeSpans,
  wikiLinksAndComments,
  markdownLinks,
  (text) => [...text.matchAll(/\b(?:https?|ftp|mailto|file):[^\s)>\]]+/g)].map(spanOf),
  (text) => [...text.matchAll(/\bwww\.[^\s)>\]]+/g)].map(spanOf),
  // `<` may not recur inside a tag, which keeps every `<` scanning only to the next one.
  (text) => [...text.matchAll(/<[^<>\n]+>/g)].map(spanOf),
];

/** Every shielded span in `text`, in order, overlapping ones merged. */
export function shieldedSpans(text: string): Span[] {
  const spans = SHIELDS.flatMap((find) => find(text)).sort(
    (left, right) => left.start - right.start,
  );
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last !== undefined && span.start < last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
    } else merged.push(span);
  }
  return merged;
}

function spanOf(match: RegExpMatchArray): Span {
  const start = match.index ?? 0;
  return { start, end: start + match[0].length };
}

/**
 * `` `code` ``, ``` ``co`de`` ```: a run of backticks closed by the next run of
 * the same length. A run with no partner is plain text.
 */
function codeSpans(text: string): Span[] {
  const runs = [...text.matchAll(/`+/g)].map(spanOf);
  // The next run of each length, found from the end in one pass.
  const next = new Array<number>(runs.length).fill(-1);
  const seen = new Map<number, number>();
  for (let at = runs.length - 1; at >= 0; at -= 1) {
    const run = runs[at] as Span;
    const length = run.end - run.start;
    next[at] = seen.get(length) ?? -1;
    seen.set(length, at);
  }
  const spans: Span[] = [];
  for (let at = 0; at < runs.length; at += 1) {
    const partner = next[at] as number;
    if (partner === -1) continue;
    spans.push({ start: (runs[at] as Span).start, end: (runs[partner] as Span).end });
    at = partner;
  }
  return spans;
}

/**
 * `[[Page]]`, `![[Page#Heading]]`, and `<!-- … -->`, read by the one link
 * grammar the editor reads (`scanMarkdown`): `\[[x #y]]` is no link, and a
 * `<!--` inside a link's name opens no comment.
 */
function wikiLinksAndComments(text: string): Span[] {
  const { links, comments } = scanMarkdown(text);
  return [...links, ...comments];
}

/**
 * `[text](target)`, `![alt](src)`. The text may not hold a `[` and the target
 * may not hold a `[` or `(`, so each scan stops at the next place a link could
 * start and no character is read by more than one.
 */
function markdownLinks(text: string): Span[] {
  return [...text.matchAll(/!?\[[^[\]\n]*\]\([^()[\n]*\)/g)].map(spanOf);
}
