import { isCommonWord } from './common-words.ts';
import { isSearchable, tidySpelling, vocabularyKey } from './spelling.ts';
import type { Vocabulary } from './vocabulary.ts';

/** The longest a suggested spelling runs: a name, not a sentence. */
export const MAX_SUGGESTED_SPELLING_CHARACTERS = 80;

/** The most words a misheard spelling holds: `Lark Spur Pay`, not a phrase. */
export const MAX_HEARD_WORDS = 5;

/**
 * A term a meeting's transcript seems to have misheard (#19): the words as
 * the transcript has them, and the right spelling they should have been.
 * Accepted, it is a term whose variant is what was heard, so the next
 * meeting's correction puts those words right.
 */
export interface SuggestedTerm {
  readonly heard: string;
  readonly canonical: string;
}

/** What a suggestion is held to: the spellings the vault's terms, people and companies have. */
export type SuggestionVocabulary = Pick<Vocabulary, 'entries' | 'conflicts'> &
  Partial<Pick<Vocabulary, 'speakers'>>;

const A_LETTER = /\p{L}/u;
/** The accents Latin letters carry once decomposed: `é` is `e` and one of these. */
const LATIN_ACCENTS = /[̀-ͯ]/gu;
/** A plural or possessive at the end of a spelling: `Larkspurs`, `Larkspur's` — never the `ss` of `Ross`. */
const PLURAL_ENDING = /(?:['’]s|(?<!s)s)$/u;

/**
 * What makes two spellings one term to the glossary: tidied, any case, any
 * accent on a Latin letter (`Quillé` is `quille`), and a plural or `'s` at the
 * end dropped (`Larkspurs` is `Larkspur`). Looser than {@link vocabularyKey},
 * which correction matches by: it decides only what is already known, and
 * what a suggestion is known by, so it errs towards "known".
 */
export function glossaryKey(spelling: string): string {
  const unaccented = vocabularyKey(spelling)
    .normalize('NFD')
    .replace(LATIN_ACCENTS, '')
    .normalize('NFC');
  return unaccented.replace(PLURAL_ENDING, '');
}

const wordsOf = (spelling: string): string[] => spelling.split(' ').filter((word) => word !== '');

/** Whether `inner` stands in `outer` as whole words in a row, in any case. */
function isWordsOf(outer: string, inner: string): boolean {
  return ` ${vocabularyKey(outer)} `.includes(` ${vocabularyKey(inner)} `);
}

/**
 * Why a suggested term may not be proposed (#19), or null when it may. Each
 * reason is deterministic, so the same answer and vault make the same
 * proposals on every Mac:
 *
 * - both spellings are a name's, not a sentence's, with a letter in each, and
 *   they differ by more than case, accents or a plural;
 * - neither is made of everyday words alone: an everyday word as a variant
 *   would be rewritten wherever anyone said it;
 * - the right spelling is not already in the glossary — a term's, a
 *   person's or a company's, as a right spelling or a misheard one, or what
 *   someone goes by;
 * - and what was heard is not a spelling the vault already knows, nor words
 *   out of a name it has: `Quill` is no mishearing while there is a `Mara Quill`.
 *
 * It is asked again each time the stored answer is read, so a term added since
 * leaves its suggestion out.
 */
export function suggestedTermRefusal(
  suggestion: SuggestedTerm,
  vocabulary: SuggestionVocabulary,
): string | null {
  const heard = tidySpelling(suggestion.heard);
  const canonical = tidySpelling(suggestion.canonical);
  return (
    shapeProblem(heard, canonical) ??
    everydayProblem(heard, canonical) ??
    knownTermProblem(canonical, vocabulary) ??
    knownHeardProblem(heard, vocabulary)
  );
}

function shapeProblem(heard: string, canonical: string): string | null {
  if (heard === '' || canonical === '')
    return 'It needs both what was heard and the right spelling.';
  const unspelt = [heard, canonical].find(
    (spelling) => !isSearchable(spelling) || !A_LETTER.test(spelling),
  );
  if (unspelt !== undefined)
    return `“${unspelt}” has no letter in it, so it is no spelling of a name.`;
  const tooLong = [heard, canonical].some(
    (spelling) => [...spelling].length > MAX_SUGGESTED_SPELLING_CHARACTERS,
  );
  if (tooLong || wordsOf(heard).length > MAX_HEARD_WORDS) {
    return 'It is longer than a name: a misheard spelling is a few words at most.';
  }
  if (glossaryKey(heard) === glossaryKey(canonical)) {
    return `“${heard}” is “${canonical}” in other capitals or accents, not a mishearing of it.`;
  }
  if (isWordsOf(canonical, heard))
    return `“${heard}” is part of “${canonical}” itself, not a mishearing of it.`;
  return null;
}

function everydayProblem(heard: string, canonical: string): string | null {
  const everyday = [canonical, heard].find((spelling) => wordsOf(spelling).every(isCommonWord));
  return everyday === undefined
    ? null
    : `“${everyday}” is everyday words, and would be rewritten wherever anyone says it.`;
}

/** Every spelling the vocabulary holds, right or misheard, and what each person goes by. */
function knownSpellings(vocabulary: SuggestionVocabulary): string[] {
  return [
    ...vocabulary.entries.flatMap((entry) => [entry.form, entry.canonical]),
    ...vocabulary.conflicts.map((conflict) => conflict.form),
    ...(vocabulary.speakers?.keys() ?? []),
  ];
}

function knownTermProblem(canonical: string, vocabulary: SuggestionVocabulary): string | null {
  const key = glossaryKey(canonical);
  const known = knownSpellings(vocabulary).find((spelling) => glossaryKey(spelling) === key);
  return known === undefined ? null : `“${canonical}” is already in the glossary, as “${known}”.`;
}

function knownHeardProblem(heard: string, vocabulary: SuggestionVocabulary): string | null {
  const key = glossaryKey(heard);
  if (knownSpellings(vocabulary).some((spelling) => glossaryKey(spelling) === key)) {
    return `“${heard}” is a spelling the vault already knows, so it is not a mishearing.`;
  }
  const named = vocabulary.entries.find((entry) => isWordsOf(entry.canonical, heard));
  return named === undefined ? null : `“${heard}” is part of the name “${named.canonical}”.`;
}
