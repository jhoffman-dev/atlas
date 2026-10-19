import { isArchivedPath } from '../archive/archive.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { isUserSpaceNote } from '../vault/vault-visibility.ts';
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
 * Whether the vocabulary reads a note at all: one in the vault's own space
 * (not a template, nor in a hidden folder) and outside the Archive, as its
 * query (`compileVocabularyQuery`) holds it.
 */
export function isVocabularyNote(path: VaultPath): boolean {
  return isUserSpaceNote(path) && !isArchivedPath(path);
}

/**
 * A note's `variants` with misheard spellings added (#400): what the note
 * already lists kept exactly as written, then each spelling it does not yet
 * hold. Spellings are compared tidied, capitals counted — `lark spur` and
 * `Lark Spur` are two, as the vocabulary matches them — so one listed with
 * other spacing is not added twice. A single variant written as a scalar is
 * read as a list of one, and an empty one as none.
 *
 * Null when `variants` is something else — a mapping, a number — which
 * adding to would reshape into a list (#404).
 */
export function withVariantsAdded(
  current: unknown,
  given: readonly string[],
): { variants: unknown[]; added: string[] } | null {
  const listed = variantsList(current);
  if (listed === null) return null;
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

/** The items of a `variants` value, or null when it is not a list nor a single spelling. */
function variantsList(current: unknown): unknown[] | null {
  if (current === undefined || current === null) return [];
  if (Array.isArray(current)) return [...current];
  if (typeof current !== 'string') return null;
  return tidySpelling(current) === '' ? [] : [current];
}
