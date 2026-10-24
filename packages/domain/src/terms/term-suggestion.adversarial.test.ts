import { describe, expect, it } from 'vitest';
import { correctTerms } from './correct-terms.ts';
import { glossaryKey, suggestedTermRefusal } from './term-suggestion.ts';

/**
 * Adversarial pass on PR #553 (#19). A suggestion's heard spelling becomes a
 * variant that correction rewrites wherever it stands, so the everyday-word
 * guard must see through punctuation, hyphens and digits; and glossaryKey,
 * which both refuses suggestions and names their proposal id, must neither
 * drift on a second pass nor fold apart letters it never claims to fold.
 */

const EMPTY = { entries: [], conflicts: [] };
const refusalOf = (heard: string, canonical: string) =>
  suggestedTermRefusal({ heard, canonical }, EMPTY);

describe('a heard spelling of everyday words in disguise', () => {
  it.each([
    ['a trailing comma', 'mark,', 'Marq'],
    ['a full stop', 'Ok.', 'Okee'],
    ['a hyphen', 'follow-up', 'Folloup'],
    ['a hyphen', 'check-in', 'Chekin'],
    ['a hyphen', 'to-do', 'Todoo'],
    ['a digit', 'step 2', 'Steptoo'],
  ])('is refused when hidden by %s (%s)', (_, heard, canonical) => {
    // Accepted, the variant rewrites every such phrase: correction matches it as written.
    expect(refusalOf(heard, canonical)).not.toBeNull();
  });

  it('would otherwise rewrite the everyday phrase in every later meeting', () => {
    const entries = [{ form: 'follow-up', canonical: 'Folloup', claims: [] }];
    // Shows the stake: a variant of `follow-up` takes every follow-up anyone writes.
    expect(correctTerms('Book a follow-up with the team.', { entries }).text).toBe(
      'Book a Folloup with the team.',
    );
    expect(refusalOf('follow-up', 'Folloup')).not.toBeNull();
  });
});

describe('a heard spelling too short to be a name', () => {
  it('is refused when it is a single letter, which correction would rewrite everywhere', () => {
    expect(refusalOf('Q', 'Kew')).not.toBeNull();
  });
});

describe('glossaryKey', () => {
  it('is idempotent on a possessive of a name ending in s', () => {
    const once = glossaryKey("Lucas's");
    expect(glossaryKey(once)).toBe(once);
  });

  it('keys a possessive of a name ending in s as that name, as it does for any other name', () => {
    expect(glossaryKey('Larkspur’s')).toBe(glossaryKey('Larkspur'));
    expect(glossaryKey("Atlas's")).toBe(glossaryKey('Atlas'));
  });

  it('never folds a Cyrillic letter into another: й is not и', () => {
    // The doc folds accents on Latin letters only; й (short i) is its own letter in Russian.
    expect(glossaryKey('Майя')).not.toBe(glossaryKey('Маия'));
  });
});

/** mulberry32: a seeded RNG, so every run draws the same strings. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATIN = 'abcdeiklmnoqrstuz';
const LATIN_ACCENTED: Record<string, string> = { a: 'á', e: 'è', i: 'ï', o: 'ô', u: 'ü', n: 'ñ' };
const CYRILLIC = 'аиклмнорсту';

function draw(random: () => number, alphabet: string, length: number): string {
  let text = '';
  for (let at = 0; at < length; at += 1) {
    text += alphabet[Math.floor(random() * alphabet.length)];
  }
  return text;
}

describe('glossaryKey over seeded strings', () => {
  const RUNS = 500;

  it('is idempotent, plurals and possessives included', () => {
    const random = seeded(19);
    const failures: string[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const ending = ['', 's', "'s", "s's", 'ss'][Math.floor(random() * 5)]!;
      const spelling = draw(random, LATIN, 2 + Math.floor(random() * 6)) + ending;
      const once = glossaryKey(spelling);
      if (glossaryKey(once) !== once) failures.push(spelling);
    }
    expect(failures).toEqual([]);
  });

  it('is stable under case and the Latin accents it folds', () => {
    const random = seeded(553);
    const failures: string[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const spelling = draw(random, LATIN, 2 + Math.floor(random() * 8));
      const accented = [...spelling].map((letter) => LATIN_ACCENTED[letter] ?? letter).join('');
      const key = glossaryKey(spelling);
      if (glossaryKey(spelling.toUpperCase()) !== key || glossaryKey(accented) !== key) {
        failures.push(spelling);
      }
    }
    expect(failures).toEqual([]);
  });

  it('never gives one key to two Cyrillic spellings that differ in a letter', () => {
    const random = seeded(2026);
    const failures: string[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const stem = draw(random, CYRILLIC, 3 + Math.floor(random() * 5));
      const at = Math.floor(random() * stem.length);
      // и → й: a different letter of the alphabet, not an accent on one.
      if (stem[at] !== 'и') continue;
      const other = `${stem.slice(0, at)}й${stem.slice(at + 1)}`;
      if (glossaryKey(other) === glossaryKey(stem)) failures.push(`${stem}/${other}`);
    }
    expect(failures).toEqual([]);
  });
});
