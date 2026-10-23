/**
 * How suggested glossary terms (#19) compare spellings: looser than
 * {@link vocabularyKey}, which correction matches by, and only ever used to
 * decide what is already known or what a suggestion is known by.
 */

import { vocabularyKey } from './spelling.ts';

/** A combining mark on a Latin base letter, once decomposed: the U+0301 of `é`. */
const ACCENTED_LATIN = /([a-z])[\u0300-\u036f]+/gu;
/** A combining mark on a Latin or Greek base letter: the tonos of `ά` as well. */
const ACCENTED_LATIN_OR_GREEK = /([a-z\u03b1-\u03c9])[\u0300-\u036f]+/gu;
/** Letters drawn with a stroke, which no decomposition takes apart. */
const STROKES: Readonly<Record<string, string>> = {
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ħ: 'h',
  ŧ: 't',
  ƀ: 'b',
  ɨ: 'i',
};
const STROKED = new RegExp(`[${Object.keys(STROKES).join('')}]`, 'gu');
/** A possessive at the end of a spelling, one or more: `Larkspur's`, `Atlas's`. */
const POSSESSIVE = /(?:['’]s)+$/u;

/**
 * What a suggested term is known by, and what known spellings are compared
 * by: tidied, any case, the accents on a Latin letter — a base `a`–`z` —
 * dropped (`Quillé` is `quille`, `José` is `jose`), then a possessive `'s`
 * at the end dropped (`Atlas's` and `Atlas’ś` are `atlas`). Letters of other
 * scripts keep their marks: `Майя` is not `Маия`. A plural is never folded,
 * so `Lucas` and `Luca` are two names. Idempotent: what it gives keys to
 * itself, because accents are folded before the possessive is looked for and
 * the possessive is dropped until none is left.
 */
export function glossaryKey(spelling: string): string {
  let key = vocabularyKey(spelling).normalize('NFD').replace(ACCENTED_LATIN, '$1').normalize('NFC');
  for (let before = ''; before !== key;) {
    before = key;
    key = key.replace(POSSESSIVE, '').trim();
  }
  return key;
}

/** A combining mark on a Latin base letter of either case. */
const ACCENTED_LATIN_ANY_CASE = /([A-Za-z])[\u0300-\u036f]+/gu;

/**
 * Text with the accents on its Latin letters dropped and its case kept:
 * `José` is `Jose`. What a proposal's file is named by, so two spellings one
 * {@link glossaryKey} gives a single id also name a single file.
 */
export function withoutLatinAccents(text: string): string {
  return text.normalize('NFD').replace(ACCENTED_LATIN_ANY_CASE, '$1').normalize('NFC');
}

/**
 * A spelling with its diacritics gone, for telling a fix of accents alone
 * from a mishearing: any case, the marks on Latin and Greek letters dropped
 * (`José` is `jose`, `Σοφία` is `σοφια`), and stroked letters read as their
 * base (`Bjørn` is `bjorn`, `Łukasz` is `lukasz`). Cyrillic `й` is a letter
 * of its own and is kept.
 */
export function withoutDiacritics(spelling: string): string {
  return vocabularyKey(spelling)
    .normalize('NFD')
    .replace(ACCENTED_LATIN_OR_GREEK, '$1')
    .normalize('NFC')
    .replace(STROKED, (letter) => STROKES[letter] ?? letter);
}

/**
 * Letters as a reader counts them: each letter, and each spacing vowel sign
 * written beside one (`ा` in `राम`, a `\p{Mc}`). An accent on a letter
 * (`\p{Mn}`) adds none.
 */
const READ_LETTER = /[\p{L}\p{Mc}]/gu;
/** A Hangul syllable: one is a whole syllable, so two make a name. */
const HANGUL = /^\p{Script=Hangul}+$/u;
/** Scripts written without spaces between words, where a name cannot be found as a word. */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** How many letters a spelling holds, as {@link READ_LETTER} counts them. */
export function readLetterCount(spelling: string): number {
  return (spelling.match(READ_LETTER) ?? []).length;
}

/** Whether a spelling is Hangul syllables alone, spaces aside. */
export function isHangul(spelling: string): boolean {
  return HANGUL.test(spelling.replace(/\s+/gu, ''));
}

/** Whether a spelling holds a script written without spaces between words. */
export function hasUnspacedScript(spelling: string): boolean {
  return UNSPACED.test(spelling);
}
