import type { TextQuoteSelector } from './anchor.ts';

/*
 * Finding a highlight again by its words (ADR-0043). A file downloaded again,
 * or another edition's text layer, moves pages and breaks a CFI but keeps the
 * words, so the words are looked for first and the old place only decides
 * which copy is meant. Whitespace is compared loosely — a PDF's line breaks
 * and an EPUB's indentation come and go — and nothing else is: a quote whose
 * words changed is not found, rather than found somewhere it is not.
 */

/** Where a quote is in a text: `[start, end)` in the text as given. */
export interface QuoteMatch {
  readonly start: number;
  readonly end: number;
}

/** A quote found among a document's sections (a PDF's pages, an EPUB's chapters). */
export interface SectionMatch extends QuoteMatch {
  /** Which section, from 0. */
  readonly section: number;
}

/** How much text either side of a passage its selector keeps. */
export const QUOTE_CONTEXT = 32;

/**
 * The selector for `[start, end)` of `text`: its words, and up to
 * `QUOTE_CONTEXT` characters either side, as a reader makes a new anchor.
 */
export function quoteSelectorAt({
  text,
  start,
  end,
}: {
  text: string;
  start: number;
  end: number;
}): TextQuoteSelector {
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - QUOTE_CONTEXT), start),
    suffix: text.slice(end, end + QUOTE_CONTEXT),
  };
}

/**
 * Where `selector`'s words are in `text`, or null when they are not, or when
 * two or more copies match their surroundings (`prefix` and `suffix`) equally
 * well: changed words are not found rather than found in the wrong place.
 * Whitespace at either end of `exact` is taken as part of the surroundings,
 * so a selection `quoteSelectorAt` took from a space finds its own copy.
 */
export function findQuote(text: string, selector: TextQuoteSelector): QuoteMatch | null {
  const folded = foldSpaces(text);
  const exact = foldSpaces(selector.exact).text.trim();
  if (exact === '') return null;
  const leading = /^\s*/.exec(selector.exact)?.[0] ?? '';
  const trailing = /\s*$/.exec(selector.exact)?.[0] ?? '';
  const prefix = foldSpaces(selector.prefix + leading).text;
  const suffix = foldSpaces(trailing + selector.suffix).text;
  const around = { prefix: selector.prefix + leading, suffix: trailing + selector.suffix };
  let best: { at: number; score: number; exactScore: number; tied: boolean } | null = null;
  for (let at = folded.text.indexOf(exact); at !== -1; at = folded.text.indexOf(exact, at + 1)) {
    const score =
      commonSuffix(folded.text, at, prefix) + commonPrefix(folded.text, at + exact.length, suffix);
    const exactScore = surroundingsScore(text, rangeOf(folded, at, exact), around);
    const candidate = { at, score, exactScore, tied: false };
    if (best === null || beats(candidate, best)) best = candidate;
    else if (score === best.score && exactScore === best.exactScore) best.tied = true;
  }
  if (best === null || best.tied) return null;
  const { start, end } = rangeOf(folded, best.at, exact);
  return { start, end };
}

/** Whether `candidate` fits its surroundings better: loosely first, then to the letter, whitespace and all. */
const beats = (
  candidate: { score: number; exactScore: number },
  best: { score: number; exactScore: number },
): boolean =>
  candidate.score > best.score ||
  (candidate.score === best.score && candidate.exactScore > best.exactScore);

/** The match at `at` in the folded text, as `[start, end)` of the text as given. */
function rangeOf(folded: Folded, at: number, exact: string): QuoteMatch {
  const last = folded.origins[at + exact.length - 1] as number;
  return { start: folded.origins[at] as number, end: last + 1 };
}

/** How far the text either side of `range` matches the selector's, whitespace compared as written. */
function surroundingsScore(
  text: string,
  range: QuoteMatch,
  expected: { prefix: string; suffix: string },
): number {
  return (
    commonSuffix(text, range.start, expected.prefix) +
    commonPrefix(text, range.end, expected.suffix)
  );
}

/**
 * Where `selector`'s words are among `sections`, looked for in section `near`
 * first — the page or chapter the anchor last named — then outward from it,
 * nearer before farther and earlier before later. Null when no section has
 * them. `near` is made a section index first: a fraction rounds down, one
 * out of range or not a number is the nearest end (the first for NaN).
 */
export function findQuoteNear({
  sections,
  selector,
  near,
}: {
  sections: readonly string[];
  selector: TextQuoteSelector;
  near: number;
}): SectionMatch | null {
  for (const section of outwardFrom(near, sections.length)) {
    const match = findQuote(sections[section] as string, selector);
    if (match !== null) return { section, ...match };
  }
  return null;
}

/** Every index of `count`, `near` first, then by distance from it, the earlier of two first. */
function outwardFrom(near: number, count: number): number[] {
  const start = Math.min(Math.max(Number.isNaN(near) ? 0 : Math.floor(near), 0), count - 1);
  const order: number[] = [];
  for (let distance = 0; order.length < count; distance += 1) {
    if (start - distance >= 0 && distance > 0) order.push(start - distance);
    if (start + distance < count) order.push(start + distance);
  }
  return order;
}

interface Folded {
  readonly text: string;
  readonly origins: number[];
}

/** `text` with every run of whitespace one space, and where each character came from. */
function foldSpaces(text: string): Folded {
  let folded = '';
  const origins: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    const space = /\s/.test(char);
    if (space && folded.endsWith(' ')) continue;
    folded += space ? ' ' : char;
    origins.push(index);
  }
  return { text: folded, origins };
}

/** How many characters before `end` in `text` are the last ones of `expected`. */
function commonSuffix(text: string, end: number, expected: string): number {
  let count = 0;
  while (
    count < end &&
    count < expected.length &&
    text[end - 1 - count] === expected[expected.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}

/** How many characters from `from` in `text` are the first ones of `expected`. */
function commonPrefix(text: string, from: number, expected: string): number {
  let count = 0;
  while (
    from + count < text.length &&
    count < expected.length &&
    text[from + count] === expected[count]
  ) {
    count += 1;
  }
  return count;
}
