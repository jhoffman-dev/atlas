import type { ParsedBody } from '../markdown/source-block.ts';

/** A stretch of a note's body, by offset. */
export interface BodyRange {
  readonly start: number;
  readonly end: number;
}

/** A note's name written as plain text in another note's body. */
export interface Mention extends BodyRange {
  /** The words as they are written there, which may be cased differently. */
  readonly text: string;
}

/**
 * The blocks a mention may be found in: prose. A code block, a table, a
 * callout or a block the editor keeps as raw markdown is left alone — the
 * words there are code, cells or markup whose meaning a link would change.
 */
const PROSE_BLOCKS: ReadonlySet<string> = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
]);

/** Where the prose is in a parsed body: each prose block's exact byte range. */
export function proseRanges(parsed: ParsedBody): BodyRange[] {
  return parsed.blocks.flatMap((block, index) => {
    const type = parsed.doc.content?.[index]?.type ?? '';
    return PROSE_BLOCKS.has(type) ? [{ start: block.start, end: block.end }] : [];
  });
}

/**
 * The plain text a mention may be found in: the stretches the parser read as
 * words (outside any link, reference, code or HTML), clipped to the prose blocks.
 */
export function proseText(parsed: ParsedBody, text: readonly BodyRange[]): BodyRange[] {
  const prose = proseRanges(parsed);
  return text.flatMap((range) =>
    prose
      .map((block) => ({
        start: Math.max(block.start, range.start),
        end: Math.min(block.end, range.end),
      }))
      .filter((clipped) => clipped.start < clipped.end),
  );
}

/**
 * Markup inside prose that a name must not be matched in: code, links of
 * every kind, anything in brackets (a reference or footnote the parser only
 * reads as one when it is defined), a link's reference definition, a URL,
 * HTML, maths, an escaped character, a `#tag`, an email address and a path or
 * file name. Matching inside any of them would turn a link, a tag, a path or
 * a snippet of code into something else.
 */
const SHIELDS: readonly RegExp[] = [
  /(`+)[\s\S]*?\1/g,
  /\[\[[^\]]*\]\]/g,
  /!?\[[^\]]*\]\([^)]*\)/g,
  /!?\[[^\]]*\]\[[^\]]*\]/g,
  /^\s*\[[^\]]+\]:.*$/gm,
  /<!--[\s\S]*?-->/g,
  /<[^>\n]+>/g,
  /\b(?:https?|ftp|mailto|file):[^\s)>\]]+/g,
  /\bwww\.[^\s)>\]]+/g,
  /\$\$[\s\S]*?\$\$/g,
  /\$[^$\n]+\$/g,
  /\\./g,
  /\[[^[\]\n]*\]/g,
  /(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_/-]+/gu,
  /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
  /[\p{L}\p{N}._~-]*(?:\/[\p{L}\p{N}._~-]*)+/gu,
  /[\p{L}\p{N}_-]+(?:\.[\p{L}][\p{L}\p{N}]*)+/gu,
];

function shielded(text: string): BodyRange[] {
  return SHIELDS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    })),
  );
}

const WORD = /[\p{L}\p{N}_]/u;

/** A name no link could be written with: brackets, a pipe or a `#` would end it early. */
function isLinkable(name: string): boolean {
  return name.trim() !== '' && !/[[\]|#]/.test(name);
}

/**
 * Every place `name` stands as whole words in `text`, ignoring case.
 *
 * Matched on the text as written rather than on a lowercased copy: lowering
 * can change a string's length ("İ" becomes two code units), which would put
 * every offset after it in the wrong place.
 */
function occurrences(text: string, name: string): BodyRange[] {
  const pattern = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  const found: BodyRange[] = [];
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!WORD.test(text[start - 1] ?? ' ') && !WORD.test(text[end] ?? ' ')) {
      found.push({ start, end });
    }
    pattern.lastIndex = start + 1;
  }
  return found;
}

const overlaps = (left: BodyRange, right: BodyRange) =>
  left.start < right.end && right.start < left.end;

/**
 * The first plain-text mention of any of these names in the body's prose.
 *
 * Earliest wins; at the same place the longer name does, so "Atlas plan" is
 * found whole rather than as "Atlas". A name that could not be written into a
 * link is never looked for.
 */
export function findMention({
  body,
  prose,
  names,
}: {
  body: string;
  prose: readonly BodyRange[];
  names: readonly string[];
}): Mention | null {
  const wanted = [...new Set(names.filter(isLinkable))];
  for (const range of prose) {
    const text = body.slice(range.start, range.end);
    const blocked = shielded(text);
    const hits = wanted
      .flatMap((name) => occurrences(text, name))
      .filter((hit) => !blocked.some((shield) => overlaps(hit, shield)))
      .sort((left, right) => left.start - right.start || right.end - left.end);
    const first = hits[0];
    if (first !== undefined) {
      const start = range.start + first.start;
      const end = range.start + first.end;
      return { start, end, text: body.slice(start, end) };
    }
  }
  return null;
}

/**
 * The body with its first mention turned into a link to `target`.
 *
 * Only the mention's own bytes change: everything before and after it is
 * carried across as it was, so the rest of the note — its spacing, its
 * markup, the blocks the editor would normalise — is exactly what it was.
 * Written as `[[target]]` where the words are the name as it is, and as
 * `[[target|words]]` where they differ, so the sentence still reads the same.
 * Null when there is nothing to link, or no link could hold the target.
 */
export function linkFirstMention({
  body,
  prose,
  names,
  target,
}: {
  body: string;
  prose: readonly BodyRange[];
  names: readonly string[];
  target: string;
}): string | null {
  if (!isLinkable(target)) return null;
  const mention = findMention({ body, prose, names });
  if (mention === null) return null;
  const link = mention.text === target ? `[[${target}]]` : `[[${target}|${mention.text}]]`;
  return body.slice(0, mention.start) + link + body.slice(mention.end);
}

const EXCERPT_RADIUS = 48;

/** The words around a mention, on one line, for showing where it is. */
export function mentionExcerpt(body: string, mention: BodyRange): string {
  const from = Math.max(0, mention.start - EXCERPT_RADIUS);
  const to = Math.min(body.length, mention.end + EXCERPT_RADIUS);
  const text = body.slice(from, to).replace(/\s+/g, ' ').trim();
  return `${from > 0 ? '…' : ''}${text}${to < body.length ? '…' : ''}`;
}
