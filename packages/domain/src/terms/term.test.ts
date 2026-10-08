import { describe, expect, it } from 'vitest';
import {
  newTermProperties,
  newTermRefusal,
  TERM_KINDS,
  termKindOf,
  variantsFromInput,
} from './term.ts';

describe('a term’s kind', () => {
  it('is one of product, person, company, acronym or other', () => {
    expect(TERM_KINDS).toEqual(['product', 'person', 'company', 'acronym', 'other']);
    for (const kind of TERM_KINDS) expect(termKindOf(kind)).toBe(kind);
  });

  it('is none when the note names one Atlas does not know, or nothing', () => {
    for (const value of ['Product', 'vendor', '', null, undefined, 3]) {
      expect(termKindOf(value)).toBeNull();
    }
  });
});

describe('variants typed into one box', () => {
  it('are split at commas, tidied, and blanks dropped', () => {
    expect(variantsFromInput(' lark spur ,Larks  Burr,, ,')).toEqual(['lark spur', 'Larks Burr']);
  });

  it('keep a repeat once, as first typed, whatever its case', () => {
    expect(variantsFromInput('Lark Spur, lark spur, LARK  SPUR, larks')).toEqual([
      'Lark Spur',
      'larks',
    ]);
  });

  it('are none when nothing was typed', () => {
    expect(variantsFromInput('')).toEqual([]);
  });
});

describe('a new term', () => {
  it('needs a right spelling', () => {
    expect(newTermRefusal('  ')).toBe('A term needs its right spelling.');
    expect(newTermRefusal('Larkspur')).toBeNull();
  });

  it('is a note of type term, with its kind and variants when given', () => {
    expect(
      newTermProperties({
        canonical: 'Larkspur',
        fileTitle: 'Larkspur',
        startsTitled: false,
        variants: ['lark spur'],
        kind: 'company',
      }),
    ).toEqual({ type: 'term', kind: 'company', variants: ['lark spur'] });
    expect(
      newTermProperties({
        canonical: 'Larkspur',
        fileTitle: 'Larkspur',
        startsTitled: false,
        variants: [],
        kind: null,
      }),
    ).toEqual({ type: 'term' });
  });

  it('keeps its spelling as its title when the file could not be named it', () => {
    expect(
      newTermProperties({
        canonical: ' S/4 Ledger ',
        fileTitle: 'S 4 Ledger',
        startsTitled: false,
        variants: [],
        kind: null,
      }),
    ).toEqual({ type: 'term', title: 'S/4 Ledger' });
    expect(
      newTermProperties({
        canonical: 'Larkspur',
        fileTitle: 'Larkspur 2',
        startsTitled: false,
        variants: [],
        kind: null,
      }),
    ).toEqual({ type: 'term', title: 'Larkspur' });
  });

  it('writes its spelling as its title over the title its template starts with', () => {
    expect(
      newTermProperties({
        canonical: 'Larkspur',
        fileTitle: 'Larkspur',
        startsTitled: true,
        variants: [],
        kind: null,
      }),
    ).toEqual({ type: 'term', title: 'Larkspur' });
  });

  it('is spelt without the zero-width characters pasted text carries', () => {
    expect(
      newTermProperties({
        canonical: 'Lark\u200Bspur\uFEFF',
        fileTitle: 'Larkspur',
        startsTitled: false,
        variants: [],
        kind: null,
      }),
    ).toEqual({ type: 'term' });
    expect(newTermRefusal('\u200C\u200D \u2060')).toBe('A term needs its right spelling.');
  });
});
