import type { TermNote } from './term.ts';
import { byCanonical } from './vocabulary-query.ts';
import type { NamedEntity, VocabularySource, VocabularySources } from './vocabulary.ts';

/** A row of the Terms page: a right spelling and its misheard ones, and the kind of note holding them. */
export interface ListedTerm extends TermNote {
  readonly source: VocabularySource;
}

/**
 * What the Terms page lists: every term, and every person and company whose
 * note lists misheard spellings of its name (#400) — the rest are only names,
 * with nothing to edit. In the order of their right spellings, then by path.
 */
export function listedTerms({ terms, people, companies }: VocabularySources): ListedTerm[] {
  return [
    ...terms.map((term) => ({ ...term, source: 'term' as const })),
    ...people.filter(misheard).map((person) => named(person, 'person')),
    ...companies.filter(misheard).map((company) => named(company, 'company')),
  ].sort(byCanonical);
}

function misheard(entity: NamedEntity): boolean {
  return (entity.variants ?? []).length > 0;
}

function named({ path, name, variants = [] }: NamedEntity, source: VocabularySource): ListedTerm {
  return { path, canonical: name, variants, kind: null, source };
}
