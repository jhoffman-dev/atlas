/**
 * Characters that take no room and mean nothing in a spelling — the
 * zero-width space, the word joiner and the byte-order mark — which text
 * copied from a chat or a web page often carries. Invisible in a box, they
 * are dropped. The zero-width joiner and non-joiner are kept: they shape
 * Persian and Indic words and join emoji into one.
 */
const NO_ROOM = /\u200B|\u2060|\uFEFF/gu;

/** The joiners kept within a spelling, which are still nothing on their own. */
const ONLY_JOINERS = /^[\u200C\u200D\s]*$/u;

/**
 * A spelling composed one way and spaced with single spaces, its case kept —
 * or nothing, when nothing in it can be seen.
 */
export function tidySpelling(form: string): string {
  const tidied = form.normalize('NFC').replace(NO_ROOM, '').replace(/\s+/gu, ' ').trim();
  return ONLY_JOINERS.test(tidied) ? '' : tidied;
}

/**
 * What makes two spellings the same one: composed the same way, spaced with
 * single spaces, and lower-cased — so `Lark  Spur` and `lark spur` are one.
 */
export function vocabularyKey(form: string): string {
  return tidySpelling(form).toLowerCase();
}
