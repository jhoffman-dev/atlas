import { isCommonWord } from './common-words.ts';
import { isSearchable, tidySpelling, vocabularyKey } from './spelling.ts';
import {
  glossaryKey,
  hasUnspacedScript,
  isHangul,
  readLetterCount,
  withoutDiacritics,
} from './spelling-folds.ts';

/** Where suggestions are keyed, kept importable from here. */
export { glossaryKey } from './spelling-folds.ts';
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
/** The fewest letters a misheard spelling holds: `Q` or `PR` would be rewritten in every message. */
export const MIN_HEARD_LETTERS = 3;
/** The fewest Hangul syllables a misheard spelling holds: each is a whole syllable, `민수` a name. */
export const MIN_HEARD_HANGUL_SYLLABLES = 2;
/** A possessive at the end of a spelling, one or more: `Larkspur's`, `Atlas's`. */
const POSSESSIVE = /(?:['’]s)+$/u;
/** A contraction or possessive ending inside heard words: the `'s` of `team's`, the `'t` of `don't`. */
const CONTRACTION = /['’]\p{L}{1,2}(?!\p{L})/gu;

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
 * - both spellings are a name's, not a sentence's, with a letter in each;
 *   what was heard has at least {@link MIN_HEARD_LETTERS} letters (two Hangul
 *   syllables), is in a script written with spaces, and differs from the
 *   right spelling by more than case, a possessive, a plural, or accents and
 *   strokes alone — `Jose` is a name of its own, and as a variant of `José`
 *   would rewrite every Jose;
 * - what was heard is not everyday words, read as words whatever joins them
 *   (`follow-up`, `step 2`, `mark,`): a variant is rewritten wherever it
 *   stands. The right spelling may be (`Team Sync`);
 * - the right spelling is not already in the glossary — a term's, a
 *   person's or a company's, as a right spelling or a misheard one, or what
 *   someone goes by;
 * - and what was heard is not a spelling the vault already knows, nor words
 *   out of one: `Quill` is no mishearing while there is a `Mara Quill`.
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
    everydayProblem(heard) ??
    knownProblem({ canonical, variants: [heard] }, vocabulary)
  );
}

/**
 * What the vocabulary already has of a term, the one check proposing and
 * accepting share: its right spelling known, or a misheard spelling of it
 * known, part of a known name, or what someone goes by.
 */
function knownProblem(
  { canonical, variants }: { canonical: string; variants: readonly string[] },
  vocabulary: SuggestionVocabulary,
): string | null {
  return (
    knownTermProblem(canonical, vocabulary) ??
    variants.reduce<string | null>(
      (found, heard) => found ?? knownHeardProblem(heard, vocabulary),
      null,
    )
  );
}

/**
 * Why a term proposal may no longer be accepted as it stands (#19), or null:
 * the vault has moved on since it was proposed, and the term is held to what
 * proposing it was held to, against the vocabulary as it is now. A misheard
 * spelling now another note's says so first — accepted, two notes would claim
 * it, and correction would put it right to neither.
 */
export function acceptedTermRefusal(
  term: { readonly canonical: string; readonly variants: readonly string[] },
  vocabulary: SuggestionVocabulary,
): string | null {
  const canonical = tidySpelling(term.canonical);
  const known = knownTermProblem(canonical, vocabulary);
  if (known !== null) return known;
  for (const variant of term.variants.map(tidySpelling)) {
    const claimed = vocabulary.entries.find(
      (entry) => entry.form === variant && entry.canonical !== canonical,
    );
    if (claimed !== undefined) {
      return `“${variant}” is now a misheard spelling of “${claimed.canonical}”; accepted, neither would be put right.`;
    }
    if (vocabulary.conflicts.some((conflict) => conflict.form === variant)) {
      return `“${variant}” is already claimed by more than one note.`;
    }
  }
  return knownProblem({ canonical, variants: term.variants.map(tidySpelling) }, vocabulary);
}

function shapeProblem(heard: string, canonical: string): string | null {
  if (heard === '' || canonical === '') {
    return 'It needs both what was heard and the right spelling.';
  }
  const unspelt = [heard, canonical].find(
    (spelling) => !isSearchable(spelling) || !A_LETTER.test(spelling),
  );
  if (unspelt !== undefined) {
    return `“${unspelt}” has no letter in it, so it is no spelling of a name.`;
  }
  const tooLong = [heard, canonical].some(
    (spelling) => [...spelling].length > MAX_SUGGESTED_SPELLING_CHARACTERS,
  );
  if (tooLong || wordsOf(heard).length > MAX_HEARD_WORDS) {
    return 'It is longer than a name: a misheard spelling is a few words at most.';
  }
  const script = scriptProblem(heard);
  if (script !== null) return script;
  if (sameButForEnding(heard, canonical)) {
    return `“${heard}” is “${canonical}” in other capitals or as a plural, not a mishearing of it.`;
  }
  if (withoutDiacritics(heard) === withoutDiacritics(canonical)) {
    return `“${heard}” is “${canonical}” but for its accents, and a name of its own: as a misheard spelling it would rewrite every “${heard}” in later meetings.`;
  }
  if (isWordsOf(canonical, heard)) {
    return `“${heard}” is part of “${canonical}” itself, not a mishearing of it.`;
  }
  return null;
}

/**
 * Why heard text cannot be told apart in prose: a script written without
 * spaces, which correction (whole words) cannot find a name inside, or too
 * few letters — {@link MIN_HEARD_LETTERS}, or {@link MIN_HEARD_HANGUL_SYLLABLES}
 * Hangul syllables.
 */
function scriptProblem(heard: string): string | null {
  if (hasUnspacedScript(heard)) {
    return `“${heard}” is written without spaces between words, and DFAI can’t correct names inside unspaced text yet.`;
  }
  const fewest = isHangul(heard) ? MIN_HEARD_HANGUL_SYLLABLES : MIN_HEARD_LETTERS;
  if (readLetterCount(heard) >= fewest) return null;
  return `“${heard}” is too short to tell from everyday text: a misheard spelling has at least ${fewest} letters.`;
}

/** Whether two spellings differ only in case, a possessive or a plural `s`. */
function sameButForEnding(left: string, right: string): boolean {
  const [a, b] = [left, right].map((spelling) => vocabularyKey(spelling).replace(POSSESSIVE, ''));
  return a === b || a === `${b}s` || b === `${a}s`;
}

/** The words of heard text, whatever joins them: hyphens, digits, punctuation, a `'s`. */
function heardWords(heard: string): string[] {
  return heard
    .replace(CONTRACTION, '')
    .split(/[^\p{L}]+/u)
    .filter((word) => word !== '');
}

function everydayProblem(heard: string): string | null {
  return heardWords(heard).every(isCommonWord)
    ? `“${heard}” is everyday words, and would be rewritten wherever anyone says it.`
    : null;
}

/** Every spelling the vocabulary holds, right or misheard, and what each person goes by. */
function knownSpellings(vocabulary: SuggestionVocabulary): string[] {
  return [
    ...vocabulary.entries.flatMap((entry) => [entry.form, entry.canonical]),
    ...vocabulary.conflicts.map((conflict) => conflict.form),
    ...(vocabulary.speakers?.keys() ?? []),
  ];
}

/**
 * The spelling the vault has that `spelling` is, by {@link glossaryKey} — any
 * case, a possessive, accents on Latin letters — or null. A plural is never
 * folded: `Lucas` is a name of its own beside a known `Luca`.
 */
export function knownSpellingOf(spelling: string, vocabulary: SuggestionVocabulary): string | null {
  const known = new Map<string, string>();
  // The first spelling of a key is kept: a note's own spelling before a speaker's lower-cased one.
  for (const each of knownSpellings(vocabulary)) {
    if (!known.has(glossaryKey(each))) known.set(glossaryKey(each), each);
  }
  return known.get(glossaryKey(spelling)) ?? null;
}

function knownTermProblem(canonical: string, vocabulary: SuggestionVocabulary): string | null {
  const known = knownSpellingOf(canonical, vocabulary);
  return known === null ? null : `“${canonical}” is already in the glossary, as “${known}”.`;
}

function knownHeardProblem(heard: string, vocabulary: SuggestionVocabulary): string | null {
  if (knownSpellingOf(heard, vocabulary) !== null) {
    return `“${heard}” is a spelling the vault already knows, so it is not a mishearing.`;
  }
  const named = knownSpellings(vocabulary).find((spelling) => isWordsOf(spelling, heard));
  return named === undefined ? null : `“${heard}” is part of the name “${named}”.`;
}
