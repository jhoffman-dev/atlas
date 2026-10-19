import { describe, expect, it } from 'vitest';
import type { PropertyDef, PropertyKind } from './index.ts';
import { isEmptyProperty, validatePropertyValue } from './property-value.ts';

const def = (kind: PropertyKind, required: boolean): PropertyDef => ({
  key: 'field',
  kind,
  label: 'Field',
  required,
  options: kind === 'select' || kind === 'multiSelect' ? ['Doing'] : [],
  target: null,
  many: false,
});

describe('isEmptyProperty (attack #353)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ["''", ''],
    ['spaces', '   '],
    ['tabs and newlines', '\t\n '],
    ['a no-break space', ' '],
    ['[]', []],
  ])('counts %s as empty', (_name, value) => {
    expect(isEmptyProperty(value)).toBe(true);
  });

  it.each([
    ['0', 0],
    ['-0', -0],
    ['false', false],
    ['a word', 'Doing'],
    ['a list with a word', ['bug']],
  ])('counts %s as a value', (_name, value) => {
    expect(isEmptyProperty(value)).toBe(false);
  });

  it('counts {} as empty: a mapping with no keys holds nothing', () => {
    expect(isEmptyProperty({})).toBe(true);
  });

  it('counts a list of blanks as empty: it shows as nothing', () => {
    expect(isEmptyProperty(['', '  '])).toBe(true);
  });
});

describe('validatePropertyValue after the rename (attack #353)', () => {
  it.each([null, undefined, '', '  ', []])('calls %j missing on a required text field', (value) => {
    expect(validatePropertyValue({ def: def('text', true), value })).toBe('Field is required');
  });

  it('takes 0 as a required number and false as a required checkbox', () => {
    expect(validatePropertyValue({ def: def('number', true), value: 0 })).toBeNull();
    expect(validatePropertyValue({ def: def('checkbox', true), value: false })).toBeNull();
  });

  it('still lets an empty required thumbnail mean auto', () => {
    expect(validatePropertyValue({ def: def('thumbnail', true), value: '' })).toBeNull();
  });

  it('passes an empty optional value of every kind', () => {
    const kinds: PropertyKind[] = [
      'text',
      'number',
      'date',
      'select',
      'multiSelect',
      'checkbox',
      'url',
    ];
    for (const kind of kinds) {
      expect(validatePropertyValue({ def: def(kind, false), value: null })).toBeNull();
    }
  });
});
