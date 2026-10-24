import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { isCommonWord } from './common-words.ts';
import {
  acceptedTermRefusal,
  glossaryKey,
  knownSpellingOf,
  MAX_HEARD_WORDS,
  MIN_HEARD_LETTERS,
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

  it.each(['UPS', 'DOS', 'Wes', 'ins'])(
    'does not take “%s” for a plural: what is left would be under three letters',
    (word) => {
      expect(isCommonWord(word)).toBe(false);
    },
  );
});

describe('the key the glossary compares spellings by', () => {
  it('is the same in any case, spacing and Latin accent', () => {
    expect(glossaryKey('  Lark   Spur ')).toBe('lark spur');
    expect(glossaryKey('LARKSPUR')).toBe(glossaryKey('larkspur'));
    expect(glossaryKey('Quillé')).toBe(glossaryKey('Quille'));
    // Composed and decomposed é are one letter.
    expect(glossaryKey('Quillé')).toBe(glossaryKey('Quillé'));
  });

  it('drops a possessive at the end, of a name ending in s too, and never a plural', () => {
    expect(glossaryKey('Larkspur’s')).toBe('larkspur');
    expect(glossaryKey("Larkspur's")).toBe('larkspur');
    expect(glossaryKey("Atlas's")).toBe(glossaryKey('Atlas'));
    expect(glossaryKey('Atlas')).toBe('atlas');
    expect(glossaryKey('Larkspurs')).toBe('larkspurs');
    expect(glossaryKey('Bross')).toBe('bross');
  });

  it('keys to itself where dropping a possessive leaves another behind it', () => {
    expect(glossaryKey("Atlas's 's")).toBe('atlas');
    expect(glossaryKey(glossaryKey("Atlas's 's"))).toBe('atlas');
  });

  it('keeps names a plural would fold together apart: Luca and Lucas, Carlo and Carlos, Jen and Jens', () => {
    expect(glossaryKey('Lucas')).not.toBe(glossaryKey('Luca'));
    expect(glossaryKey('Carlos')).not.toBe(glossaryKey('Carlo'));
    expect(glossaryKey('Jens')).not.toBe(glossaryKey('Jen'));
  });

  it('drops accents on Latin letters only: Cyrillic й is not и, and Greek keeps its tonos', () => {
    expect(glossaryKey('José')).toBe('jose');
    expect(glossaryKey('Майя')).not.toBe(glossaryKey('Маия'));
    expect(glossaryKey('Σοφία')).not.toBe(glossaryKey('Σοφια'));
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

  it('refuses what was heard when it is the right spelling in other capitals, as a plural or a possessive', () => {
    expect(refusal('larkspur', 'Larkspur', EMPTY)).toBe(
      '“larkspur” is “Larkspur” in other capitals or as a plural, not a mishearing of it.',
    );
    expect(refusal('Larkspurs', 'Larkspur', EMPTY)).toMatch(/in other capitals or as a plural/);
    expect(refusal('Larkspur’s', 'Larkspur', EMPTY)).toMatch(/in other capitals or as a plural/);
  });

  it.each([
    ['Jose', 'José'],
    ['Bjorn', 'Bjørn'],
    ['Lukasz', 'Łukasz'],
    ['Σοφια', 'Σοφία'],
    ['Ida Brenwíck', 'Ida Brenwick'],
  ])(
    'refuses an accent or a stroke alone: “%s” for “%s” is a name of its own',
    (heard, canonical) => {
      expect(refusal(heard, canonical, EMPTY)).toBe(
        `“${heard}” is “${canonical}” but for its accents, and a name of its own: as a misheard spelling it would rewrite every “${heard}” in later meetings.`,
      );
    },
  );

  it('refuses an accent put right when the vault has the right spelling already, too', () => {
    const known = vocabulary({ terms: [term('José')], people: [], companies: [] });
    expect(refusal('Jose', 'José', known)).not.toBeNull();
  });

  it('keeps Cyrillic й a letter of its own: Майя for Маия is a mishearing', () => {
    expect(refusal('Маия', 'Майя', EMPTY)).toBeNull();
  });

  it.each([
    ['राम', 'रम्या'],
    ['민수', '민서'],
  ])(
    'counts “%s” long enough: a vowel sign, or a Hangul syllable, is a letter',
    (heard, canonical) => {
      expect(refusal(heard, canonical, EMPTY)).toBeNull();
    },
  );

  it.each(['東京', 'とうきょう', 'กรุงเทพ'])(
    'refuses “%s”, written without spaces, for the reason it is refused',
    (heard) => {
      expect(refusal(heard, 'Kewbrick', EMPTY)).toBe(
        `“${heard}” is written without spaces between words, and DFAI can’t correct names inside unspaced text yet.`,
      );
    },
  );

  it('refuses one Hangul syllable', () => {
    expect(refusal('민', '민서', EMPTY)).toMatch(/at least 2 letters/);
  });

  it.each(['Q', 'PR', 'Q3', 'A.I.'])(
    'refuses “%s”: fewer than three letters is too short to tell from everyday text',
    (heard) => {
      expect(refusal(heard, 'Kewbrick', EMPTY)).toBe(
        `“${heard}” is too short to tell from everyday text: a misheard spelling has at least ${MIN_HEARD_LETTERS} letters.`,
      );
    },
  );

  it('allows a heard spelling of three letters', () => {
    expect(refusal('Ida', 'Eida', EMPTY)).toBeNull();
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

  it('allows a right spelling of everyday words: only what was heard is rewritten', () => {
    expect(refusal('Teem Sink', 'Team Sync', EMPTY)).toBeNull();
    expect(refusal('Mondai', 'Monday', EMPTY)).toBeNull();
  });

  it.each([
    ['follow-up', 'Folloup'],
    ['step 2', 'Steptoo'],
    ['mark,', 'Marq'],
    ["the team's", 'Theteam'],
  ])('refuses everyday words whatever joins them: “%s”', (heard, canonical) => {
    expect(refusal(heard, canonical, EMPTY)).toBe(
      `“${heard}” is everyday words, and would be rewritten wherever anyone says it.`,
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

  it('takes a plural of a term’s right spelling for a name of its own, and its possessive for the term', () => {
    expect(refusal('Larks Purr Payrolls', 'Larkspur Payrolls')).toBeNull();
    expect(refusal('Larks Purr Payroll’s', 'Larkspur Payroll’s')).toMatch(
      /already in the glossary/,
    );
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

  it('refuses words out of a spelling notes disagree about, or out of what someone goes by', () => {
    const disputed = vocabulary({
      terms: [term('Larkspur', ['Lark Spur Pay']), term('Larkspar', ['Lark Spur Pay'])],
      people: [named('People', 'Ida Brenwick', ['Dee Brenwick'])],
      companies: [],
    });
    expect(refusal('Spur Pay', 'Spurpay', disputed)).toBe(
      '“Spur Pay” is part of the name “Lark Spur Pay”.',
    );
    expect(refusal('Dee', 'Deebrick', disputed)).toBe('“Dee” is part of the name “dee brenwick”.');
  });

  it('never folds a plural: with Luca known, Lucas is a name of its own, and so the other way', () => {
    const lucas = vocabulary({ terms: [term('Lucas')], people: [], companies: [] });
    const luca = vocabulary({ terms: [term('Luca')], people: [], companies: [] });
    expect(knownSpellingOf('Lucas', lucas)).toBe('Lucas');
    expect(knownSpellingOf('Lucas', luca)).toBeNull();
    expect(refusal('Lookas', 'Lucas', luca)).toBeNull();
    expect(knownSpellingOf('Luca', lucas)).toBeNull();
    expect(refusal('Lukah', 'Luca', lucas)).toBeNull();
    // A possessive is still the name itself.
    expect(knownSpellingOf('Luca’s', luca)).toBe('Luca');
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

describe('a term proposal at Accept, once the vault has moved on', () => {
  const accepted = (canonical: string, variants: string[]) =>
    acceptedTermRefusal({ canonical, variants }, VOCABULARY);

  it('is accepted while nothing it holds is claimed', () => {
    expect(accepted('Brenwick', ['Bren Wick'])).toBeNull();
  });

  it('is refused when its spelling is in the glossary now, in any case or accent', () => {
    expect(accepted('quille', ['Kwee'])).toBe('“quille” is already in the glossary, as “Quillé”.');
  });

  it('is refused when what it was heard as is another note’s misheard spelling now', () => {
    expect(accepted('Larkspur Pay', ['Larkspur Payrol'])).toBe(
      '“Larkspur Payrol” is now a misheard spelling of “Larkspur Payroll”; accepted, neither would be put right.',
    );
  });

  it('is refused when what it was heard as is disputed by two notes', () => {
    const disputed = vocabulary({
      terms: [term('Larkspur', ['Lark Spur']), term('Larkspar', ['Lark Spur'])],
      people: [],
      companies: [],
    });
    expect(acceptedTermRefusal({ canonical: 'Larkspir', variants: ['Lark Spur'] }, disputed)).toBe(
      '“Lark Spur” is already claimed by more than one note.',
    );
  });
});

/** Verification of PR #553 (#19): what the fix round's rules still let through. */
describe('verify #553: Accept holds a term to what proposing it was held to', () => {
  const brenda = vocabulary({
    terms: [],
    people: [named('People', 'Brenda Wick', ['Bren Wick'])],
    companies: [],
  });
  const brenWickJones = vocabulary({
    terms: [],
    people: [named('People', 'Bren Wick Jones')],
    companies: [],
  });
  const lowerCased = vocabulary({
    terms: [term('Brenwick Labs', ['bren wick'])],
    people: [],
    companies: [],
  });
  const heardAsBrenWick = { canonical: 'Brenwick', variants: ['Bren Wick'] };

  it('refuses at Accept a heard spelling that is now what a person goes by', () => {
    expect(
      suggestedTermRefusal({ heard: 'Bren Wick', canonical: 'Brenwick' }, brenda),
    ).not.toBeNull();
    expect(acceptedTermRefusal(heardAsBrenWick, brenda)).not.toBeNull();
  });

  it('refuses at Accept a heard spelling that is now words of a known name', () => {
    expect(
      suggestedTermRefusal({ heard: 'Bren Wick', canonical: 'Brenwick' }, brenWickJones),
    ).not.toBeNull();
    expect(acceptedTermRefusal(heardAsBrenWick, brenWickJones)).not.toBeNull();
  });

  it('refuses at Accept a heard spelling another note now has in other capitals', () => {
    expect(
      suggestedTermRefusal({ heard: 'Bren Wick', canonical: 'Brenwick' }, lowerCased),
    ).not.toBeNull();
    expect(acceptedTermRefusal(heardAsBrenWick, lowerCased)).not.toBeNull();
  });
});

describe('verify #553: glossaryKey is idempotent', () => {
  /** A small seeded generator (LCG): the same seed makes the same strings. */
  function seeded(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      return state / 2 ** 32;
    };
  }
  // Letters, apostrophes, an s, and accents: what a possessive and accent folding interact on.
  const PIECES = ['a', 'S', 's', "'", '’', 'é', 'ś', '́', ' ', 'й', 'ά', 'Ł'];

  it('keys a key to itself when an accented s follows an apostrophe', () => {
    const key = glossaryKey('Atlas’ś');
    expect(glossaryKey(key)).toBe(key);
  });

  it('keys every key to itself, over seeded strings', () => {
    const next = seeded(553);
    for (let run = 0; run < 2_000; run += 1) {
      const length = 1 + Math.floor(next() * 8);
      const spelling = Array.from(
        { length },
        () => PIECES[Math.floor(next() * PIECES.length)],
      ).join('');
      const key = glossaryKey(spelling);
      expect(glossaryKey(key), JSON.stringify(spelling)).toBe(key);
    }
  });
});

describe('verify #553: the shortest heard spelling counts letters in any script', () => {
  it('counts a Devanagari vowel sign as part of the name: राम is three letters as read', () => {
    // राम is र + the vowel sign ा + म: the sign is a mark, not \p{L}, so it is counted as two.
    const refusal = suggestedTermRefusal({ heard: 'राम', canonical: 'रम्या' }, EMPTY);
    expect(refusal ?? '').not.toContain('too short');
  });
});
