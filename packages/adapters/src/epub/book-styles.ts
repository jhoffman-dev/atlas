import {
  MOST_CHAPTER_LOOKUPS,
  MOST_SHEET_LENGTH,
  sheetMade,
  type FileAddress,
  type LookupBudget,
  type MadeSheet,
} from './chapter-styles.ts';

/*
 * A book's stylesheets with their `@import`s put in place (#505, ADR-0045
 * §5). Each of the book's sheets is read and made once per open book
 * (`chapter-styles.ts`), and a sheet that imports others is written out
 * with each of them before its own rules, as a browser would load them. A
 * sheet is put in at most once in one sheet written out, however often it is
 * imported, and the imports one chapter's CSS puts in are bounded together:
 * `MOST_IMPORTS` sheets, `MOST_IMPORT_DEPTH` deep, and `MOST_IMPORTED_LENGTH`
 * characters of them. So a book that imports itself over and over costs no
 * more than one that does not.
 */

/** How deep `@import`s are followed. */
export const MOST_IMPORT_DEPTH = 4;
/** The most stylesheets one chapter's (or one stylesheet's) `@import`s may put in: a book has a handful. */
export const MOST_IMPORTS = 64;
/** The most all of those sheets may be together, in characters, as the book wrote them. */
export const MOST_IMPORTED_LENGTH = 4 * 1024 * 1024;

/** What one chapter's CSS has put in so far, and the longhands its own CSS has read. */
export interface StyleBudget extends LookupBudget {
  imports: number;
  length: number;
}

export const styleBudget = (): StyleBudget => ({
  imports: 0,
  length: 0,
  lookups: 0,
  most: MOST_CHAPTER_LOOKUPS,
});

export interface BookStyles {
  /** `css`, written in the book's file at `from`, made, its imports in place, within `budget`. */
  css(css: string, from: string, budget?: StyleBudget): Promise<string>;
  /** The book's stylesheet at `path`, made, its imports in place; empty when there is none. */
  sheet(path: string): Promise<string>;
}

/** The book's stylesheets, each read by `stylesheet` and made once. */
export function bookStyles({
  address,
  stylesheet,
}: {
  address: FileAddress;
  stylesheet: (path: string) => Promise<string | null>;
}): BookStyles {
  const sheets = new Map<string, Promise<MadeSheet | null>>();
  const madeAt = (path: string): Promise<MadeSheet | null> => {
    const found = sheets.get(path);
    if (found !== undefined) return found;
    const made = stylesheet(path).then((css) =>
      css === null || css.length > MOST_SHEET_LENGTH
        ? null
        : sheetMade({ css, from: path, address }),
    );
    sheets.set(path, made);
    // One that failed is made again the next time it is asked for.
    made.catch(() => sheets.delete(path));
    return made;
  };
  const written = (top: MadeSheet, from: string, budget: StyleBudget) =>
    withImports({ sheet: top, depth: 0, seen: new Set([from]), budget, madeAt });
  return {
    css: async (css, from, budget = styleBudget()) =>
      written(await sheetMade({ css, from, address, budget }), from, budget),
    sheet: async (path) => {
      const top = await madeAt(path);
      return top === null ? '' : written(top, path, styleBudget());
    },
  };
}

/** `css`, written in the book's file at `from`, made, each of the book's sheets it imports read by `stylesheet`. */
export function bookCss({
  css,
  from,
  address,
  stylesheet,
}: {
  css: string;
  from: string;
  address: FileAddress;
  stylesheet: (path: string) => Promise<string | null>;
}): Promise<string> {
  return bookStyles({ address, stylesheet }).css(css, from);
}

/** `sheet` written out, each sheet it imports before its own rules, those not yet `seen`, within `budget`. */
async function withImports({
  sheet,
  depth,
  seen,
  budget,
  madeAt,
}: {
  sheet: MadeSheet;
  depth: number;
  seen: Set<string>;
  budget: StyleBudget;
  madeAt: (path: string) => Promise<MadeSheet | null>;
}): Promise<string> {
  const parts: string[] = [];
  for (const path of depth < MOST_IMPORT_DEPTH ? sheet.imports : []) {
    if (seen.has(path)) continue;
    if (budget.imports >= MOST_IMPORTS) break;
    seen.add(path);
    budget.imports += 1;
    const imported = await madeAt(path);
    if (imported === null || budget.length + imported.length > MOST_IMPORTED_LENGTH) continue;
    budget.length += imported.length;
    parts.push(await withImports({ sheet: imported, depth: depth + 1, seen, budget, madeAt }));
  }
  parts.push(sheet.own);
  return parts.filter((part) => part !== '').join('\n');
}
