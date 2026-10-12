import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { isCommonWord } from './common-words.ts';
import {
  isKnownSpelling,
  MAX_HEARD_WORDS,
  MAX_SUGGESTED_SPELLING_CHARACTERS,
  suggestedVariantRefusal,
} from './term-suggestion.ts';
import { vocabulary } from './vocabulary.ts';

/**
 * P29-06: what may become a misheard spelling. A variant rewrites text
 * wherever it stands as a word, so the rule is strict about what it refuses.
 */

const note = (title: string) => createVaultPath(`Terms/${title}.md`);
const term = (canonical: string, variants: string[] = []) => ({
  path: note(canonical),
  canonical,
  variants,
  kind: null,
});
const named = (name: string, aliases: string[] = []) => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  aliases,
});

const VOCABULARY = vocabulary({
  terms: [
    term('Larkspur Payroll', ['Larkspur Payrol']),
    term('Larkspur Pay', ['Lark Spur Pay']),
    term('Quillwork'),
  ],
  people: [named('Mara Quill', ['MQ Boss']), named('Tobias Fenn')],
  companies: [named('Larkspur Holdings')],
});

const refusal = (heard: string, canonical: string, known = VOCABULARY) =>
  suggestedVariantRefusal({ heard, canonical }, known);

describe('a heard spelling that may become a variant', () => {
  it.each([
    ['Lark Spur Payroll', 'Larkspur Payroll'],
    ['Mara Quil', 'Mara Quill'],
    ['Tobias Fen', 'Tobias Fenn'],
    ['Mark Spur', 'Larkspur Payroll'],
  ])('allows “%s” as a mishearing of “%s”', (heard, canonical) => {
    expect(refusal(heard, canonical)).toBeNull();
  });

  it('allows a spelling the vocabulary has never seen, against an empty vocabulary', () => {
    expect(
      refusal(
        'Lark Spur Pay',
        'Larkspur Pay',
        vocabulary({ terms: [], people: [], companies: [] }),
      ),
    ).toBeNull();
  });

  it('allows a vocabulary with no speakers to be asked, as the accept path may hold one', () => {
    expect(
      suggestedVariantRefusal(
        { heard: 'Lark Spur Payroll', canonical: 'Larkspur Payroll' },
        { entries: VOCABULARY.entries, conflicts: VOCABULARY.conflicts },
      ),
    ).toBeNull();
  });

  it('allows the longest name: five words, and 80 letters', () => {
    const heard = 'Qxz Qxy Qxw Qxv Qxu';
    expect(heard.split(' ')).toHaveLength(MAX_HEARD_WORDS);
    expect(refusal(heard, 'Quixotic Unit')).toBeNull();
    const longest = 'x'.repeat(MAX_SUGGESTED_SPELLING_CHARACTERS);
    expect(refusal(longest, 'Zed')).toBeNull();
    expect(refusal('Zed', longest)).toBeNull();
  });
});

describe('a heard spelling that is not a spelling of a name', () => {
  it('refuses a spelling or a right spelling that is empty', () => {
    expect(refusal('', 'Larkspur Pay')).toMatch(/needs both/);
    expect(refusal('   ', 'Larkspur Pay')).toMatch(/needs both/);
    expect(refusal('Lark Spur Pay', '')).toMatch(/needs both/);
  });

  it.each(['123', '---', '~', '4 2'])('refuses “%s”, which has no letter in it', (heard) => {
    expect(refusal(heard, 'Larkspur Pay')).toMatch(/no letter/);
  });

  it('refuses a heard spelling over 80 characters', () => {
    expect(refusal('x'.repeat(MAX_SUGGESTED_SPELLING_CHARACTERS + 1), 'Zed')).toMatch(
      /longer than a name/,
    );
  });

  it('refuses a right spelling over 80 characters', () => {
    expect(refusal('Zed', 'x'.repeat(MAX_SUGGESTED_SPELLING_CHARACTERS + 1))).toMatch(
      /longer than a name/,
    );
  });

  it('counts characters, not code units, against the limit', () => {
    const astral = '😀'.repeat(MAX_SUGGESTED_SPELLING_CHARACTERS);
    expect(astral.length).toBeGreaterThan(MAX_SUGGESTED_SPELLING_CHARACTERS);
    expect(refusal('Zed', astral)).toBeNull();
  });

  it('refuses a heard spelling of more than five words', () => {
    expect(refusal('Qxz Qxy Qxw Qxv Qxu Qxt', 'Quixotic Unit')).toMatch(/longer than a name/);
  });
});

describe('a heard spelling that is the right spelling', () => {
  it('refuses the right spelling itself', () => {
    expect(refusal('Larkspur Pay', 'Larkspur Pay')).toMatch(/already the right spelling/);
  });

  it('refuses the right spelling itself once the extra spaces are tidied', () => {
    expect(refusal('  Larkspur   Pay ', 'Larkspur Pay')).toMatch(/already the right spelling/);
  });

  it.each([
    ['larkspur pay', 'Larkspur Pay'],
    ['LARKSPUR PAY', 'Larkspur Pay'],
    ['mark', 'Mark'],
  ])('refuses “%s” for “%s”, the same in other capitals', (heard, canonical) => {
    expect(refusal(heard, canonical)).toMatch(/other capitals/);
  });

  it('refuses words out of the right spelling itself', () => {
    expect(refusal('Quill', 'Mara Quill')).toMatch(/part of “Mara Quill” itself/);
    expect(refusal('mara', 'Mara Quill')).toMatch(/part of “Mara Quill” itself/);
    expect(refusal('Spur Payroll', 'Lark Spur Payroll')).toMatch(/part of/);
  });

  it('does not take letters inside a word for words out of the name', () => {
    expect(refusal('Quil', 'Mara Quill')).toBeNull();
  });
});

