import { describe, expect, it } from 'vitest';
import {
  describeFilter,
  FILTER_OPERATORS,
  filterOperatorWords,
  filterValueFrom,
  operatorTakesValue,
} from './index.ts';

describe('filterValueFrom', () => {
  it('stores a number as a number on a number property, so it matches a number column', () => {
    expect(filterValueFrom('14', 'number')).toBe(14);
    expect(filterValueFrom(' -2.5 ', 'number')).toBe(-2.5);
    expect(filterValueFrom('14h', 'number')).toBe('14h');
  });

  it('keeps digits as the text typed on any property that is not a number', () => {
    expect(filterValueFrom('007', 'text')).toBe('007');
    expect(filterValueFrom('1.10', 'select')).toBe('1.10');
    expect(filterValueFrom('14')).toBe('14');
  });

  it('keeps anything else as the text typed, and blank as no value', () => {
    expect(filterValueFrom('done')).toBe('done');
    expect(filterValueFrom('2026-09-22')).toBe('2026-09-22');
    expect(filterValueFrom('@tomorrow')).toBe('@tomorrow');
    expect(filterValueFrom('14h')).toBe('14h');
    expect(filterValueFrom('  ')).toBeNull();
  });
});

describe('filterValueFrom with the property’s choices (#212)', () => {
  const statuses = [
    { value: 'next-action', label: 'Next Action' },
    { value: 'archive', label: 'Archive' },
  ];

  it('stores the option a label names, so it matches what the file holds', () => {
    expect(filterValueFrom('Next Action', 'select', statuses)).toBe('next-action');
    expect(filterValueFrom(' next action ', 'select', statuses)).toBe('next-action');
    expect(filterValueFrom('ARCHIVE', 'select', statuses)).toBe('archive');
  });

  it('keeps text that names no choice as typed, where any text is a value', () => {
    expect(filterValueFrom('Someday', 'select', statuses)).toBe('Someday');
    expect(filterValueFrom('@weekAgo', 'date', [])).toBe('@weekAgo');
  });

  it('takes only true or false for a checkbox', () => {
    const states = [
      { value: 'true', label: 'true' },
      { value: 'false', label: 'false' },
    ];
    expect(filterValueFrom('True', 'checkbox', states)).toBe('true');
    expect(filterValueFrom('maybe', 'checkbox', states)).toBeNull();
  });
});

describe('filterOperatorWords', () => {
  it('has words for every operator a view can store', () => {
    for (const operator of FILTER_OPERATORS) {
      expect(filterOperatorWords(operator)).toMatch(/^[a-z ]+$/);
    }
    expect(filterOperatorWords('isNot')).toBe('is not');
    expect(filterOperatorWords('startsWith')).toBe('starts with');
  });
});

describe('operatorTakesValue', () => {
  it('is false only for the emptiness checks', () => {
    expect(FILTER_OPERATORS.filter((operator) => !operatorTakesValue(operator))).toEqual([
      'isEmpty',
      'isNotEmpty',
    ]);
  });
});

describe('describeFilter', () => {
  it('reads a filter as a sentence', () => {
    expect(
      describeFilter({
        filter: { key: 'status', operator: 'isNot', value: 'done' },
        label: 'Status',
      }),
    ).toBe('Status is not done');
    expect(
      describeFilter({
        filter: { key: 'phase', operator: 'greaterThan', value: 14 },
        label: 'Phase',
      }),
    ).toBe('Phase is more than 14');
  });

  it('reads a stored value as the choice it is, and anything else as written', () => {
    const choices = [{ value: 'next-action', label: 'Next Action' }];
    expect(
      describeFilter({
        filter: { key: 'status', operator: 'isNot', value: 'next-action' },
        label: 'Status',
        choices,
      }),
    ).toBe('Status is not Next Action');
    expect(
      describeFilter({
        filter: { key: 'status', operator: 'is', value: 'someday' },
        label: 'Status',
        choices,
      }),
    ).toBe('Status is someday');
  });

  it('leaves the value out where the operator ignores it', () => {
    expect(
      describeFilter({ filter: { key: 'due', operator: 'isEmpty', value: 'x' }, label: 'Due' }),
    ).toBe('Due is empty');
  });
});
