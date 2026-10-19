import { tidySpelling } from './spelling.ts';
import type { VocabularySource } from './vocabulary.ts';
import { VOCABULARY_TYPES } from './vocabulary-query.ts';

/**
 * What a note is to the vocabulary, by its `type`: the first item of it that
 * is term, person or company, as the vocabulary's query reads it
 * (`type: [company, person]` is a company) — or null when it is none of them.
 */
export function vocabularySourceOf(type: unknown): VocabularySource | null {
  const items: readonly unknown[] = Array.isArray(type) ? type : [type];
  for (const item of items) {
    const source = VOCABULARY_TYPES.find((known) => known === item);
    if (source !== undefined) return source;
  }
  return null;
}

/**
 * A note's `variants` with misheard spellings added (#400): what the note
 * already lists kept exactly as written, then each spelling it does not yet
 * hold. Spellings are compared tidied, capitals counted — `lark spur` and
 * `Lark Spur` are two, as the vocabulary matches them — so one listed with
 * other spacing is not added twice. A single variant written as a scalar is
 * read as a list of one.
 */
export function withVariantsAdded(
  current: unknown,
  given: readonly string[],
): { variants: unknown[]; added: string[] } {
  const listed: unknown[] =
    current === undefined || current === null
      ? []
      : Array.isArray(current)
        ? [...current]
        : [current];
  const held = new Set(listed.map((item) => tidySpelling(String(item))));
  const added: string[] = [];
  for (const spelling of given) {
    const tidied = tidySpelling(spelling);
    if (tidied === '' || held.has(tidied)) continue;
    held.add(tidied);
    added.push(tidied);
  }
  return { variants: [...listed, ...added], added };
}