describe('a heard spelling made of everyday words', () => {
  it.each([['mark'], ['Mark'], ['the plan'], ['THE PLAN'], ['Thanks Friday']])(
    'refuses “%s”',
    (heard) => {
      expect(refusal(heard, 'Marq Fenn')).toMatch(/everyday word/);
    },
  );

  it('allows a spelling with one word that is not everyday', () => {
    expect(refusal('the Larkspur', 'Larkspur Payroll')).toBeNull();
  });
});

describe('a heard spelling the vocabulary already holds', () => {
  it('refuses the right spelling of another term', () => {
    expect(refusal('Quillwork', 'Quillwerk')).toMatch(/right spelling of something else/);
  });

  it('refuses the right spelling of another, however it is capitalised', () => {
    expect(refusal('quillwork', 'Quillwerk')).toMatch(/right spelling of something else/);
  });

  it('refuses the right spelling of a person: it is what someone goes by', () => {
    expect(refusal('Tobias Fenn', 'Toby Fenn')).toMatch(/what someone in the vault goes by/);
  });

  it('refuses the right spelling of a company', () => {
    expect(refusal('Larkspur Holdings', 'Larkspur Holding')).toMatch(/something else/);
  });

  it('refuses what a person goes by: their alias', () => {
    expect(refusal('MQ Boss', 'Mara Quill')).toMatch(/what someone in the vault goes by/);
    expect(refusal('mq boss', 'Mara Quillen')).toMatch(/what someone in the vault goes by/);
  });

  it('refuses a spelling two notes disagree about', () => {
    const disputed = vocabulary({
      terms: [term('Larkspur Pay', ['Lark Pay']), term('Larkspur Payroll', ['Lark Pay'])],
      people: [],
      companies: [],
    });
    expect(refusal('Lark Pay', 'Larkspur Pay', disputed)).toMatch(/claimed by more than one note/);
  });

  it('refuses a spelling already listed as misheard for the same right spelling', () => {
    expect(refusal('Lark Spur Pay', 'Larkspur Pay')).toMatch(
      /already listed as a misheard spelling of “Larkspur Pay”/,
    );
  });

  it('refuses a spelling already listed as misheard for something else', () => {
    expect(refusal('Lark Spur Pay', 'Larkspur Payroll')).toMatch(
      /already listed as a misheard spelling of “Larkspur Pay”/,
    );
  });

  it('refuses a right spelling that is itself a listed mishearing', () => {
    expect(refusal('Lark Sper Pay', 'Lark Spur Pay')).toMatch(
      /“Lark Spur Pay” is itself listed as a misheard spelling of “Larkspur Pay”/,
    );
  });

  it('refuses words out of someone else’s name: Quill, while there is a Mara Quill', () => {
    expect(refusal('Quill', 'Quillen')).toMatch(/part of the name “Mara Quill”/);
    expect(refusal('mara', 'Maria')).toMatch(/part of the name “Mara Quill”/);
  });

  it('refuses words out of a term’s name', () => {
    expect(refusal('Larkspur', 'Larkspurs')).toMatch(/part of the name “Larkspur/);
  });

  it('reads a spelling as written, so a spelling the vocabulary has only in other capitals is another', () => {
    expect(refusal('Lark SPUR Payrol', 'Larkspur Payroll')).toBeNull();
  });
});

describe('whether a right spelling is already known', () => {
  it('knows a term’s, a person’s and a company’s', () => {
    expect(isKnownSpelling('Larkspur Pay', VOCABULARY)).toBe(true);
    expect(isKnownSpelling('Mara Quill', VOCABULARY)).toBe(true);
    expect(isKnownSpelling('Larkspur Holdings', VOCABULARY)).toBe(true);
  });

  it('knows it once the extra spaces are tidied away', () => {
    expect(isKnownSpelling('  Mara   Quill ', VOCABULARY)).toBe(true);
  });

  it('does not know a name that is only listed as misheard, or one that is not there', () => {
    expect(isKnownSpelling('Lark Spur Pay', VOCABULARY)).toBe(false);
    expect(isKnownSpelling('Larkspur Payments', VOCABULARY)).toBe(false);
  });

  it('does not take another capitalisation for the same spelling', () => {
    expect(isKnownSpelling('mara quill', VOCABULARY)).toBe(false);
  });
});

describe('everyday words', () => {
  it.each(['mark', 'Mark', 'THE', 'plan', 'Friday', 'march', 'ticket'])('knows “%s”', (word) => {
    expect(isCommonWord(word)).toBe(true);
  });

  it.each(['Larkspur', 'Quill', 'Fenn', 'xyzzy', ''])('does not know “%s”', (word) => {
    expect(isCommonWord(word)).toBe(false);
  });
});
