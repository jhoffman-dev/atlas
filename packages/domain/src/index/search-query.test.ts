import { describe, expect, it } from 'vitest';
import { toSearchQuery } from './search-query.ts';

describe('toSearchQuery', () => {
  it('matches the last word as a prefix, so results appear while typing', () => {
    expect(toSearchQuery('week')).toBe('"week"*');
  });

  it('requires every word, with only the last one a prefix', () => {
    expect(toSearchQuery('weekly rev')).toBe('"weekly" "rev"*');
  });

  it('collapses extra whitespace', () => {
    expect(toSearchQuery('  weekly   review  ')).toBe('"weekly" "review"*');
  });

  it.each([
    ['a quote', 'say "hello"', '"say" "hello"*'],
    ['a wildcard', 'wild*card', '"wild*card"*'],
    ['a boolean operator', 'a OR b', '"a" "OR" "b"*'],
    ['a parenthesis', 'note (draft)', '"note" "(draft)"*'],
  ])('treats %s as plain text', (_label, input, expected) => {
    expect(toSearchQuery(input)).toBe(expected);
  });

  it.each(['', '   ', '""'])('returns null for %j, which matches nothing', (input) => {
    expect(toSearchQuery(input)).toBeNull();
  });

  it('keeps unicode terms', () => {
    expect(toSearchQuery('año')).toBe('"año"*');
  });
});
