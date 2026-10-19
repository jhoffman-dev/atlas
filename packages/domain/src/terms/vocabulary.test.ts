import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import type { TermKind, TermNote } from './term.ts';
import { vocabulary, type NamedEntity } from './vocabulary.ts';
import { vocabularyKey } from './spelling.ts';

const term = (
  path: string,
  canonical: string,
  variants: readonly string[] = [],
  kind: TermKind | null = null,
): TermNote => ({ path: createVaultPath(path), canonical, variants, kind });

const named = (path: string, name: string, aliases: readonly string[] = []): NamedEntity => ({
  path: createVaultPath(path),
  name,
  aliases,
});

const NOBODY = { terms: [], people: [], companies: [] };

/** Each entry as `form → canonical`, in the order the vocabulary gives them. */
const corrections = (built: ReturnType<typeof vocabulary>) =>
  built.entries.map((entry) => `${entry.form} → ${entry.canonical}`);

describe('the vocabulary', () => {
  it('holds a term’s right spelling and each way it is misheard', () => {
    const built = vocabulary({
      ...NOBODY,
      terms: [term('Terms/Larkspur.md', 'Larkspur', ['lark spur', 'Larks Burr'], 'company')],
    });
    expect(corrections(built)).toEqual([
      'Larks Burr → Larkspur',
      'lark spur → Larkspur',
      'Larkspur → Larkspur',
    ]);
    expect(built.entries[0]?.claims).toEqual([
      {
        form: 'Larks Burr',
        canonical: 'Larkspur',
        path: 'Terms/Larkspur.md',
        source: 'term',
      },
    ]);
    expect(built.conflicts).toEqual([]);
  });

  it('holds a person’s name as its own right spelling, and never their aliases', () => {
    const built = vocabulary({
      ...NOBODY,
      people: [named('People/Mara Quill.md', 'Mara Quill', ['Mara Quil', 'Mara'])],
    });
    expect(corrections(built)).toEqual(['Mara Quill → Mara Quill']);
    expect(built.entries.every((entry) => entry.claims[0]?.source === 'person')).toBe(true);
  });

  it('holds a company’s name, said to come from the company, and never its aliases', () => {
    const built = vocabulary({
      ...NOBODY,
      companies: [named('Companies/Larkspur Payroll.md', 'Larkspur Payroll', ['LP'])],
    });
    expect(corrections(built)).toEqual(['Larkspur Payroll → Larkspur Payroll']);
    expect(built.entries.map((entry) => entry.claims[0]?.source)).toEqual(['company']);
  });

  it('corrects a company’s misheard spellings to its name, and still never its aliases (#400)', () => {
    const built = vocabulary({
      ...NOBODY,
      companies: [
        {
          ...named('Companies/Larkspur Payroll.md', 'Larkspur Payroll', ['LP']),
          variants: ['Larkspar Payroll'],
        },
      ],
    });
    expect(corrections(built)).toEqual([
      'Larkspar Payroll → Larkspur Payroll',
      'Larkspur Payroll → Larkspur Payroll',
    ]);
    expect(built.entries.map((entry) => entry.claims[0]?.source)).toEqual(['company', 'company']);
  });

  it('corrects a person’s misheard spellings to their name, their aliases left to linking (#400)', () => {
    const built = vocabulary({
      ...NOBODY,
      people: [
        { ...named('People/Tobias Fenn.md', 'Tobias Fenn', ['Toby']), variants: ['Tobias Fen'] },
      ],
    });
    expect(corrections(built)).toEqual(['Tobias Fenn → Tobias Fenn', 'Tobias Fen → Tobias Fenn']);
  });

  it('does not let a person’s alias clash with a term’s variant', () => {
    const built = vocabulary({
      terms: [term('Terms/Quill Desk.md', 'Quill Desk', ['Quill'])],
      people: [named('People/Mara Quill.md', 'Mara Quill', ['Quill'])],
      companies: [],
    });
    expect(built.conflicts).toEqual([]);
    expect(corrections(built)).toContain('Quill → Quill Desk');
  });

  it('puts terms and people together, longest spelling first so a longer name is matched first', () => {
    const built = vocabulary({
      terms: [term('Terms/Fenn Ledger.md', 'Fenn Ledger', ['fen ledger'])],
      people: [named('People/Tobias Fenn.md', 'Tobias Fenn', ['Toby'])],
      companies: [],
    });
    expect(built.entries.map((entry) => entry.form)).toEqual([
      'Fenn Ledger',
      'Tobias Fenn',
      'fen ledger',
    ]);
  });

  it('orders spellings of one length by their letters, whatever their case', () => {
    const built = vocabulary({
      ...NOBODY,
      terms: [term('b.md', 'beta', ['Aaaa']), term('a.md', 'Alfa')],
    });
    expect(built.entries.map((entry) => entry.form)).toEqual(['Aaaa', 'Alfa', 'beta']);
  });

  it('matches spellings as written, case included, composed and spaced alike', () => {
    expect(vocabularyKey('  Lark \t Spur ')).toBe('lark spur');
    expect(vocabularyKey('René')).toBe(vocabularyKey('René'));
    expect(vocabularyKey('Lark\u200Bspur\u2060')).toBe('larkspur');
    const built = vocabulary({
      ...NOBODY,
      terms: [term('Terms/Larkspur.md', 'Larkspur', ['Lark  Spur', 'lark spur', 'Lark Spur'])],
    });
    expect(corrections(built)).toEqual([
      'Lark Spur → Larkspur',
      'lark spur → Larkspur',
      'Larkspur → Larkspur',
    ]);
  });

  it('leaves out a misheard spelling with no letter or digit, which every timestamp would hold', () => {
    const built = vocabulary({
      ...NOBODY,
      terms: [term('Terms/Nolan.md', 'Nolan', ['~', '--', '[]', '~00', 'a\u0000b'])],
    });
    expect(corrections(built)).toEqual(['Nolan → Nolan', '~00 → Nolan']);
  });

  it('keeps a multi-word variant whole rather than as its words', () => {
    const built = vocabulary({
      ...NOBODY,
      terms: [term('Terms/Quill Desk.md', 'Quill Desk', ['quilled desk top'])],
    });
    expect(built.entries.map((entry) => entry.form)).toEqual(['quilled desk top', 'Quill Desk']);
  });

  it('leaves out a blank variant, and a note with no spelling at all', () => {
    const built = vocabulary({
      ...NOBODY,
      terms: [term('Terms/Larkspur.md', 'Larkspur', ['', '   ']), term('Terms/Blank.md', '  ')],
    });
    expect(corrections(built)).toEqual(['Larkspur → Larkspur']);
  });

  it('agrees with itself when two notes give one spelling the same right spelling', () => {
    const built = vocabulary({
      terms: [term('Terms/Mara Quill.md', 'Mara Quill', ['Mara Quil'], 'person')],
      people: [named('People/Mara Quill.md', 'Mara Quill')],
      companies: [],
    });
    expect(built.conflicts).toEqual([]);
    const right = built.entries.find((entry) => entry.form === 'Mara Quill');
    expect(right?.claims.map((claim) => [claim.source, claim.path])).toEqual([
      ['term', 'Terms/Mara Quill.md'],
      ['person', 'People/Mara Quill.md'],
    ]);
  });
});

