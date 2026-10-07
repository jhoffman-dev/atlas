import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_KINDS,
  aggregateFunction,
  formatAggregate,
  type AggregateKind,
} from './aggregate.ts';
import { InvalidQueryError } from './invalid-query-error.ts';

describe('aggregateFunction', () => {
  it('maps every kind to a SQL function', () => {
    for (const kind of AGGREGATE_KINDS) {
      expect(aggregateFunction(kind)).toMatch(/^[A-Z]+$/);
    }
  });

  it('refuses a kind it does not know rather than naming no function', () => {
    // A saved view is a file someone can type into, so `median` can arrive here.
    expect(() => aggregateFunction('median' as AggregateKind)).toThrow(InvalidQueryError);
  });

  it('refuses a name it merely inherited', () => {
    expect(() => aggregateFunction('constructor' as AggregateKind)).toThrow(InvalidQueryError);
  });
});

describe('formatAggregate', () => {
  it('shows a dash when there is nothing to show', () => {
    expect(formatAggregate('sum', null)).toBe('—');
    expect(formatAggregate('sum', undefined)).toBe('—');
    expect(formatAggregate('latest', '')).toBe('—');
  });

  it('rounds a count, which is always whole', () => {
    expect(formatAggregate('count', 12)).toBe('12');
    expect(formatAggregate('count', 12.0)).toBe('12');
  });

  it('keeps a whole average whole', () => {
    expect(formatAggregate('average', 4)).toBe('4');
  });

  it('shows at most two decimals', () => {
    expect(formatAggregate('average', 3.14159)).toBe('3.14');
  });

  it('drops trailing zeros from a decimal', () => {
    expect(formatAggregate('average', 2.5)).toBe('2.5');
    expect(formatAggregate('average', 2.1)).toBe('2.1');
  });

  it('passes a date through untouched', () => {
    expect(formatAggregate('earliest', '2026-09-20')).toBe('2026-09-20');
  });

  it('passes a value that is not a number through as text', () => {
    expect(formatAggregate('sum', 'later')).toBe('later');
  });
});
