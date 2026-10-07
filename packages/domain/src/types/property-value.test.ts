import { describe, expect, it } from 'vitest';
import { isWikiLink, relationTargets, validatePropertyValue } from './property-value.ts';
import type { PropertyDef, PropertyKind } from './property-def.ts';

const def = (kind: PropertyKind, extra: Partial<PropertyDef> = {}): PropertyDef => ({
  key: 'field',
  kind,
  label: 'Field',
  required: false,
  options: [],
  target: null,
  many: false,
  ...extra,
});

const check = (kind: PropertyKind, value: unknown, extra: Partial<PropertyDef> = {}) =>
  validatePropertyValue({ def: def(kind, extra), value });

describe('validatePropertyValue', () => {
  describe('empty values', () => {
    it.each([null, undefined, '', '   ', []])('accepts %j when not required', (value) => {
      expect(check('text', value)).toBeNull();
    });

    it('refuses an empty required value, naming the property', () => {
      expect(check('text', '', { required: true })).toBe('Field is required');
    });
  });

  describe('number', () => {
    it.each([42, '42', '-3.5'])('accepts %j', (value) => {
      expect(check('number', value)).toBeNull();
    });

    it('refuses text', () => {
      expect(check('number', 'many')).toBe('Field must be a number');
    });
  });

  describe('date', () => {
    it('accepts an ISO date', () => {
      expect(check('date', '2026-09-20')).toBeNull();
    });

    it.each(['yesterday', '20/09/2026', '2026-02-30'])('refuses %j', (value) => {
      expect(check('date', value)).toBe('Field must be a date like 2026-09-20');
    });
  });

  describe('checkbox', () => {
    it.each([true, false, 'true', 'false'])('accepts %j', (value) => {
      expect(check('checkbox', value)).toBeNull();
    });

    it('refuses anything else', () => {
      expect(check('checkbox', 'maybe')).toBe('Field must be true or false');
    });
  });

  describe('url', () => {
    it.each(['https://example.com', 'http://example.com/a?b=1'])('accepts %j', (value) => {
      expect(check('url', value)).toBeNull();
    });

    it.each(['example.com', 'ftp://example.com', 'not a url'])('refuses %j', (value) => {
      expect(check('url', value)).toBe('Field must be a link starting with http');
    });
  });

  describe('select', () => {
    const options = ['draft', 'done'];

    it('accepts an option', () => {
      expect(check('select', 'done', { options })).toBeNull();
    });

    it('refuses anything else and says what is allowed', () => {
      expect(check('select', 'other', { options })).toBe('Field must be one of draft, done');
    });

    it('accepts anything when no options are declared', () => {
      expect(check('select', 'whatever')).toBeNull();
    });
  });

  describe('multiSelect', () => {
    const options = ['a', 'b'];

    it('accepts a list of options', () => {
      expect(check('multiSelect', ['a', 'b'], { options })).toBeNull();
    });

    it('refuses a list containing something else', () => {
      expect(check('multiSelect', ['a', 'z'], { options })).toBe('Field must be one of a, b');
    });
  });

  describe('relation', () => {
    const relation = { target: 'person' };

    it('accepts a wiki link', () => {
      expect(check('relation', '[[Ada Lovelace]]', relation)).toBeNull();
    });

    it('refuses plain text, naming the type it wants', () => {
      expect(check('relation', 'Ada Lovelace', relation)).toBe('Field must be a link to a person');
    });

    it('refuses several notes when it holds one', () => {
      expect(check('relation', ['[[A]]', '[[B]]'], relation)).toBe('Field can only hold one note');
    });

    it('accepts several when it holds many', () => {
      expect(check('relation', ['[[A]]', '[[B]]'], { ...relation, many: true })).toBeNull();
    });
  });
});

describe('isWikiLink', () => {
  it.each(['[[Note]]', '[[Note|alias]]', '  [[Note]]  '])('accepts %j', (value) => {
    expect(isWikiLink(value)).toBe(true);
  });

  it.each(['Note', '[[A]] and [[B]]', '[[unclosed', ''])('rejects %j', (value) => {
    expect(isWikiLink(value)).toBe(false);
  });
});

describe('relationTargets', () => {
  it('reads the note a link points at', () => {
    expect(relationTargets('[[Ada Lovelace]]')).toEqual(['Ada Lovelace']);
  });

  it('reads several', () => {
    expect(relationTargets(['[[A]]', '[[B]]'])).toEqual(['A', 'B']);
  });

  it('uses the target rather than the alias', () => {
    expect(relationTargets('[[Ada Lovelace|Ada]]')).toEqual(['Ada Lovelace']);
  });

  it('ignores anything that is not a link', () => {
    expect(relationTargets(['plain text', '[[A]]'])).toEqual(['A']);
  });
});
