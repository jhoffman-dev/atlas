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

  it('leaves the value out where the operator ignores it', () => {
    expect(
      describeFilter({ filter: { key: 'due', operator: 'isEmpty', value: 'x' }, label: 'Due' }),
    ).toBe('Due is empty');
  });
});
