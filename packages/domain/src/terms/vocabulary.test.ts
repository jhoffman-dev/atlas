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

  it('holds a person’s name as its own right spelling, and their aliases', () => {
    const built = vocabulary({
      ...NOBODY,
      people: [named('People/Mara Quill.md', 'Mara Quill', ['Mara Quil', 'Mara'])],
    });
    expect(corrections(built)).toEqual([
      'Mara Quill → Mara Quill',
      'Mara Quil → Mara Quill',
      'Mara → Mara Quill',
    ]);
    expect(built.entries.every((entry) => entry.claims[0]?.source === 'person')).toBe(true);
  });

  it('holds a company’s name and aliases, said to come from the company', () => {
    const built = vocabulary({
      ...NOBODY,
      companies: [named('Companies/Larkspur Payroll.md', 'Larkspur Payroll', ['LP'])],
    });
    expect(corrections(built)).toEqual([
      'Larkspur Payroll → Larkspur Payroll',
      'LP → Larkspur Payroll',
    ]);
    expect(built.entries.map((entry) => entry.claims[0]?.source)).toEqual(['company', 'company']);
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
      'Toby',
    ]);
  });

  it('orders spellings of one length by their letters, whatever their case', () => {
    const built = vocabulary({
      ...NOBODY,
      terms: [term('b.md', 'beta', ['Aaaa']), term('a.md', 'Alfa')],
    });
    expect(built.entries.map((entry) => entry.form)).toEqual(['Aaaa', 'Alfa', 'beta']);
  });

  it('matches spellings however they are cased, spaced or composed, keeping the first as written', () => {
    expect(vocabularyKey('  Lark \t Spur ')).toBe('lark spur');
    expect(vocabularyKey('René')).toBe(vocabularyKey('René'));
    expect(vocabularyKey('Lark\u200Bspur\u2060')).toBe('larkspur');
    const built = vocabulary({
      ...NOBODY,
      terms: [term('Terms/Larkspur.md', 'Larkspur', ['Lark  Spur', 'lark spur', 'LARKSPUR'])],
    });
    expect(corrections(built)).toEqual(['Lark Spur → Larkspur', 'Larkspur → Larkspur']);
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
      people: [named('People/Mara Quill.md', 'Mara Quill', ['mara quil'])],
      companies: [],
    });
    expect(built.conflicts).toEqual([]);
    const misheard = built.entries.find((entry) => entry.form === 'Mara Quil');
    expect(misheard?.canonical).toBe('Mara Quill');
    expect(misheard?.claims.map((claim) => [claim.source, claim.path])).toEqual([
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
      term('Terms/Larkspur Payroll.md', 'Larkspur Payroll', ['Lark Spur']),
    ],
  });

  it('is a conflict, naming every note that claims it and what each says', () => {
    expect(built.conflicts).toEqual([
      {
        form: 'lark spur',
        claims: [
          { form: 'lark spur', canonical: 'Larkspur', path: 'Terms/Larkspur.md', source: 'term' },
          {
            form: 'Lark Spur',
            canonical: 'Larkspur Payroll',
            path: 'Terms/Larkspur Payroll.md',
            source: 'term',
          },
        ],
      },
    ]);
  });

  it('is not used until resolved, while each term’s other spellings still are', () => {
    expect(built.entries.map((entry) => vocabularyKey(entry.form))).not.toContain('lark spur');
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

  it('includes a term’s spelling another note uses as a variant, and one spelt in another case', () => {
    const clash = vocabulary({
      terms: [term('Terms/ACME.md', 'ACME'), term('Terms/Fenn.md', 'Fenn')],
      people: [named('People/Tobias Fenn.md', 'Tobias Fenn', ['Fenn'])],
      companies: [named('Companies/Acme.md', 'Acme')],
    });
    expect(clash.conflicts.map((conflict) => conflict.form)).toEqual(['ACME', 'Fenn']);
    expect(clash.entries.map((entry) => entry.form)).toEqual(['Tobias Fenn']);
  });

  it('lists conflicts in the order of their spellings', () => {
    const many = vocabulary({
      ...NOBODY,
      terms: [term('a.md', 'A', ['zed', 'Bee']), term('b.md', 'B', ['Zed', 'bee'])],
    });
    expect(many.conflicts.map((conflict) => conflict.form)).toEqual(['Bee', 'zed']);
  });
});
