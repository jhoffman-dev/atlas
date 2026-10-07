/**
 * Splitting a query's text into tokens, each with its place in the text.
 *
 * Deliberately plain: words (keywords and names are both words — which one a
 * word is depends on where the parser finds it), numbers, quoted strings,
 * links, tags, `@dates` and a handful of symbols. Anything else is a problem
 * at the character that started it.
 */

import { splitWikiLinks } from '../markdown/wikilink.ts';
import { continuesTagSegment } from '../tags/tag-name.ts';
import type { Span } from './ast.ts';
import { QueryTextError } from './query-text-error.ts';

export type TokenKind = 'word' | 'number' | 'string' | 'link' | 'tag' | 'date' | 'symbol' | 'end';

export interface Token {
  readonly kind: TokenKind;
  /** What the token means: a string without its quotes, a link's target, a tag's name. */
  readonly text: string;
  readonly span: Span;
}

const SYMBOLS = ['!=', '<>', '<=', '>=', '=', '<', '>', '(', ')', ',', '.'] as const;

const WORD_CHAR = /[\p{L}\p{N}\p{M}_-]/u;
const WORD_START = /[\p{L}\p{N}_]/u;

/**
 * The character at `at`, whole: a letter outside the Basic Multilingual Plane
 * is two UTF-16 units, and testing either half alone reads it as nothing.
 */
function charAt(text: string, at: number): string {
  const point = text.codePointAt(at);
  return point === undefined ? '' : String.fromCodePoint(point);
}
const NUMBER = /^-?\d+(?:\.\d+)?/;

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at] ?? '';
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    const token = readToken(text, at);
    tokens.push(token);
    at = token.span.end;
  }
  tokens.push({ kind: 'end', text: '', span: { start: text.length, end: text.length } });
  return tokens;
}

function readToken(text: string, at: number): Token {
  const char = charAt(text, at);
  if (char === "'" || char === '"') return readString(text, at, char);
  if (text.startsWith('[[', at)) return readLink(text, at);
  if (char === '#') return readTagged(text, at, 'tag');
  if (char === '@') return readTagged(text, at, 'date');
  const number = readNumber(text, at);
  if (number !== null) return number;
  if (WORD_START.test(char)) return readWord(text, at);
  const symbol = SYMBOLS.find((candidate) => text.startsWith(candidate, at));
  if (symbol !== undefined) {
    return { kind: 'symbol', text: symbol, span: { start: at, end: at + symbol.length } };
  }
  throw new QueryTextError(`Atlas queries have no “${char}”.`, {
    start: at,
    end: at + char.length,
  });
}

/** A number, unless it runs on into a word — `2026-09-01` is text, not 2026. */
function readNumber(text: string, at: number): Token | null {
  const match = NUMBER.exec(text.slice(at));
  if (match === null) return null;
  const end = at + match[0].length;
  if (WORD_CHAR.test(charAt(text, end))) return null;
  return { kind: 'number', text: match[0], span: { start: at, end } };
}

function readWord(text: string, at: number): Token {
  let end = at;
  while (end < text.length && WORD_CHAR.test(charAt(text, end))) end += charAt(text, end).length;
  return { kind: 'word', text: text.slice(at, end), span: { start: at, end } };
}

/** `'it''s'` is `it's`: a quote is doubled to be written inside, as in SQL. */
function readString(text: string, at: number, quote: string): Token {
  let value = '';
  let cursor = at + 1;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === quote) {
      if (text[cursor + 1] !== quote) {
        return { kind: 'string', text: value, span: { start: at, end: cursor + 1 } };
      }
      cursor += 1;
    }
    value += char;
    cursor += 1;
  }
  throw new QueryTextError(`This text is never closed with ${quote}.`, {
    start: at,
    end: text.length,
  });
}

function readLink(text: string, at: number): Token {
  const close = text.indexOf(']]', at + 2);
  if (close < 0) {
    throw new QueryTextError('This link is never closed with ]].', { start: at, end: text.length });
  }
  const span = { start: at, end: close + 2 };
  const [piece] = splitWikiLinks(text.slice(at, close + 2));
  if (piece?.kind !== 'wikiLink' || piece.target.trim() === '') {
    throw new QueryTextError('A link needs the name of a note: [[Julie]].', span);
  }
  return { kind: 'link', text: piece.target.trim(), span };
}

/** `#q3` or `@today`: a mark, then a name. A tag's name may nest with `/`. */
function readTagged(text: string, at: number, kind: 'tag' | 'date'): Token {
  let end = at + 1;
  const continues = (char: string | undefined) =>
    kind === 'tag' ? continuesTagSegment(char) || char === '/' : WORD_CHAR.test(char ?? '');
  while (end < text.length && continues(charAt(text, end))) end += charAt(text, end).length;
  const span = { start: at, end };
  if (end === at + 1) {
    const what = kind === 'tag' ? 'A tag needs a name after #.' : 'A date needs a name: @today.';
    throw new QueryTextError(what, span);
  }
  return { kind, text: text.slice(at + 1, end), span };
}
