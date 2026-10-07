import { describe, expect, it } from 'vitest';
import { compareNames } from './name-order.ts';

describe('compareNames', () => {
  it('ignores case, the way Finder does', () => {
    expect(compareNames('apple.md', 'Banana.md')).toBeLessThan(0);
    expect(compareNames('Banana.md', 'apple.md')).toBeGreaterThan(0);
  });

  it('compares a run of digits as a number', () => {
    expect(compareNames('note9.md', 'note10.md')).toBeLessThan(0);
  });

  it('is total: names that collate the same still have an order', () => {
    // Anything that ties here is left in arrival order by a stable sort, and the
    // sidebar's sections arrive from a SQL result and a directory walk.
    const ties: readonly (readonly [string, string])[] = [
      ['Notes.md', 'notes.md'],
      ['Resume.md', 'Résumé.md'],
    ];

    for (const [left, right] of ties) {
      const forwards = compareNames(left, right);
      expect(forwards).not.toBe(0);
      expect(compareNames(right, left)).toBe(-forwards);
    }
  });

  it('is zero only for the same name', () => {
    expect(compareNames('today.md', 'today.md')).toBe(0);
  });
});
