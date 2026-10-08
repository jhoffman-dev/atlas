/**
 * Characters that take no room — zero-width spaces and joiners, and the
 * byte-order mark — which text copied from a chat or a web page often
 * carries. Invisible in a box, they are no part of a spelling.
 */
const ZERO_WIDTH = /\u200B|\u200C|\u200D|\u2060|\uFEFF/gu;

/** A spelling composed one way and spaced with single spaces, its case kept. */
export function tidySpelling(form: string): string {
  return form.normalize('NFC').replace(ZERO_WIDTH, '').replace(/\s+/gu, ' ').trim();
}

/**
 * What makes two spellings the same one: composed the same way, spaced with
 * single spaces, and lower-cased — so `Lark  Spur` and `lark spur` are one.
 */
export function vocabularyKey(form: string): string {
  return tidySpelling(form).toLowerCase();
}
