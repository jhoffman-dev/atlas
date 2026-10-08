import type { VaultPath } from '../vault/vault-path.ts';
import { tidySpelling, vocabularyKey } from './spelling.ts';
import type { TermNote } from './term.ts';

/** A person's or a company's note: their name (its title) and the other spellings of it. */
export interface NamedEntity {
  readonly path: VaultPath;
  readonly name: string;
  readonly aliases: readonly string[];
}

/** Where a spelling in the vocabulary comes from. */
export type VocabularySource = 'term' | 'person' | 'company';

/** The notes the vocabulary is built from. */
export interface VocabularySources {
  readonly terms: readonly TermNote[];
  readonly people: readonly NamedEntity[];
  readonly companies: readonly NamedEntity[];
}

/** One note's claim that a spelling means its own right spelling. */
export interface VocabularyClaim {
  /** The spelling as that note writes it. */
  readonly form: string;
  /** What that note says it should be spelt as. */
  readonly canonical: string;
  readonly path: VaultPath;
  readonly source: VocabularySource;
}

/** A spelling Atlas corrects, what to, and every note that says so. */
export interface VocabularyEntry {
  readonly form: string;
  readonly canonical: string;
  readonly claims: readonly VocabularyClaim[];
}

/** A spelling two notes disagree about. It is not corrected until one of them lets it go. */
export interface VocabularyConflict {
  readonly form: string;
  readonly claims: readonly VocabularyClaim[];
}

export interface Vocabulary {
  /** Longest first, so a longer name is matched before a shorter one inside it. */
  readonly entries: readonly VocabularyEntry[];
  /** In the order of their spellings. */
  readonly conflicts: readonly VocabularyConflict[];
}

/**
 * The spellings Atlas knows and what each should be: every term's right
 * spelling and the ways it is misheard, and every person's and company's
 * name and its aliases. A name is its own right spelling, so `mara quill`
 * comes back as `Mara Quill`.
 *
 * Spellings are matched however they are cased and spaced. Where two notes
 * claim one spelling for two different right spellings, it is a conflict:
 * listed, and left out of the entries, since correcting it either way would
 * be a guess.
 */
export function vocabulary({ terms, people, companies }: VocabularySources): Vocabulary {
  const claims = [
    ...terms.map((term) => noteClaims(term, 'term')),
    ...people.map((person) => noteClaims(namedAsTerm(person), 'person')),
    ...companies.map((company) => noteClaims(namedAsTerm(company), 'company')),
  ].flat();

  const entries: VocabularyEntry[] = [];
  const conflicts: VocabularyConflict[] = [];
  for (const claimed of groupByKey(claims).values()) {
    const first = claimed[0];
    if (first === undefined) continue;
    const canonicals = new Set(claimed.map((claim) => claim.canonical));
    if (canonicals.size === 1) {
      entries.push({ form: first.form, canonical: first.canonical, claims: claimed });
    } else {
      conflicts.push({ form: first.form, claims: claimed });
    }
  }
  return {
    entries: entries.sort(longestFirst),
    conflicts: conflicts.sort((left, right) => compareKeys(left.form, right.form)),
  };
}

function namedAsTerm({ path, name, aliases }: NamedEntity) {
  return { path, canonical: name, variants: aliases };
}

/** A note's claims: its right spelling, then each other spelling — each once, however cased. */
function noteClaims(
  note: Pick<TermNote, 'path' | 'canonical' | 'variants'>,
  source: VocabularySource,
): VocabularyClaim[] {
  const canonical = tidySpelling(note.canonical);
  if (canonical === '') return [];
  const seen = new Set<string>();
  const claims: VocabularyClaim[] = [];
  for (const form of [canonical, ...note.variants].map(tidySpelling)) {
    const key = vocabularyKey(form);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    claims.push({ form, canonical, path: note.path, source });
  }
  return claims;
}

function groupByKey(claims: readonly VocabularyClaim[]): Map<string, VocabularyClaim[]> {
  const groups = new Map<string, VocabularyClaim[]>();
  for (const claim of claims) {
    const key = vocabularyKey(claim.form);
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }
  return groups;
}

function longestFirst(left: VocabularyEntry, right: VocabularyEntry): number {
  const byLength = [...right.form].length - [...left.form].length;
  return byLength !== 0 ? byLength : compareKeys(left.form, right.form);
}

function compareKeys(left: string, right: string): number {
  const [a, b] = [vocabularyKey(left), vocabularyKey(right)];
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
