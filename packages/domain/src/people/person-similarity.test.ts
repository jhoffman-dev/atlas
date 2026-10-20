import { describe, expect, it } from 'vitest';
import {
  addressesMatch,
  addressParts,
  domainsNear,
  editDistanceWithin,
  localPartsMatch,
} from './person-similarity.ts';

describe('the edit distance between two spellings', () => {
  it('counts a letter added, dropped, changed or two neighbours swapped as one edit', () => {
    expect(editDistanceWithin('mara', 'mara', 2)).toBe(0);
    expect(editDistanceWithin('mara', 'marra', 2)).toBe(1);
    expect(editDistanceWithin('marra', 'mara', 2)).toBe(1);
    expect(editDistanceWithin('mara', 'mira', 2)).toBe(1);
    expect(editDistanceWithin('mara', 'amra', 2)).toBe(1);
    expect(editDistanceWithin('quill', 'qiull', 2)).toBe(1);
  });

  it('is null past the most allowed, however the strings differ', () => {
    expect(editDistanceWithin('mara', 'tobias', 2)).toBeNull();
    expect(editDistanceWithin('ab', 'abcde', 2)).toBeNull();
    expect(editDistanceWithin('abcd', 'dcba', 1)).toBeNull();
    expect(editDistanceWithin('', 'ab', 1)).toBeNull();
    expect(editDistanceWithin('', 'a', 1)).toBe(1);
  });

  it('counts an accented letter as one letter', () => {
    expect(editDistanceWithin('zoë', 'zoe', 1)).toBe(1);
    expect(editDistanceWithin('🙂a', '🙂b', 1)).toBe(1);
  });
});

describe('an address split for comparing', () => {
  it('folds case, drops a +tag and reads the part in angle brackets', () => {
    expect(addressParts('Mara Quill <Mara.Quill+payroll@Larkspur.Example.com>')).toEqual({
      local: 'mara.quill',
      domain: 'larkspur.example.com',
    });
  });

  it('is null for text that is not an address', () => {
    expect(addressParts('mara')).toBeNull();
    expect(addressParts('@larkspur.example.com')).toBeNull();
    expect(addressParts('mara@')).toBeNull();
    expect(addressParts('+tag@larkspur.example.com')).toBeNull();
  });
});

describe('two domains near each other', () => {
  it('holds a domain to itself and a short typo away, by length', () => {
    expect(domainsNear('larkspur.example.com', 'larkspur.example.com')).toBe(true);
    expect(domainsNear('larkspur.example.com', 'larkspor.example.com')).toBe(true);
    expect(domainsNear('larkspur.example.com', 'larkspr.example.co')).toBe(true);
    expect(domainsNear('fenn.example', 'fen.example')).toBe(true);
  });

  it('keeps short domains apart, where one letter is another company', () => {
    expect(domainsNear('aol.com', 'aon.com')).toBe(false);
    expect(domainsNear('fenn.example', 'fenn.example.org')).toBe(false);
    expect(domainsNear('a.example', 'b.example.com')).toBe(false);
  });
});

describe('two local parts naming one person', () => {
  const company = { publicMail: false };

  it('matches a name written with or without its separators', () => {
    expect(localPartsMatch('mara.quill', 'maraquill', company)).toBe('same');
    expect(localPartsMatch('mara_quill', 'mara-quill', company)).toBe('same');
  });

  it('matches a first name with a full one at a company, never at a public provider', () => {
    expect(localPartsMatch('mara', 'mara.quill', company)).toBe('first-name');
    expect(localPartsMatch('mara.quill', 'mara', company)).toBe('first-name');
    expect(localPartsMatch('mara', 'mara.quill', { publicMail: true })).toBeNull();
  });

  it('does not take a first name for a last one, or a word for two', () => {
    expect(localPartsMatch('quill', 'mara.quill', company)).toBeNull();
    expect(localPartsMatch('mara.q', 'mara.quill', company)).toBeNull();
  });

  it('matches a typo by length: one letter from five, two from ten', () => {
    expect(localPartsMatch('marra.quill', 'mara.quill', company)).toBe('typo');
    expect(localPartsMatch('tobias.feen', 'tobias.fenn', company)).toBe('typo');
    expect(localPartsMatch('tobais.feen', 'tobias.fenn', company)).toBe('typo');
    expect(localPartsMatch('tobias.fn', 'tobias.fenn', company)).toBeNull();
    expect(localPartsMatch('mara', 'mira', company)).toBeNull();
    expect(localPartsMatch('maraq', 'marqa', company)).toBe('typo');
    expect(localPartsMatch('marquil', 'maraquill', company)).toBeNull();
  });

  it('matches nothing to an address of separators alone', () => {
    expect(localPartsMatch('..', 'mara', company)).toBeNull();
  });
});

describe('two addresses of one person', () => {
  it('matches the issue’s three spellings of Mara pairwise along the chain', () => {
    const plain = 'mara@larkspur.example.com';
    const full = 'mara.quill@larkspur.example.com';
    const misspelt = 'marra.quill@larkspur.example.com';
    expect(addressesMatch(plain, full)).toEqual({ local: 'first-name', sameDomain: true });
    expect(addressesMatch(full, misspelt)).toEqual({ local: 'typo', sameDomain: true });
    expect(addressesMatch(plain, misspelt)).toBeNull();
  });

  it('matches across a domain typo, and says the domains differ', () => {
    expect(
      addressesMatch('mara.quill@larkspur.example.com', 'mara.quill@larkspor.example.com'),
    ).toEqual({ local: 'same', sameDomain: false });
  });

  it('never matches the same name at unrelated domains', () => {
    expect(addressesMatch('mara.quill@larkspur.example.com', 'mara.quill@fenn.example')).toBeNull();
  });

  it('is not a match for one address written twice, or for text that is not one', () => {
    expect(addressesMatch('Mara@larkspur.example.com', 'mara@larkspur.example.com')).toBeNull();
    expect(addressesMatch('mara', 'mara.quill@larkspur.example.com')).toBeNull();
  });

  it('reads a public provider by its label, so a first name alone is no one', () => {
    expect(addressesMatch('mara@gmail.com', 'mara.quill@gmail.com')).toBeNull();
    expect(addressesMatch('mara.quill@gmail.com', 'maraquill@gmail.com')).toEqual({
      local: 'same',
      sameDomain: true,
    });
  });
});
