import { bookReference } from '@dfai/domain';

/*
 * A book's stylesheets, made to load only from the book (#505). Every
 * `url(…)` a chapter's CSS names is read against the file it is written in:
 * one of the book's files becomes the address the frame loads it from, one
 * written in (`data:`) stays, and anything else becomes `none`, so a font or
 * a background on another site is never asked for. An `@import` of one of
 * the book's stylesheets is put in its place; any other is dropped.
 */

/** How the frame loads a file of the book: its address, or null when the book has no such file. */
export type FileAddress = (path: string) => Promise<string | null>;

const URL_REFERENCE = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const IMPORT = /@import\s+(?:url\(\s*(['"]?)(.*?)\1\s*\)|(['"])(.*?)\3)[^;]*;?/gi;

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
    css.replace(/[\uE000\uE001]/g, '\uFFFD'),
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
  const made = await replaceAsync(own, URL_REFERENCE, async (match) => {
    const ref = match[2] ?? '';
    if (ref.startsWith('#')) return match[0];
    const target = bookReference({ from, ref });
    if (target.kind === 'data') return match[0];
    if (target.kind === 'outside') return 'none';
    const found = await address(target.path);
    return found === null ? 'none' : `url("${found}")`;
  });
  return made.replace(IMPORT_PLACE, (_, at: string) => imports[Number(at)] ?? '');
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
