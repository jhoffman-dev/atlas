import { scanMarkdown } from '../markdown/wikilink-spans.ts';
import { WORD_CHARACTER } from './spelling.ts';
import type { Vocabulary, VocabularyEntry } from './vocabulary.ts';

/** One spelling put right: where it was in the text as it was, what was written, and what it is now. */
export interface TermChange {
  readonly start: number;
  readonly end: number;
  /** The words exactly as the text had them. */
  readonly from: string;
  readonly to: string;
}

export interface CorrectedText {
  readonly text: string;
  /** In the order they come in the text; none overlap. */
  readonly changes: readonly TermChange[];
}

/** What a span of text that is never corrected is written over with, one per UTF-16 unit. */
const MASK = '\u0000';

/**
 * What prose is read as: a run of letters, digits, marks and `_` (a word),
 * a run of spaces and tabs (the space between words, never a line break), or
 * any one other character. A spelling is read the same way, so the two meet.
 */
const TOKEN = /[\p{L}\p{N}\p{M}_]+|[^\S\r\n]+|[\s\S]/gu;

/** What joins two words into one thing — `a-b`, `a.b`, `a/b`, `a@b`, `a\b` — that is not two names. */
const JOINERS = new Set(['-', '.', '/', '@', '\\']);

/**
 * What is never corrected besides wiki links, comments and code, which the
 * markdown scanner finds: a markdown link `[text](target)` — a target may hold
 * balanced parentheses — or `<autolink>`, a bare URL, a `#tag` and a
 * `^block-id`. Each pattern stops at the next character that could start
 * another, so a line is read in linear time.
 */
const LITERAL_SPANS = [
  /!?\[[^[\]\n]*\]\((?:<[^<>\n]*>|(?:[^()\s]|\([^()\s]*\))*)(?:[ \t]+"[^"\n]*")?\)/g,
  /<[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*>/g,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]+/g,
  /(?<![\p{L}\p{N}_&#])#[\p{L}\p{N}_/-]+/gu,
  /\^[A-Za-z0-9-]+/g,
];

/**
 * The text with the vocabulary's misheard spellings put right (P28-06), and
 * each change made. Deterministic: the same text and vocabulary give the
 * same result on every Mac, in time linear in the text.
 *
 * - A spelling matches exactly as the term writes it, capitals included —
 *   `mark` is not `Mark` — as whole words, its words apart by any run of
 *   spaces or tabs, never across a line break. `Lark Spur Pay's` is corrected;
 *   `Lark Spurious` is not. A word joined to another by `-`, `.`, `/`, `@` or
 *   `\` (an email, a domain, a path, `quill-based`) is not a spelling on its
 *   own and is left alone.
 * - Where spellings overlap, the one starting first wins; at one start, the
 *   longer. The other is not read, so two spellings that run into each other
 *   (`Lark Spur` and `Spur Pay` in `Lark Spur Pay`) correct only the first.
 *   A right spelling matches too, and is left as written.
 * - A person's or company's name already right is left whole even where a
 *   line break or emphasis falls inside it: `**Mara** Quill`, `Mara⏎Quill`.
 * - Wiki links, markdown links, URLs, tags, code (spans and fenced blocks),
 *   comments and block ids are never changed.
 */
export function correctTerms(
  text: string,
  { entries }: Pick<Vocabulary, 'entries'>,
): CorrectedText {
  const matcher = matcherFor(entries);
  if (matcher === null) return { text, changes: [] };
  const masked = maskLiterals(text);
  const kept = protectedRanges(masked, matcher);
  const changes: TermChange[] = [];
  for (const { start, end, entry } of findSpellings(tokensOf(masked), matcher.all)) {
    const written = masked.slice(start, end);
    if (entry.canonical === written || overlapsAny(kept, start, end)) continue;
    changes.push({ start, end, from: written, to: entry.canonical });
  }
  return { text: applied(text, changes), changes };
}

/** Whether the vocabulary has a misheard spelling to put right, rather than only right ones. */
export function canCorrect({ entries }: Pick<Vocabulary, 'entries'>): boolean {
  return entries.some((entry) => entry.form !== entry.canonical);
}

/** The spellings to look for, and how long the longest starting with each word is. */
interface Lookup {
  readonly entries: ReadonlyMap<string, VocabularyEntry>;
  readonly longestFrom: ReadonlyMap<string, number>;
}

interface Matcher {
  /** Every spelling, right ones included. */
  readonly all: Lookup;
  /** The names of more than one word, looked for through line breaks and emphasis; null when none. */
  readonly names: Lookup | null;
}

/** One matcher per vocabulary, so a run over many sections builds its tables once. */
const matchers = new WeakMap<readonly VocabularyEntry[], Matcher | null>();

function matcherFor(entries: readonly VocabularyEntry[]): Matcher | null {
  if (!matchers.has(entries)) matchers.set(entries, buildMatcher(entries));
  return matchers.get(entries) ?? null;
}

function buildMatcher(entries: readonly VocabularyEntry[]): Matcher | null {
  // A spelling with no word in it, or holding the mask, could match what is never to be corrected.
  const usable = entries.filter(
    (entry) => WORD_CHARACTER.test(entry.form) && !entry.form.includes(MASK),
  );
  if (usable.length === 0) return null;
  const names = usable.filter(
    (entry) => entry.form === entry.canonical && entry.form.includes(' '),
  );
  return { all: lookupOf(usable), names: names.length === 0 ? null : lookupOf(names) };
}

function lookupOf(entries: readonly VocabularyEntry[]): Lookup {
  const byForm = new Map<string, VocabularyEntry>();
  const longestFrom = new Map<string, number>();
  for (const entry of entries) {
    const words = tokensOf(entry.form).map(spacedOnce);
    byForm.set(words.join(''), entry);
    const first = words[0] ?? '';
    longestFrom.set(first, Math.max(longestFrom.get(first) ?? 0, words.length));
  }
  return { entries: byForm, longestFrom };
}

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly isWord: boolean;
}

function tokensOf(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
    isWord: WORD_CHARACTER.test(match[0].charAt(0)),
  }));
}

