import { describe, expect, it } from 'vitest';
import { readAnswers } from './read-moment.ts';

/** #260: when a read of the index can stand for a page's own write. */
describe('readAnswers', () => {
  const landed = { at: 3, indexKey: 'ready:7' };

  it('waits while the write has not landed', () => {
    expect(readAnswers(null, { at: 9, indexKey: 'ready:9' })).toBe(false);
  });

  it('waits for a read begun before the write landed, whatever its index', () => {
    expect(readAnswers(landed, { at: 3, indexKey: 'ready:8' })).toBe(false);
    expect(readAnswers(landed, { at: 2, indexKey: 'ready:8' })).toBe(false);
  });

  it('waits for a read begun since, of an index that has not moved since the write (#239)', () => {
    expect(readAnswers(landed, { at: 4, indexKey: 'ready:7' })).toBe(false);
  });

  it('is answered by a read begun since, of an index that has moved', () => {
    expect(readAnswers(landed, { at: 4, indexKey: 'ready:8' })).toBe(true);
  });
});
