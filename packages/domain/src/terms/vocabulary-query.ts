import { outsideArchiveSql } from '../archive/archive.ts';
import { COMPANY_TYPE } from '../people/company.ts';
import { PERSON_TYPE } from '../people/person.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { userSpaceNoteSql } from '../vault/vault-visibility.ts';
import { ALIASES_KEY, TERM_KIND_KEY, TERM_TYPE, termKindOf, VARIANTS_KEY } from './term.ts';
import type { TermNote } from './term.ts';
import type { NamedEntity, VocabularySources } from './vocabulary.ts';

/** Rows per page of the vocabulary's notes: the host hands back at most 5,000 at once. */
export const VOCABULARY_PAGE_SIZE = 5000;

/**
 * One page of what the vocabulary is built from: every term, person and
 * company, with each item of the lists that hold their other spellings — one
 * row per item, and one row with no key for a note that has none. Columns:
 * path, title, type, key, value; in path order, then by key and place in the
 * list, so a note's rows arrive together.
 *
 * A note's type is its first; only the vault's own notes are read — not a
 * template in `.atlas`, nor anything in a hidden folder or the Archive, which
 * is where a term goes when it is retired.
 */
export function compileVocabularyQuery(page: number): CompiledQuery {
  return {
    sql: `/* terms:notes */ SELECT files.path AS "path", files.title AS "title",
        typed.value_text AS "type", spelt.key AS "key", spelt.value_text AS "value"
 FROM files
 JOIN props AS typed ON typed.path = files.path AND typed.key = 'type' AND typed.idx = 0
   AND typed.value_text IN (?, ?, ?)
 LEFT JOIN props AS spelt ON spelt.path = files.path AND spelt.key IN (?, ?, ?)
 WHERE ${userSpaceNoteSql('files.path')} AND ${outsideArchiveSql('files.path')}
 ORDER BY files.path, spelt.key, spelt.idx LIMIT ? OFFSET ?`,
    parameters: [
      TERM_TYPE,
      PERSON_TYPE,
      COMPANY_TYPE,
      VARIANTS_KEY,
      TERM_KIND_KEY,
      ALIASES_KEY,
      VOCABULARY_PAGE_SIZE,
      page * VOCABULARY_PAGE_SIZE,
    ],
  };
}

/** A row of {@link compileVocabularyQuery}. */
export interface VocabularyRow {
  readonly path: string;
  readonly title: string;
  readonly type: string;
  readonly key: string | null;
  readonly value: string | null;
}

/**
 * The terms, people and companies the rows describe, terms in the order of
 * their right spellings. A term's other spellings are its `variants`; a
 * person's or a company's are its `aliases`. A `kind` Atlas does not know is
 * no kind.
 */
export function vocabularySourcesOf(rows: readonly VocabularyRow[]): VocabularySources {
  const terms: TermNote[] = [];
  const people: NamedEntity[] = [];
  const companies: NamedEntity[] = [];
  for (const note of notesOf(rows)) {
    const path = createVaultPath(note.path);
    if (note.type === TERM_TYPE) {
      terms.push({
        path,
        canonical: note.title,
        variants: note.values(VARIANTS_KEY),
        kind: termKindOf(note.values(TERM_KIND_KEY)[0]),
      });
    } else {
      const named = { path, name: note.title, aliases: note.values(ALIASES_KEY) };
      (note.type === COMPANY_TYPE ? companies : people).push(named);
    }
  }
  return { terms: terms.sort(byCanonical), people, companies };
}

/** The rows gathered per note, in the order they came. */
function notesOf(rows: readonly VocabularyRow[]) {
  const notes = new Map<string, { row: VocabularyRow; spelt: [string, string][] }>();
  for (const row of rows) {
    const note = notes.get(row.path) ?? { row, spelt: [] };
    if (row.key !== null && row.value !== null) note.spelt.push([row.key, row.value]);
    notes.set(row.path, note);
  }
  return [...notes.values()].map(({ row, spelt }) => ({
    path: row.path,
    title: row.title,
    type: row.type,
    values: (wanted: string) => spelt.filter(([key]) => key === wanted).map(([, value]) => value),
  }));
}

function byCanonical(left: TermNote, right: TermNote): number {
  const [a, b] = [left.canonical.toLowerCase(), right.canonical.toLowerCase()];
  if (a !== b) return a < b ? -1 : 1;
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}
