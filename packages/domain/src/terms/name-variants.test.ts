import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { isVocabularyNote, vocabularySourceOf, withVariantsAdded } from './name-variants.ts';

describe('the vocabulary’s reading of a note’s type (#400)', () => {
  it('is the first of term, person and company the type names, as the vocabulary reads it', () => {
    expect(vocabularySourceOf('company')).toBe('company');
    expect(vocabularySourceOf(['contact', 'person', 'company'])).toBe('person');
    expect(vocabularySourceOf(['company', 'person'])).toBe('company');
    expect(vocabularySourceOf(['project', 'term'])).toBe('term');
  });

  it('is nothing for any other type, or none', () => {
    expect(vocabularySourceOf('project')).toBeNull();
    expect(vocabularySourceOf(['project', 'contact'])).toBeNull();
    expect(vocabularySourceOf(undefined)).toBeNull();
    expect(vocabularySourceOf(7)).toBeNull();
  });
});

describe('misheard spellings added to a note’s variants (#400)', () => {
  it('keeps what the note lists as it is written, and adds the new ones after it', () => {
    expect(withVariantsAdded([' larkspar', 'Lark Spur'], ['Larks Burr'])).toEqual({
      variants: [' larkspar', 'Lark Spur', 'Larks Burr'],
      added: ['Larks Burr'],
    });
  });

  it('adds a spelling the note already lists once, however it is spaced, but a new capital is a new spelling', () => {
    expect(withVariantsAdded(['Lark  Spur'], ['Lark Spur', 'lark spur', 'lark spur'])).toEqual({
      variants: ['Lark  Spur', 'lark spur'],
      added: ['lark spur'],
    });
  });

  it('reads one variant written as a scalar, and none when the note has none', () => {
    expect(withVariantsAdded('larkspar', ['larkspar', 'Larks Burr'])).toEqual({
      variants: ['larkspar', 'Larks Burr'],
      added: ['Larks Burr'],
    });
    expect(withVariantsAdded(undefined, ['larkspar'])).toEqual({
      variants: ['larkspar'],
      added: ['larkspar'],
    });
    expect(withVariantsAdded(null, [])).toEqual({ variants: [], added: [] });
  });
});

describe('a variants list that cannot take another spelling (#404)', () => {
  it('is nothing for a mapping, a number or a yes/no, which an add would reshape', () => {
    expect(withVariantsAdded({ heard: 'Larkspar' }, ['Larks Burr'])).toBeNull();
    expect(withVariantsAdded(7, ['Larks Burr'])).toBeNull();
    expect(withVariantsAdded(true, ['Larks Burr'])).toBeNull();
  });

  it('drops an empty scalar rather than keep it as an empty spelling', () => {
    expect(withVariantsAdded('', ['Larks Burr'])).toEqual({
      variants: ['Larks Burr'],
      added: ['Larks Burr'],
    });
    expect(withVariantsAdded('  ', ['Larks Burr'])?.variants).toEqual(['Larks Burr']);
  });
});

describe('a note the vocabulary reads (#404)', () => {
  it('is one in the vault’s own space, outside the Archive', () => {
    expect(isVocabularyNote(createVaultPath('Areas/Vendors/Larkspur Payroll.md'))).toBe(true);
    expect(isVocabularyNote(createVaultPath('Archive/Areas/Larkspur Payroll.md'))).toBe(false);
    expect(isVocabularyNote(createVaultPath('.atlas/templates/Company.md'))).toBe(false);
  });
});
