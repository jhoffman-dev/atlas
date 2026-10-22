import { describe, expect, it } from 'vitest';
import {
  findKindleKeyClash,
  hashOf,
  kindleHighlightKey,
  kindleNoteKey,
  newKindleHighlights,
} from './kindle-highlight-key.ts';
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

describe('kindleHighlightKey of words written two ways', () => {
  it('is the same whether an accent arrives composed or as a letter and a combining mark', () => {
    expect(kindleHighlightKey({ ...base, words: 'caf\u00e9' })).toBe(
      kindleHighlightKey({ ...base, words: 'cafe\u0301' }),
    );
  });

  it('is the same with zero-width characters and soft hyphens in the words or without', () => {
    const plain = kindleHighlightKey({ ...base, words: 'unbelievable' });
    for (const hidden of ['\u200b', '\u200c', '\u200d', '\u2060', '\ufeff', '\u00ad']) {
      expect(kindleHighlightKey({ ...base, words: `un${hidden}believable` })).toBe(plain);
    }
  });

  it('still tells different words apart', () => {
    expect(kindleHighlightKey({ ...base, words: 'caf\u00e9' })).not.toBe(
      kindleHighlightKey({ ...base, words: 'cafe' }),
    );
  });
});

describe('kindleNoteKey', () => {
  const passage = kindleHighlightKey({ ...base, annotationId: 'QTEXAMPLE' });

  it('is the passage’s key, then the note, hashed', () => {
    expect(kindleNoteKey(passage, 'A thought')).toBe(
      `amazon:QTEXAMPLE:note:${hashOf('A thought')}`,
    );
  });

  it('is the same for the same note wrapped differently, and differs for another note', () => {
    expect(kindleNoteKey(passage, ' A\n thought ')).toBe(kindleNoteKey(passage, 'A thought'));
    expect(kindleNoteKey(passage, 'Another')).not.toBe(kindleNoteKey(passage, 'A thought'));
  });

  it('differs between passages with the same note', () => {
    const other = kindleHighlightKey({ ...base, annotationId: 'QTOTHER00' });
    expect(kindleNoteKey(other, 'A thought')).not.toBe(kindleNoteKey(passage, 'A thought'));
  });
});

describe('findKindleKeyClash', () => {
  const entry = (key: string, quote: string, note: string | null = null): KindleHighlight => ({
    key: key as KindleHighlight['key'],
    asin: 'B0EXAMPLE1',
    annotationId: null,
    style: 'highlight',
    colour: null,
    quote,
    note,
    location: null,
    page: null,
    commentOn: null,
  });

  it('finds a key two different passages share', () => {
    expect(findKindleKeyClash([entry('a', 'one'), entry('b', 'two'), entry('a', 'three')])).toBe(
      'a',
    );
  });

  it('finds a key two different notes share', () => {
    expect(findKindleKeyClash([entry('a', '', 'one'), entry('a', '', 'two')])).toBe('a');
  });

  it('does not find the same passage given twice, even wrapped differently', () => {
    expect(findKindleKeyClash([entry('a', 'one two'), entry('a', ' one\ntwo ')])).toBeNull();
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
    commentOn: null,
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
