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
 * Where `selector`'s words are in `text`, or null when they are not. Of two
 * or more copies, the one whose surroundings match `prefix` and `suffix`
 * best; of equals, the first.
 */
export function findQuote(text: string, selector: TextQuoteSelector): QuoteMatch | null {
  const folded = foldSpaces(text);
  const exact = foldSpaces(selector.exact).text.trim();
  if (exact === '') return null;
  const prefix = foldSpaces(selector.prefix).text;
  const suffix = foldSpaces(selector.suffix).text;
  let best: { at: number; score: number } | null = null;
  for (let at = folded.text.indexOf(exact); at !== -1; at = folded.text.indexOf(exact, at + 1)) {
    const score =
      commonSuffix(folded.text.slice(0, at), prefix) +
      commonPrefix(folded.text.slice(at + exact.length), suffix);
    if (best === null || score > best.score) best = { at, score };
  }
  if (best === null) return null;
  const start = folded.origins[best.at] as number;
  const last = folded.origins[best.at + exact.length - 1] as number;
  return { start, end: last + 1 };
}

/**
 * Where `selector`'s words are among `sections`, looked for in section `near`
 * first — the page or chapter the anchor last named — then outward from it,
 * nearer before farther and earlier before later. Null when no section has them.
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
  const start = Math.min(Math.max(near, 0), count - 1);
  const order: number[] = [];
  for (let distance = 0; order.length < count; distance += 1) {
    if (start - distance >= 0 && distance > 0) order.push(start - distance);
    if (start + distance < count) order.push(start + distance);
  }
  return order;
}

/** `text` with every run of whitespace one space, and where each character came from. */
function foldSpaces(text: string): { text: string; origins: number[] } {
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

function commonSuffix(left: string, right: string): number {
  let count = 0;
  while (
    count < left.length &&
    count < right.length &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}

function commonPrefix(left: string, right: string): number {
  let count = 0;
  while (count < left.length && count < right.length && left[count] === right[count]) count += 1;
  return count;
}
