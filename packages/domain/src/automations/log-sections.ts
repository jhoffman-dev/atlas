/** A log note is a head, then `##` sections — entries, the handled ledger, and any a person adds. */

/**
 * The text before the first section, and each section from its `## ` heading
 * (at the start of a line, as every reader of a log finds one) to the next.
 * Whatever precedes the first heading is the head and is kept as it is.
 */
export function splitSections(text: string): { head: string; sections: string[] } {
  const starts = [...text.matchAll(/^## /gm)].map((match) => match.index);
  if (starts.length === 0)
    return { head: text.endsWith('\n') ? `${text}\n` : `${text}\n\n`, sections: [] };
  const head = text.slice(0, starts[0]);
  const sections = starts.map((start, index) => text.slice(start, starts[index + 1]));
  return { head, sections };
}

/** Bytes of UTF-8 text, as the file on disk holds it. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0)!;
    bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return bytes;
}
