import { describe, expect, it } from 'vitest';
import {
  NEW_BLOCK_ID_LENGTH,
  blockAnchorSuffix,
  blockIdAtEnd,
  mayHoldBlockIds,
  isBlockId,
  newBlockId,
  standaloneBlockAnchor,
  trailingBlockAnchor,
} from './block-anchor.ts';

/** A seeded source of numbers in [0, 1), so an id drawn from it is always the same. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('isBlockId', () => {
  it('takes letters, digits and dashes, as Obsidian does', () => {
    expect(isBlockId('abc123')).toBe(true);
    expect(isBlockId('Quote-Of-The-Day')).toBe(true);
  });

  it('refuses anything else, and nothing', () => {
    for (const text of ['', 'a b', 'a_b', 'é', 'a^b', 'a.b', 'a#b']) {
      expect(isBlockId(text), text).toBe(false);
    }
  });
});

describe('trailingBlockAnchor', () => {
  it('finds the id after a space at the end of the text, and where to cut it', () => {
    const source = 'The plan, roughly. ^f3k9x2';
    expect(trailingBlockAnchor(source)).toMatchObject({ id: 'f3k9x2', start: 18 });
    expect(source.slice(0, 18)).toBe('The plan, roughly.');
  });

  it('takes a run of spaces or tabs before it, and spaces after it', () => {
    expect(trailingBlockAnchor('Text \t ^a1  ')).toMatchObject({ id: 'a1', start: 4 });
  });

  it('takes an id on the last line of the text, after a line break', () => {
    expect(trailingBlockAnchor('First line\n^a1')).toMatchObject({ id: 'a1', start: 10 });
    expect(trailingBlockAnchor('First line  \r\n  ^a1')).toMatchObject({ id: 'a1', start: 10 });
  });

  it('is not an id when a caret is joined to the word before it', () => {
    expect(trailingBlockAnchor('x^2')).toBeNull();
    expect(trailingBlockAnchor('e = mc^2')).toBeNull();
  });

  it('is not an id when escaped, or when it is not the last thing', () => {
    expect(trailingBlockAnchor('Text \\^a1')).toBeNull();
    expect(trailingBlockAnchor('Text ^a1 and more')).toBeNull();
    expect(trailingBlockAnchor('Text ^a1.')).toBeNull();
    expect(trailingBlockAnchor('Text ^a_1')).toBeNull();
    expect(trailingBlockAnchor('Text ^')).toBeNull();
  });

  it('is not an id when nothing comes before it: that is a block of its own', () => {
    expect(trailingBlockAnchor('^a1')).toBeNull();
    expect(trailingBlockAnchor('   ^a1')).toBeNull();
    expect(trailingBlockAnchor('\n^a1')).toBeNull();
  });

  it('reads only the last of two ids', () => {
    expect(trailingBlockAnchor('Text ^a1 ^b2')).toMatchObject({ id: 'b2', start: 8 });
  });

  it('reads the last line only: a caret two lines up is text', () => {
    expect(trailingBlockAnchor('Text ^a1\n\nMore')).toBeNull();
  });
});

describe('blockIdAtEnd', () => {
  it('reads an id that ends a piece of text, words before it or not', () => {
    expect(blockIdAtEnd(' ^a1')).toEqual({ id: 'a1', start: 0, separator: 0 });
    expect(blockIdAtEnd('\n^a1')).toEqual({ id: 'a1', start: 0, separator: 0 });
    expect(blockIdAtEnd('^a1')).toBeNull();
    expect(blockIdAtEnd('x^a1')).toBeNull();
  });

  it('marks the one separator the writer puts before an id, apart from the text’s own spaces', () => {
    expect(blockIdAtEnd('Words   ^a1')).toEqual({ id: 'a1', start: 5, separator: 7 });
    expect(blockIdAtEnd('Words\r\n^a1')).toEqual({ id: 'a1', start: 5, separator: 5 });
    expect(blockIdAtEnd('Words  \r\n  ^a1')).toEqual({ id: 'a1', start: 5, separator: 10 });
  });
});

describe('mayHoldBlockIds', () => {
  it('is true for a note with a line that ends as an id would', () => {
    expect(mayHoldBlockIds('# T\n\nWords ^a1\n')).toBe(true);
    expect(mayHoldBlockIds('| a |\n\n^t1\r\n')).toBe(true);
  });

  it('is false for carets that are not ids: footnotes, powers, none', () => {
    expect(mayHoldBlockIds('x^2 and a note[^1]\n\n[^1]: here\n')).toBe(false);
    expect(mayHoldBlockIds('No carets at all.\n')).toBe(false);
  });
});

describe('standaloneBlockAnchor', () => {
  it('reads a paragraph that is only an id', () => {
    expect(standaloneBlockAnchor('^q7w2e4')).toBe('q7w2e4');
    expect(standaloneBlockAnchor('^q7w2e4  ')).toBe('q7w2e4');
  });

  it('is null for anything else', () => {
    for (const text of ['', '^', 'x ^a', ' ^a', '^a b', '\\^a', '^a\n^b']) {
      expect(standaloneBlockAnchor(text), text).toBeNull();
    }
  });
});

describe('blockAnchorSuffix', () => {
  it('writes an id after the text, or on a line of its own after a blank one', () => {
    expect(blockAnchorSuffix('a1', 'inline')).toBe(' ^a1');
    expect(blockAnchorSuffix('a1', 'line')).toBe('\n\n^a1');
    expect(blockAnchorSuffix('a1', 'line', '\r\n')).toBe('\r\n\r\n^a1');
  });

  it('reads back as the id it wrote', () => {
    expect(trailingBlockAnchor(`Text${blockAnchorSuffix('a1', 'inline')}`)?.id).toBe('a1');
    expect(standaloneBlockAnchor(blockAnchorSuffix('a1', 'line').trim())).toBe('a1');
  });
});

describe('newBlockId', () => {
  it('draws six lower-case letters and digits from the random source', () => {
    const id = newBlockId(seeded(7), new Set());
    expect(id).toMatch(/^[a-z0-9]{6}$/);
    expect(id).toHaveLength(NEW_BLOCK_ID_LENGTH);
    expect(isBlockId(id)).toBe(true);
  });

  it('is the same id for the same seed, and a different one for another', () => {
    expect(newBlockId(seeded(7), new Set())).toBe(newBlockId(seeded(7), new Set()));
    expect(newBlockId(seeded(7), new Set())).not.toBe(newBlockId(seeded(8), new Set()));
  });

  it('never gives an id the note already has', () => {
    const first = newBlockId(seeded(7), new Set());
    const second = newBlockId(seeded(7), new Set([first]));
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[a-z0-9]{6}$/);
  });

  it('uses the whole alphabet: the ends of [0, 1) give "a" and "9"', () => {
    expect(newBlockId(() => 0, new Set())).toBe('aaaaaa');
    expect(newBlockId(() => 0.999_999, new Set())).toBe('999999');
  });

  it('gives up, rather than hanging, on a source that only repeats a taken id', () => {
    expect(() => newBlockId(() => 0, new Set(['aaaaaa']))).toThrow(/No new block id/);
  });
});
