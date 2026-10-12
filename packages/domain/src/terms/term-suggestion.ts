import { isCommonWord } from './common-words.ts';
import { isSearchable, tidySpelling, vocabularyKey } from './spelling.ts';
import type { Vocabulary } from './vocabulary.ts';

/** The longest a suggested spelling runs: a name, not a sentence. */
export const MAX_SUGGESTED_SPELLING_CHARACTERS = 80;

/** The most words a misheard spelling holds: `Lark Spur Pay`, not a phrase. */
export const MAX_HEARD_WORDS = 5;

/** A spelling that was heard, and what it is suggested it should have been. */
export interface SuggestedVariant {
  readonly heard: string;
  readonly canonical: string;
}

const A_LETTER = /\p{L}/u;

const wordsOf = (spelling: string): string[] => spelling.split(' ').filter((word) => word !== '');

/** Whether `inner` stands in `outer` as whole words in a row, in any case. */
function isWordsOf(outer: string, inner: string): boolean {
  return ` ${vocabularyKey(outer)} `.includes(` ${vocabularyKey(inner)} `);
}

/**
 * Why a heard spelling may not become a misheard variant of `canonical`
 * (P29-06), or null when it may. A variant rewrites text wherever it stands
 * as a word, in every meeting that arrives after it is accepted, so what may
 * be one is held to more than "the model thought so":
 *
 * - it is a spelling, not a sentence, and has a letter in it;
 * - it is not the right spelling itself, nor that spelling in other capitals
 *   — a variant matches as written, and `mark` for `Mark` would rewrite the
 *   everyday word;
 * - it is not made of everyday words alone;
 * - it is not the right spelling of something else, nor what a person goes
 *   by (a name or an alias), nor words out of anyone's name — `Quill` is not
 *   a mishearing of anything while there is a `Mara Quill`;
 * - it is not already listed as misheard, for this or for anything else;
 * - and what it would be corrected to is not itself listed as a mishearing.
 *
 * It is asked when a suggestion is read from a model's answer and again when
 * one is accepted, since the vocabulary may have grown in between.
 */
export function suggestedVariantRefusal(
  suggestion: SuggestedVariant,
  vocabulary: Pick<Vocabulary, 'entries' | 'conflicts'> & Partial<Pick<Vocabulary, 'speakers'>>,
): string | null {
  const heard = tidySpelling(suggestion.heard);
  const canonical = tidySpelling(suggestion.canonical);
  const shape = shapeProblem(heard, canonical);
  if (shape !== null) return shape;
  if (wordsOf(heard).every(isCommonWord)) {
    return `“${heard}” is an everyday word, and would be rewritten wherever anyone says it.`;
  }
  return knownSpellingProblem({ heard, canonical }, vocabulary);
}

function shapeProblem(heard: string, canonical: string): string | null {
  if (heard === '' || canonical === '') return 'It needs both what was heard and the right spelling.';
  if (!isSearchable(heard) || !A_LETTER.test(heard)) {
    return `“${heard}” has no letter in it, so it is no spelling of a name.`;
  }
  const tooLong = [heard, canonical].find(
    (spelling) => [...spelling].length > MAX_SUGGESTED_SPELLING_CHARACTERS,
  );
  if (tooLong !== undefined || wordsOf(heard).length > MAX_HEARD_WORDS) {
    return 'It is longer than a name: a misheard spelling is a few words at most.';
  }
  if (heard === canonical) return `“${heard}” is already the right spelling.`;
  if (vocabularyKey(heard) === vocabularyKey(canonical)) {
    return `“${heard}” is “${canonical}” in other capitals; a variant matches as written, so the plain word would be rewritten too.`;
  }
  if (isWordsOf(canonical, heard)) {
    return `“${heard}” is part of “${canonical}” itself, not a mishearing of it.`;
  }
  return null;
}

/** Why the spellings clash with what the vocabulary already holds, or null. */
function knownSpellingProblem(
  { heard, canonical }: SuggestedVariant,
  vocabulary: Pick<Vocabulary, 'entries' | 'conflicts'> & Partial<Pick<Vocabulary, 'speakers'>>,
): string | null {
  const key = vocabularyKey(heard);
  if ((vocabulary.speakers?.get(key) ?? []).length > 0) {
    return `“${heard}” is what someone in the vault goes by, so it is not a mishearing.`;
  }
  if (vocabulary.conflicts.some((conflict) => conflict.form === heard)) {
    return `“${heard}” is already claimed by more than one note.`;
  }
  for (const entry of vocabulary.entries) {
    if (vocabularyKey(entry.canonical) === key) {
      return `“${heard}” is the right spelling of something else.`;
    }
    if (entry.form === heard) {
      return entry.canonical === canonical
        ? `“${heard}” is already listed as a misheard spelling of “${canonical}”.`
        : `“${heard}” is already listed as a misheard spelling of “${entry.canonical}”.`;
    }
    if (entry.form === canonical && entry.canonical !== canonical) {
      return `“${canonical}” is itself listed as a misheard spelling of “${entry.canonical}”.`;
    }
    if (entry.canonical !== canonical && isWordsOf(entry.canonical, heard)) {
      return `“${heard}” is part of the name “${entry.canonical}”.`;
    }
  }
  return null;
}

/** Whether the vocabulary already has `canonical` as a right spelling: a term's, a person's or a company's. */
export function isKnownSpelling(canonical: string, vocabulary: Pick<Vocabulary, 'entries'>): boolean {
  const spelling = tidySpelling(canonical);
  return vocabulary.entries.some((entry) => entry.canonical === spelling);
}
