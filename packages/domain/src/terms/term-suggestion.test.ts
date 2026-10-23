import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { isCommonWord } from './common-words.ts';
import {
  glossaryKey,
  MAX_HEARD_WORDS,
  MAX_SUGGESTED_SPELLING_CHARACTERS,
  suggestedTermRefusal,
} from './term-suggestion.ts';
import { vocabulary } from './vocabulary.ts';

/**
 * #19: what a meeting may suggest as a new glossary term. Accepted, what was
 * heard becomes a variant that correction rewrites wherever it stands as a
 * word, so the rules say no to everyday words and to anything the vault
 * already spells, however it is capitalised or accented.
 */

const term = (canonical: string, variants: string[] = []) => ({
  path: createVaultPath(`Terms/${canonical}.md`),
  canonical,
  variants,
  kind: null,
});
const named = (folder: string, name: string, aliases: string[] = []) => ({
  path: createVaultPath(`${folder}/${name}.md`),
  name,
  aliases,
});

const VOCABULARY = vocabulary({
  terms: [term('Larkspur Payroll', ['Larkspur Payrol']), term('Quillé')],
  people: [named('People', 'Mara Quill', ['MQ']), named('People', 'Tobias Fenn')],
  companies: [named('Companies', 'Brenwick Labs')],
});
const EMPTY = vocabulary({ terms: [], people: [], companies: [] });

const refusal = (heard: string, canonical: string, known = VOCABULARY) =>
  suggestedTermRefusal({ heard, canonical }, known);

describe('everyday words', () => {
  it.each(['the', 'The', 'MEETING', 'tomorrow', 'gonna'])('knows “%s”', (word) => {
    expect(isCommonWord(word)).toBe(true);
  });

  it.each(['ideas', 'Questions', 'team’s', "team's"])(
    'knows “%s”: an everyday word with a plural or a possessive',
    (word) => {
      expect(isCommonWord(word)).toBe(true);
    },
  );

  it.each(['Larkspur', 'Brenwick', 'Quill', 'xs'])('does not know “%s”', (word) => {
    expect(isCommonWord(word)).toBe(false);
  });
});

describe('the key the glossary compares spellings by', () => {
  it('is the same in any case, spacing and Latin accent', () => {
    expect(glossaryKey('  Lark   Spur ')).toBe('lark spur');
    expect(glossaryKey('LARKSPUR')).toBe(glossaryKey('larkspur'));
    expect(glossaryKey('Quillé')).toBe(glossaryKey('Quille'));
    // Composed and decomposed é are one letter.
    expect(glossaryKey('Quillé')).toBe(glossaryKey('Quillé'));
  });

  it('drops a plural or a possessive at the end, but not the ss of a name', () => {
    expect(glossaryKey('Larkspurs')).toBe('larkspur');
    expect(glossaryKey('Larkspur’s')).toBe('larkspur');
    expect(glossaryKey("Larkspur's")).toBe('larkspur');
    expect(glossaryKey('Bross')).toBe('bross');
  });

  it('tells different names apart', () => {
    expect(glossaryKey('Larkspur')).not.toBe(glossaryKey('Larkspar'));
    expect(glossaryKey('Fenn')).not.toBe(glossaryKey('Fen'));
  });
});

describe('a suggested term that may be proposed', () => {
  it.each([
    ['Lark Spur Pay', 'Larkspur Pay'],
    ['Ida Brenwik', 'Ida Brenwick'],
    ['Quill work', 'Quillwork'],
  ])('allows “%s” heard for “%s”', (heard, canonical) => {
    expect(refusal(heard, canonical)).toBeNull();
  });

  it('allows a suggestion against an empty vocabulary, and one with no speakers', () => {
    expect(refusal('Lark Spur', 'Larkspur', EMPTY)).toBeNull();
    const { entries, conflicts } = VOCABULARY;
    expect(
      suggestedTermRefusal({ heard: 'Lark Spur', canonical: 'Larkspur' }, { entries, conflicts }),
    ).toBeNull();
  });

  it('allows the longest name: five words, and 80 letters', () => {
    const heard = ['Abcd', 'Efgh', 'Ijkl', 'Mnop', 'Qrst'].join(' ');
    expect(heard.split(' ')).toHaveLength(MAX_HEARD_WORDS);
    expect(refusal(heard, 'Abcdefghijklmnopqrst', EMPTY)).toBeNull();
    const longest = 'L'.repeat(MAX_SUGGESTED_SPELLING_CHARACTERS);
    expect(refusal('Lark Spur', longest, EMPTY)).toBeNull();
  });
});