describe('a spelling two notes disagree about', () => {
  const built = vocabulary({
    ...NOBODY,
    terms: [
      term('Terms/Larkspur.md', 'Larkspur', ['lark spur', 'larks']),
      term('Terms/Larkspur Payroll.md', 'Larkspur Payroll', ['lark spur']),
    ],
  });

  it('is a conflict, naming every note that claims it and what each says', () => {
    expect(built.conflicts).toEqual([
      {
        form: 'lark spur',
        claims: [
          { form: 'lark spur', canonical: 'Larkspur', path: 'Terms/Larkspur.md', source: 'term' },
          {
            form: 'lark spur',
            canonical: 'Larkspur Payroll',
            path: 'Terms/Larkspur Payroll.md',
            source: 'term',
          },
        ],
      },
    ]);
  });

  it('is not used until resolved, while each term’s other spellings still are', () => {
    expect(built.entries.map((entry) => entry.form)).not.toContain('lark spur');
    expect(corrections(built)).toEqual([
      'Larkspur Payroll → Larkspur Payroll',
      'Larkspur → Larkspur',
      'larks → Larkspur',
    ]);
  });

  it('is resolved once one of them lets it go', () => {
    const resolved = vocabulary({
      ...NOBODY,
      terms: [
        term('Terms/Larkspur.md', 'Larkspur', ['lark spur']),
        term('Terms/Larkspur Payroll.md', 'Larkspur Payroll'),
      ],
    });
    expect(resolved.conflicts).toEqual([]);
    expect(corrections(resolved)).toContain('lark spur → Larkspur');
  });

  it('includes a term’s right spelling another term uses as a variant, but not one spelt in another case', () => {
    const clash = vocabulary({
      terms: [
        term('Terms/Fenn.md', 'Fenn'),
        term('Terms/Fenn Ledger.md', 'Fenn Ledger', ['Fenn', 'fenn']),
        term('Terms/ACME.md', 'ACME'),
      ],
      people: [],
      companies: [named('Companies/Acme.md', 'Acme')],
    });
    expect(clash.conflicts.map((conflict) => conflict.form)).toEqual(['Fenn']);
    expect(clash.entries.map((entry) => entry.form)).toEqual([
      'Fenn Ledger',
      'ACME',
      'Acme',
      'fenn',
    ]);
  });

  it('lists conflicts in the order of their spellings', () => {
    const many = vocabulary({
      ...NOBODY,
      terms: [term('a.md', 'A', ['zed', 'Bee']), term('b.md', 'B', ['zed', 'Bee'])],
    });
    expect(many.conflicts.map((conflict) => conflict.form)).toEqual(['Bee', 'zed']);
  });
});
