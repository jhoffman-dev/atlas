import { scanMarkdown } from '../markdown/wikilink-spans.ts';
import { vocabularyKey } from './spelling.ts';
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

/** A letter, a digit, a combining mark or `_`: what a word is made of, so what a match may not touch. */
const WORDISH = /[\p{L}\p{N}\p{M}_]/u;
const BEFORE_BOUNDARY = '(?<![\\p{L}\\p{N}\\p{M}_])';
const AFTER_BOUNDARY = '(?![\\p{L}\\p{N}\\p{M}_])';
/** Space between the words of a spelling: any run of spaces or tabs, never a line break. */
const SPACE_BETWEEN = '[^\\S\\r\\n]+';

/**
 * What is never corrected besides wiki links, comments and code, which the
 * markdown scanner finds: a markdown link `[text](target)` or `<autolink>`,
 * a bare URL, a `#tag` and a `^block-id`. Each pattern stops at the next
 * character that could start another, so a line is read in linear time.
 */
const LITERAL_SPANS = [
  /!?\[[^[\]\n]*\]\((?:<[^<>\n]*>|[^()\s]*)(?:[ \t]+"[^"\n]*")?\)/g,
  /<[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]*>/g,
  /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>]+/g,
  /(?<![\p{L}\p{N}_&#])#[\p{L}\p{N}_/-]+/gu,
  /\^[A-Za-z0-9-]+/g,
];

/**
 * The text with the vocabulary's misheard spellings put right (P28-06), and
 * each change made. Deterministic: the same text and vocabulary give the
 * same result on every Mac.
 *
 * - A spelling matches as whole words — never inside a longer word — however
 *   it is cased, its words apart by any run of spaces or tabs, never across
 *   a line break. `Lark Spur Pay's` is corrected; `Lark Spurious` is not.
 * - Where spellings overlap, the one starting first wins; at one start, the
 *   longer (the vocabulary's order). A right spelling matches too, and is
 *   left as written, so a variant inside a name already right is not touched.
 * - The right spelling is written as the vocabulary writes it, but in
 *   capitals where the text shouts a spelling the vocabulary does not.
 * - Wiki links, markdown links, URLs, tags, code (spans and fenced blocks),
 *   comments and block ids are never changed.
 */
export function correctTerms(
  text: string,
  { entries }: Pick<Vocabulary, 'entries'>,
): CorrectedText {
  const matcher = matcherFor(entries);
  if (matcher === null) return { text, changes: [] };
  const changes: TermChange[] = [];
  for (const match of maskLiterals(text).matchAll(matcher.pattern)) {
    const written = match[0];
    const entry = matcher.byKey.get(vocabularyKey(written));
    if (entry === undefined || isRightSpelling(entry)) continue;
    const to = spelledLike(entry, written);
    if (to === written) continue;
    changes.push({ start: match.index, end: match.index + written.length, from: written, to });
  }
  return { text: applied(text, changes), changes };
}

interface Matcher {
  readonly pattern: RegExp;
  readonly byKey: ReadonlyMap<string, VocabularyEntry>;
}

/** One matcher per vocabulary, so a run over many sections builds its pattern once. */
const matchers = new WeakMap<readonly VocabularyEntry[], Matcher | null>();

function matcherFor(entries: readonly VocabularyEntry[]): Matcher | null {
  if (!matchers.has(entries)) matchers.set(entries, buildMatcher(entries));
  return matchers.get(entries) ?? null;
}

function buildMatcher(entries: readonly VocabularyEntry[]): Matcher | null {
  // A spelling holding the mask could match what is never to be corrected.
  const usable = entries.filter((entry) => entry.form !== '' && !entry.form.includes(MASK));
  if (usable.length === 0) return null;
  const alternatives = usable.map((entry) => spellingPattern(entry.form));
  return {
    pattern: new RegExp(alternatives.join('|'), 'giu'),
    byKey: new Map(usable.map((entry) => [vocabularyKey(entry.form), entry])),
  };
}

/** A spelling as a pattern: its words apart by any spaces, bounded where it starts or ends a word. */
function spellingPattern(form: string): string {
  const words = form.split(' ').map(escapeForPattern).join(SPACE_BETWEEN);
  const before = WORDISH.test(form.charAt(0)) ? BEFORE_BOUNDARY : '';
  const after = WORDISH.test(form.charAt(form.length - 1)) ? AFTER_BOUNDARY : '';
  return `${before}${words}${after}`;
}

/** Escapes what a `u` pattern reads as syntax — and nothing else, which it would refuse. */
const escapeForPattern = (text: string) => text.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

const isRightSpelling = (entry: VocabularyEntry) =>
  vocabularyKey(entry.form) === vocabularyKey(entry.canonical);

/** Whether text is written in capitals: two or more cased letters, none of them small. */
function isShouted(text: string): boolean {
  const cased = [...text].filter((char) => char.toLowerCase() !== char.toUpperCase());
  return cased.length >= 2 && text === text.toUpperCase();
}

function spelledLike(entry: VocabularyEntry, written: string): string {
  return isShouted(written) && !isShouted(entry.form)
    ? entry.canonical.toUpperCase()
    : entry.canonical;
}

/** The text with every span that is never corrected written over, each unit by the mask. */
function maskLiterals(text: string): string {
  const { links, comments, code } = scanMarkdown(text);
  const spans = [...links, ...comments, ...code, ...literalSpans(text)].sort(
    (left, right) => left.start - right.start,
  );
  let masked = '';
  let at = 0;
  for (const { start, end } of spans) {
    if (end <= at) continue;
    const from = Math.max(start, at);
    masked += text.slice(at, from) + MASK.repeat(end - from);
    at = end;
  }
  return masked + text.slice(at);
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
  let result = '';
  let at = 0;
  for (const change of changes) {
    result += text.slice(at, change.start) + change.to;
    at = change.end;
  }
  return result + text.slice(at);
}
