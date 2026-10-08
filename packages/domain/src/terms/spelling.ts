/** A spelling composed one way and spaced with single spaces, its case kept. */
export function tidySpelling(form: string): string {
  return form.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * What makes two spellings the same one: composed the same way, spaced with
 * single spaces, and lower-cased — so `Lark  Spur` and `lark spur` are one.
 */
export function vocabularyKey(form: string): string {
  return tidySpelling(form).toLowerCase();
}
