import { describe, expect, it } from 'vitest';
import { hashOf, kindleHighlightKey, newKindleHighlights } from './kindle-highlight-key.ts';
import type { KindleHighlight } from './kindle-types.ts';

const base = { asin: 'B0EXAMPLE1', annotationId: null, location: 12, words: 'A passage' };

describe('kindleHighlightKey', () => {
  it('is Amazon’s annotation id when there is one, whatever the words or place', () => {
    const key = kindleHighlightKey({ ...base, annotationId: 'QTEXAMPLE' });
    expect(key).toBe('amazon:QTEXAMPLE');
    expect(
      kindleHighlightKey({ ...base, annotationId: 'QTEXAMPLE', words: 'other', location: 9 }),
    ).toBe(key);
  });

  it('is the book, the location and a hash of the words when there is no id', () => {
    expect(kindleHighlightKey(base)).toBe(`quote:B0EXAMPLE1:12:${hashOf('A passage')}`);
  });

  it('writes a missing location as -', () => {
    expect(kindleHighlightKey({ ...base, location: null })).toBe(
      `quote:B0EXAMPLE1:-:${hashOf('A passage')}`,
    );
  });

  it('is the same for the same words wrapped differently', () => {
    expect(kindleHighlightKey({ ...base, words: '  A\n passage ' })).toBe(kindleHighlightKey(base));
  });

  it('differs when the book, the location or the words differ', () => {
    const key = kindleHighlightKey(base);
    expect(kindleHighlightKey({ ...base, asin: 'B0EXAMPLE2' })).not.toBe(key);
    expect(kindleHighlightKey({ ...base, location: 13 })).not.toBe(key);
    expect(kindleHighlightKey({ ...base, words: 'A passage.' })).not.toBe(key);
  });
});

describe('hashOf', () => {
  it('is 14 hex digits, the same for the same text and different for different text', () => {
    expect(hashOf('abc')).toMatch(/^[0-9a-f]{14}$/);
    expect(hashOf('')).toMatch(/^[0-9a-f]{14}$/);
    expect(hashOf('abc')).toBe(hashOf('abc'));
    expect(new Set(['a', 'b', 'ab', 'ba', 'abc', ''].map(hashOf)).size).toBe(6);
  });
});

describe('newKindleHighlights', () => {
  const highlight = (key: string, quote = key): KindleHighlight => ({
    key: key as KindleHighlight['key'],
    asin: 'B0EXAMPLE1',
    annotationId: null,
    style: 'highlight',
    colour: null,
    quote,
    note: null,
    location: null,
    page: null,
  });

  it('keeps only the highlights not recorded, in the notebook’s order', () => {
    const fresh = newKindleHighlights(
      [highlight('a'), highlight('b'), highlight('c')],
      new Set(['b']),
    );
    expect(fresh.map((h) => h.key)).toEqual(['a', 'c']);
  });

  it('keeps one of a highlight the notebook gives twice: the first', () => {
    const fresh = newKindleHighlights(
      [highlight('a', 'first'), highlight('a', 'again')],
      new Set(),
    );
    expect(fresh.map((h) => h.quote)).toEqual(['first']);
  });

  it('leaves the recorded set it was given as it was', () => {
    const recorded = new Set(['x']);
    newKindleHighlights([highlight('a')], recorded);
    expect([...recorded]).toEqual(['x']);
  });
});