/** A run of spaces and tabs is one space; anything else is as written. */
const spacedOnce = ({ text }: { text: string }) => (/^[^\S\r\n]+$/.test(text) ? ' ' : text);

interface Spelling {
  readonly start: number;
  readonly end: number;
  readonly entry: VocabularyEntry;
}

/**
 * Every spelling in the tokens, left to right: at each start the longest that
 * is whole, and the next look begins after it. Only a word some spelling
 * starts with is tried, and only as many tokens as the longest of those holds,
 * so a text is read in time linear in its length however many spellings there are.
 */
function findSpellings(tokens: readonly Token[], lookup: Lookup): Spelling[] {
  const found: Spelling[] = [];
  for (let from = 0; from < tokens.length; from += 1) {
    const first = tokens[from] as Token;
    const reach = lookup.longestFrom.get(first.text);
    if (reach === undefined) continue;
    let key = '';
    let best: { to: number; entry: VocabularyEntry } | null = null;
    for (let to = from; to < Math.min(tokens.length, from + reach); to += 1) {
      key += spacedOnce(tokens[to] as Token);
      const entry = lookup.entries.get(key);
      if (entry !== undefined && isWhole(tokens, from, to)) best = { to, entry };
    }
    if (best === null) continue;
    found.push({ start: first.start, end: (tokens[best.to] as Token).end, entry: best.entry });
    from = best.to;
  }
  return found;
}

/** Whether tokens `from` to `to` stand alone: no word touching either end, nor a joiner that makes one of an adjoining word. */
function isWhole(tokens: readonly Token[], from: number, to: number): boolean {
  return !touches(tokens, from, -1) && !touches(tokens, to, 1);
}

/** Whether the token past `edge` in `direction` is a word, or a joiner with a word beyond it. */
function touches(tokens: readonly Token[], edge: number, direction: -1 | 1): boolean {
  const next = tokens[edge + direction];
  if (next === undefined) return false;
  if (next.isWord) return true;
  return JOINERS.has(next.text) && tokens[edge + 2 * direction]?.isWord === true;
}

/**
 * Where a name of more than one word stands in the text even with a line
 * break or emphasis inside it: the text is read again with `*` and `~`
 * dropped and every run of white space one space.
 */
function protectedRanges(masked: string, matcher: Matcher): { start: number; end: number }[] {
  if (matcher.names === null) return [];
  const view: string[] = [];
  const origins: number[] = [];
  for (let at = 0; at < masked.length; at += 1) {
    const char = masked.charAt(at);
    if (char === '*' || char === '~') continue;
    const spacing = /\s/.test(char);
    if (spacing && view[view.length - 1] === ' ') continue;
    view.push(spacing ? ' ' : char);
    origins.push(at);
  }
  return findSpellings(tokensOf(view.join('')), matcher.names).map(({ start, end }) => ({
    start: origins[start] as number,
    end: (origins[end - 1] as number) + 1,
  }));
}

/** Whether `start` to `end` shares a character with one of the ranges, which are in order and apart. */
function overlapsAny(
  ranges: readonly { start: number; end: number }[],
  start: number,
  end: number,
): boolean {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((ranges[middle] as { end: number }).end <= start) low = middle + 1;
    else high = middle;
  }
  const next = ranges[low];
  return next !== undefined && next.start < end;
}

/** The text with every span that is never corrected written over, each unit by the mask. */
function maskLiterals(text: string): string {
  const { links, comments, code } = scanMarkdown(text);
  const spans = [...links, ...comments, ...code, ...literalSpans(text)].sort(
    (left, right) => left.start - right.start,
  );
  // Joined once rather than concatenated: a string built by many `+=` is a rope
  // that a Unicode pattern flattens again and again, which made a long text quadratic.
  const parts: string[] = [];
  let at = 0;
  for (const { start, end } of spans) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    parts.push(text.slice(at, from), MASK.repeat(end - from));
    at = end;
  }
  parts.push(text.slice(at));
  return parts.join('');
}

function literalSpans(text: string): { start: number; end: number }[] {
  return LITERAL_SPANS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
}

function applied(text: string, changes: readonly TermChange[]): string {
  const parts: string[] = [];
  let at = 0;
  for (const change of changes) {
    parts.push(text.slice(at, change.start), change.to);
    at = change.end;
  }
  parts.push(text.slice(at));
  return parts.join('');
}