describe('a suggested term that is no name', () => {
  it('refuses one missing what was heard or the right spelling', () => {
    expect(refusal('', 'Larkspur')).toBe('It needs both what was heard and the right spelling.');
    expect(refusal('Lark Spur', '   ')).toBe(
      'It needs both what was heard and the right spelling.',
    );
  });

  it('refuses a spelling with no letter in it', () => {
    expect(refusal('2026', 'Larkspur')).toBe(
      '“2026” has no letter in it, so it is no spelling of a name.',
    );
    expect(refusal('Lark Spur', '--')).toBe(
      '“--” has no letter in it, so it is no spelling of a name.',
    );
  });

  it('refuses a spelling longer than a name, counting characters, not code units', () => {
    const tooLong = 'L'.repeat(MAX_SUGGESTED_SPELLING_CHARACTERS + 1);
    expect(refusal('Lark Spur', tooLong, EMPTY)).toMatch(/^It is longer than a name/);
    // 80 astral letters are 160 code units, and still a name's length.
    const astral = '\u{1D4DB}'.repeat(MAX_SUGGESTED_SPELLING_CHARACTERS);
    expect(refusal('Lark Spur', astral, EMPTY)).toBeNull();
  });

  it('refuses words heard past five', () => {
    expect(refusal('Abcd Efgh Ijkl Mnop Qrst Uvwx', 'Larkspur', EMPTY)).toMatch(
      /^It is longer than a name/,
    );
  });

  it('refuses what was heard when it is the right spelling in other capitals, accents or a plural', () => {
    expect(refusal('larkspur', 'Larkspur', EMPTY)).toBe(
      '“larkspur” is “Larkspur” in other capitals or accents, not a mishearing of it.',
    );
    expect(refusal('Ida Brenwíck', 'Ida Brenwick', EMPTY)).toMatch(/in other capitals or accents/);
    expect(refusal('Larkspurs', 'Larkspur', EMPTY)).toMatch(/in other capitals or accents/);
  });

  it('refuses words out of the right spelling itself', () => {
    expect(refusal('Spur', 'Lark Spur', EMPTY)).toBe(
      '“Spur” is part of “Lark Spur” itself, not a mishearing of it.',
    );
  });
});

describe('a suggested term made of everyday words', () => {
  it('refuses what was heard when every word of it is everyday', () => {
    expect(refusal('the team', 'Theteam', EMPTY)).toBe(
      '“the team” is everyday words, and would be rewritten wherever anyone says it.',
    );
    expect(refusal('Files', 'Fyles', EMPTY)).toMatch(/is everyday words/);
  });

  it('refuses a right spelling that is everyday words', () => {
    expect(refusal('Mondai', 'Monday', EMPTY)).toBe(
      '“Monday” is everyday words, and would be rewritten wherever anyone says it.',
    );
  });

  it('allows a spelling with one word that is not everyday', () => {
    expect(refusal('the Larks Purr', 'The Larkspur', EMPTY)).toBeNull();
  });
});

describe('a suggested term the glossary already has', () => {
  it('refuses a term’s right spelling, in any case or accent', () => {
    expect(refusal('Larks Purr Payroll', 'Larkspur Payroll')).toBe(
      '“Larkspur Payroll” is already in the glossary, as “Larkspur Payroll”.',
    );
    expect(refusal('Larks Purr Payroll', 'larkspur PAYROLL')).toMatch(/already in the glossary/);
    expect(refusal('Quilly', 'Quille')).toBe('“Quille” is already in the glossary, as “Quillé”.');
  });

  it('refuses a term’s right spelling as a plural', () => {
    expect(refusal('Larks Purr Payrolls', 'Larkspur Payrolls')).toMatch(/already in the glossary/);
  });

  it('refuses a spelling the glossary lists as misheard', () => {
    expect(refusal('Lark Spur Payroll', 'Larkspur Payrol')).toMatch(/already in the glossary/);
  });

  it('refuses a person’s or a company’s name, and what a person goes by', () => {
    expect(refusal('Mara Quil', 'Mara Quill')).toBe(
      '“Mara Quill” is already in the glossary, as “Mara Quill”.',
    );
    expect(refusal('Brenwik Labs', 'Brenwick Labs')).toMatch(/already in the glossary/);
    expect(refusal('Em Queue', 'MQ')).toBe('“MQ” is already in the glossary, as “mq”.');
  });

  it('refuses what was heard when the vault already spells it', () => {
    expect(refusal('Tobias Fenn', 'Tobyas Fen')).toBe(
      '“Tobias Fenn” is a spelling the vault already knows, so it is not a mishearing.',
    );
    expect(refusal('larkspur payrol', 'Larkspur Payroller')).toMatch(/already knows/);
  });

  it('refuses words out of a name the vault has: Quill, while there is a Mara Quill', () => {
    expect(refusal('Quill', 'Quillon')).toBe('“Quill” is part of the name “Mara Quill”.');
  });

  it('refuses a spelling two notes disagree about', () => {
    const disputed = vocabulary({
      terms: [term('Larkspur', ['Lark Spur']), term('Larkspar', ['Lark Spur'])],
      people: [],
      companies: [],
    });
    expect(disputed.conflicts.map((conflict) => conflict.form)).toEqual(['Lark Spur']);
    expect(refusal('Lark Spur', 'Larkspurr', disputed)).toMatch(/already knows/);
  });
});
