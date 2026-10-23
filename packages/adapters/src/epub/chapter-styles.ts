import { bookReference } from '@dfai/domain';

/*
 * A book's stylesheets, made to load only from the book (#505). Every
 * `url(…)` a chapter's CSS names, and every address an `image-set()` names
 * as a plain string, is read against the file it is written in: one of the
 * book's files becomes the address the frame loads it from, one written in
 * (`data:`) stays, and anything else becomes `none`, so a font or a
 * background on another site is never asked for. An `@import` of one of
 * the book's stylesheets is put in its place; any other is dropped. The
 * CSS's escapes of letters are read first (`u\72l(` is `url(`), so no
 * spelling CSS allows hides a reference; the frame's policy still stands
 * behind this (ADR-0045 §5).
 */

/** How the frame loads a file of the book: its address, or null when the book has no such file. */
export type FileAddress = (path: string) => Promise<string | null>;

const URL_REFERENCE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const IMPORT =
  /@import(?:\s|\/\*[\s\S]*?\*\/)*(?:url\(\s*(['"]?)(.*?)\1\s*\)|(['"])(.*?)\3)[^;]*;?/gi;
/** An `@import` of no form `IMPORT` reads: dropped whole, to the end of its rule. */
const ANY_IMPORT = /@import\b[^;]*;?/gi;
/** Where an `image-set()` begins: its addresses may be plain strings, with no `url()` around them. */
const IMAGE_SET = /(?<![\w-])(?:-webkit-)?image-set\(/gi;

/**
 * A CSS escape: up to six hex digits and the one white space that may end
 * them, or any other character but a line break.
 */
const ESCAPE = /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|([^0-9a-f\r\n\f]))/gi;
/** The characters an escape is read as here: the letters and the hyphen CSS's names are spelled in. */
const NAME_LETTER = /^[a-z-]$/i;

/** How deep `@import`s are followed: a book that imports itself in a loop stops here. */
const MOST_IMPORTS = 4;

/**
 * `css`, written in the book's file at `from`, with every reference made
 * the book's own or nothing. `stylesheet` reads one of the book's
 * stylesheets for an `@import`.
 */
export async function bookCss({
  css,
  from,
  address,
  stylesheet,
  depth = 0,
}: {
  css: string;
  from: string;
  address: FileAddress;
  stylesheet: (path: string) => Promise<string | null>;
  depth?: number;
}): Promise<string> {
  // Each import is set aside while this sheet's own references are read, then put back made
  // already: its references are read against its own file, and must not be read again.
  const imports: string[] = [];
  // The placeholders' characters are taken out of the book's own text, which cannot pose as one.
  const own = await replaceAsync(
    unescapeLetters(css).replace(/[\uE000\uE001]/g, '\uFFFD'),
    IMPORT,
    async (match) => {
      const target = bookReference({ from, ref: match[2] ?? match[4] ?? '' });
      const text =
        target.kind !== 'inside' || depth >= MOST_IMPORTS ? null : await stylesheet(target.path);
      imports.push(
        text === null || target.kind !== 'inside'
          ? ''
          : await bookCss({ css: text, from: target.path, address, stylesheet, depth: depth + 1 }),
      );
      return importPlace(imports.length - 1);
    },
  );
  const resolve = (ref: string) => referenceOf({ ref, from, address });
  const sets = await imageSetsMade(own.replace(ANY_IMPORT, ''), async (quoted, ref) => {
    const found = await resolve(ref);
    return found.kind === 'keep' ? quoted : found.kind === 'none' ? 'none' : `"${found.address}"`;
  });
  const made = await replaceAsync(sets, URL_REFERENCE, async (match) => {
    const found = await resolve(match[2] ?? '');
    return found.kind === 'keep'
      ? match[0]
      : found.kind === 'none'
        ? 'none'
        : `url("${found.address}")`;
  });
  return made.replace(IMPORT_PLACE, (_, at: string) => imports[Number(at)] ?? '');
}

/** What a reference becomes: kept as written, nothing, or the address the frame loads the book's file from. */
type Reference = { kind: 'keep' } | { kind: 'none' } | { kind: 'address'; address: string };

async function referenceOf({
  ref,
  from,
  address,
}: {
  ref: string;
  from: string;
  address: FileAddress;
}): Promise<Reference> {
  // A place in the chapter itself (`#id`), or a file written in, loads nothing.
  if (ref.startsWith('#')) return { kind: 'keep' };
  const target = bookReference({ from, ref });
  if (target.kind === 'data') return { kind: 'keep' };
  if (target.kind === 'outside') return { kind: 'none' };
  const found = await address(target.path);
  return found === null ? { kind: 'none' } : { kind: 'address', address: found };
}

/**
 * `css` with each escape of a letter or a hyphen read as that character:
 * `u\72l(` is the `url(` a browser reads. An escape of anything else stays
 * an escape, so the CSS means what it meant; a hex one is ended with a
 * space, so a letter read after it does not run into its digits.
 */
function unescapeLetters(css: string): string {
  return css.replace(ESCAPE, (escape, hex: string | undefined, other: string | undefined) => {
    if (other !== undefined) return NAME_LETTER.test(other) ? other : escape;
    const code = Number.parseInt(hex ?? '', 16);
    const character = code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    return NAME_LETTER.test(character) ? character : `\\${hex ?? ''} `;
  });
}

/**
 * `css` with each plain string inside an `image-set()` replaced by what
 * `made` resolves it to: an address there is a string, with no `url()`
 * around it. A string in a `url()` is left for the `url()`s, and one in a
 * `type()` names a kind of file, not a file.
 */
async function imageSetsMade(
  css: string,
  made: (quoted: string, ref: string) => Promise<string>,
): Promise<string> {
  const pieces: string[] = [];
  let last = 0;
  for (const set of css.matchAll(new RegExp(IMAGE_SET.source, IMAGE_SET.flags))) {
    const start = set.index + set[0].length;
    if (start <= last) continue;
    for (const string of stringsInCall(css, start)) {
      const before = css.slice(start, string.start).trimEnd();
      if (/(?:url|type)\($/i.test(before)) continue;
      const quoted = css.slice(string.start, string.end);
      pieces.push(css.slice(last, string.start), await made(quoted, string.value));
      last = string.end;
    }
  }
  pieces.push(css.slice(last));
  return pieces.join('');
}

/** Each string token in the call whose arguments begin at `start`, up to the `)` that closes it. */
function stringsInCall(
  css: string,
  start: number,
): { start: number; end: number; value: string }[] {
  const strings: { start: number; end: number; value: string }[] = [];
  let depth = 1;
  for (let at = start; at < css.length && depth > 0; at += 1) {
    const character = css[at];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === '\\') at += 1;
    else if (character === '"' || character === "'") {
      let end = at + 1;
      while (end < css.length && css[end] !== character && css[end] !== '\n') {
        end += css[end] === '\\' ? 2 : 1;
      }
      strings.push({ start: at, end: end + 1, value: css.slice(at + 1, end) });
      at = end;
    }
  }
  return strings;
}

/** Where an import stood while its sheet's own references are read, between two private-use characters. */
const importPlace = (at: number) => `\uE000import ${at}\uE001`;
const IMPORT_PLACE = /\uE000import (\d+)\uE001/g;

/** `text` with each match of `pattern` replaced by what `replace` resolves to, in order. */
async function replaceAsync(
  text: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => Promise<string>,
): Promise<string> {
  const pieces: string[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
    pieces.push(text.slice(last, match.index), await replace(match as RegExpExecArray));
    last = match.index + match[0].length;
  }
  pieces.push(text.slice(last));
  return pieces.join('');
}
