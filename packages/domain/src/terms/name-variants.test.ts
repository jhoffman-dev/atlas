import { describe, expect, it } from 'vitest';
import { vocabularySourceOf, withVariantsAdded } from './name-variants.ts';

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
