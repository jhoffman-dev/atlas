import { tidySpelling, vocabularyKey } from './spelling.ts';

/*
 * A term's variants as one line of text, which the Terms page edits in a
 * single box: commas between them, as a list is typed everywhere in Atlas.
 * A variant can hold a comma of its own — the properties panel, the API and
 * the file itself can all write `Quill, Mara` — so one that does is written
 * in double quotes, a quote inside it doubled, as a CSV cell is. Reading the
 * line back gives the same list, so editing one variant never cuts another
 * in two.
 */

const QUOTE = '"';

/** The variants as the box shows them: commas between, a variant holding a comma or a quote quoted. */
export function variantsAsInput(variants: readonly string[]): string {
  return variants.map(quotedWhereNeeded).join(', ');
}

function quotedWhereNeeded(variant: string): string {
  if (!variant.includes(',') && !variant.includes(QUOTE)) return variant;
  return `${QUOTE}${variant.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}`;
}

/**
 * The spellings typed into one box: split at the commas outside quotes,
 * tidied, blanks dropped, and a repeat — in any case — kept once, as first
 * typed. A quote never closed runs to the end of the line.
 */
export function variantsFromInput(typed: string): string[] {
  const seen = new Set<string>();
  const variants: string[] = [];
  for (const part of splitAtCommas(typed)) {
    const variant = tidySpelling(part);
    const key = vocabularyKey(variant);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    variants.push(variant);
  }
  return variants;
}

/** The cells of the line, quotes taken off: a cell is quoted when its first non-space character is a quote. */
function splitAtCommas(typed: string): string[] {
  const cells: string[] = [];
  let at = 0;
  while (at <= typed.length) {
    const { cell, next } = readCell(typed, at);
    cells.push(cell);
    at = next + 1;
  }
  return cells;
}

/** One cell from `from`, and where the comma ending it is (the line's length when none is). */
function readCell(typed: string, from: number): { cell: string; next: number } {
  const start = from + (/^\s*/u.exec(typed.slice(from))?.[0].length ?? 0);
  if (typed[start] !== QUOTE) {
    const comma = typed.indexOf(',', from);
    const next = comma === -1 ? typed.length : comma;
    return { cell: typed.slice(from, next), next };
  }
  let cell = '';
  let at = start + 1;
  while (at < typed.length) {
    if (typed[at] === QUOTE && typed[at + 1] === QUOTE) {
      cell += QUOTE;
      at += 2;
    } else if (typed[at] === QUOTE) {
      // What follows the closing quote, up to the comma, is kept as typed.
      const comma = typed.indexOf(',', at + 1);
      const next = comma === -1 ? typed.length : comma;
      return { cell: cell + typed.slice(at + 1, next), next };
    } else {
      cell += typed[at];
      at += 1;
    }
  }
  return { cell, next: typed.length };
}
