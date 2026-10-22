import type { VaultPath } from '../vault/vault-path.ts';
import { isSearchable, tidySpelling, vocabularyKey } from './spelling.ts';
import type { TermNote } from './term.ts';

/**
 * A person's or a company's note: their name (its title) and the other
 * spellings of it. The aliases link an attendee to the person; they are never
 * used to rewrite text (ADR-0027). The variants are how a notetaker mishears
 * the name, as a term's are, and are corrected to it (#400).
 */
export interface NamedEntity {
  readonly path: VaultPath;
  readonly name: string;
  readonly aliases: readonly string[];
  /** None when absent. */
  readonly variants?: readonly string[];
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

/** A spelling DFAI corrects, what to, and every note that says so. */
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
  /**
   * What each person goes by — name and aliases, as spellings are compared
   * (`vocabularyKey`) — and who goes by it. An alias rewrites nothing; but a
   * transcript's speaker label that is exactly one of these names that
   * person, and is not corrected into a spelling that is not theirs.
   */
  readonly speakers: ReadonlyMap<string, readonly VaultPath[]>;
}

/**
 * The spellings DFAI knows and what each should be: every term's right
 * spelling and the ways it is misheard, and every person's and company's
 * name as its own right spelling — so `Mara Quill` is left alone and a
 * misheard spelling inside it is not corrected — with the ways their note
 * says it is misheard (`variants`). A person's or a company's
 * aliases are not in it: they link people, they never rewrite text. What a
 * person goes by is kept beside the entries (`speakers`), only so a speaker
 * label that is their alias is left for linking to read.
 *
 * Spellings are matched exactly as written, case included: `mark` and `Mark`
 * are two spellings. Where two notes claim one spelling for two different
 * right spellings, it is a conflict: listed, and left out of the entries,
 * since correcting it either way would be a guess. A misheard spelling with no
 * letter or digit in it (`~`) is left out too: it would be found in every
 * timestamp.
 */
export function vocabulary({ terms, people, companies }: VocabularySources): Vocabulary {
  const claims = [
    ...terms.map((term) => noteClaims(term, 'term')),
    ...people.map((person) => noteClaims(namedAsTerm(person), 'person')),
    ...companies.map((company) => noteClaims(namedAsTerm(company), 'company')),
  ].flat();

  const entries: VocabularyEntry[] = [];
  const conflicts: VocabularyConflict[] = [];
  for (const claimed of groupByForm(claims).values()) {
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
    speakers: goingBy(people),
  };
}

/** Who goes by each spelling: every person's name and aliases, as spellings are compared. */
function goingBy(people: readonly NamedEntity[]): Map<string, VaultPath[]> {
  const speakers = new Map<string, VaultPath[]>();
  for (const { path, name, aliases } of people) {
    for (const key of new Set([name, ...aliases].map(vocabularyKey))) {
      if (key !== '') speakers.set(key, [...(speakers.get(key) ?? []), path]);
    }
  }
  return speakers;
}

/** A name is its own right spelling, misheard as its variants: its aliases are left out on purpose. */
function namedAsTerm({ path, name, variants = [] }: NamedEntity) {
  return { path, canonical: name, variants };
}

/** A note's claims: its right spelling, then each other spelling — each once, as written. */
function noteClaims(
  note: Pick<TermNote, 'path' | 'canonical' | 'variants'>,
  source: VocabularySource,
): VocabularyClaim[] {
  const canonical = tidySpelling(note.canonical);
  if (canonical === '') return [];
  const seen = new Set<string>();
  const claims: VocabularyClaim[] = [];
  const forms = [canonical, ...note.variants.filter(isSearchable).map(tidySpelling)];
  for (const form of forms) {
    if (form === '' || seen.has(form)) continue;
    seen.add(form);
    claims.push({ form, canonical, path: note.path, source });
  }
  return claims;
}

function groupByForm(claims: readonly VocabularyClaim[]): Map<string, VocabularyClaim[]> {
  const groups = new Map<string, VocabularyClaim[]>();
  for (const claim of claims) {
    groups.set(claim.form, [...(groups.get(claim.form) ?? []), claim]);
  }
  return groups;
}

function longestFirst(left: VocabularyEntry, right: VocabularyEntry): number {
  const byLength = [...right.form].length - [...left.form].length;
  return byLength !== 0 ? byLength : compareKeys(left.form, right.form);
}

function compareKeys(left: string, right: string): number {
  const [a, b] = [vocabularyKey(left), vocabularyKey(right)];
  if (a !== b) return a < b ? -1 : 1;
  // Two spellings differing only in case are two spellings: a stable order for them.
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
