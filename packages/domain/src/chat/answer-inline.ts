import type { WikiLinkOrEmbed } from '../markdown/wikilink.ts';
import { scanMarkdown } from '../markdown/wikilink-spans.ts';

/**
 * A piece of an answer's text, as Ask draws it (#37). Nothing in an answer is
 * ever HTML: text is text, a code span is code, and only two things are
 * links — a wiki link to a note (a citation) and a plain `https://` address.
 */
export type AnswerInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | {
      readonly kind: 'cite';
      /** The link as written, `[[Kickoff#^t0003]]`: what following it reads. */
      readonly link: string;
      /** What the citation is shown as: its alias, else the note's name. */
      readonly label: string;
    }
  | { readonly kind: 'web'; readonly url: string; readonly label: string };

/** `[label](address)`, the one markdown link form an answer is read for. */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
/** A bare web address, up to the first space or bracket. */
const BARE_URL = /https:\/\/[^\s<>()[\]]+/g;
/** What ends a sentence rather than an address: left out of a bare one. */
const TRAILING = /[.,;:!?'"]+$/;

/**
 * The pieces of a block's text, in order. Wiki links and code spans are read
 * as the editor reads them (`scanMarkdown`): a link inside code, or escaped,
 * is text, and so cites nothing.
 */
export function answerInline(text: string): AnswerInline[] {
  const { links, code } = scanMarkdown(text);
  const marks = [
    ...links.map((span) => ({
      ...span,
      piece: citeOf(text.slice(span.start, span.end), span.link),
    })),
    ...code.map((span) => ({ ...span, piece: codeOf(text.slice(span.start, span.end)) })),
  ].sort((a, b) => a.start - b.start);
  const pieces: AnswerInline[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    pieces.push(...webPieces(text.slice(cursor, mark.start)));
    pieces.push(mark.piece);
    cursor = mark.end;
  }
  pieces.push(...webPieces(text.slice(cursor)));
  return pieces;
}

function citeOf(written: string, link: WikiLinkOrEmbed): AnswerInline {
  const name = link.target.split('/').pop() ?? link.target;
  return {
    kind: 'cite',
    link: written.startsWith('!') ? written.slice(1) : written,
    label: link.alias ?? (name === '' ? written : name),
  };
}

/** A code span without its backticks, and the one space CommonMark strips from each side. */
function codeOf(written: string): AnswerInline {
  const ticks = /^`+/.exec(written)?.[0].length ?? 1;
  const inner = written.slice(ticks, written.length - ticks);
  const trimmed = /^ .* $/s.test(inner) && inner.trim() !== '' ? inner.slice(1, -1) : inner;
  return { kind: 'code', text: trimmed };
}

/**
 * Text, with its web links read out of it: `[label](https://…)` and a bare
 * `https://…`. A markdown link to anything else — `http:`, `file:`,
 * `javascript:`, a path — stays as the text it was written as, never hidden.
 */
function webPieces(text: string): AnswerInline[] {
  if (text === '') return [];
  const pieces: AnswerInline[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    const [written, label, url] = match as unknown as [string, string, string];
    if (!isWebAddress(url)) continue;
    pieces.push(...barePieces(text.slice(cursor, match.index)));
    pieces.push({ kind: 'web', url, label });
    cursor = match.index + written.length;
  }
  pieces.push(...barePieces(text.slice(cursor)));
  return pieces;
}

function barePieces(text: string): AnswerInline[] {
  const pieces: AnswerInline[] = [];
  let cursor = 0;
  for (const match of text.matchAll(BARE_URL)) {
    const url = match[0].replace(TRAILING, '');
    if (!isWebAddress(url)) continue;
    if (match.index > cursor) pieces.push({ kind: 'text', text: text.slice(cursor, match.index) });
    pieces.push({ kind: 'web', url, label: url });
    cursor = match.index + url.length;
  }
  if (cursor < text.length) pieces.push({ kind: 'text', text: text.slice(cursor) });
  return pieces;
}

/** Whether an address is one Ask opens: `https://` with a host, nothing else. */
export function isWebAddress(url: string): boolean {
  if (!url.startsWith('https://')) return false;
  try {
    return new URL(url).hostname !== '';
  } catch {
    // Not an address at all: shown as the text it is.
    return false;
  }
}
