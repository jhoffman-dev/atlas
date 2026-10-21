/**
 * PR #454 review: where a block value's text ends, as the writer cuts it,
 * and the read-back check every write passes (ADR-0003). Each case asserts
 * the exact bytes and what they read back as.
 */
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import { FrontmatterRefusedError } from '@dfai/application';
import { checkedBody, updateFrontmatter, type Edit } from './frontmatter-write.ts';
import { parseFrontmatterProperties } from './frontmatter.ts';

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;

/** The block `original` with `changes`, checked to be `expected` and to read back as `values`. */
function writes(
  original: string,
  changes: Record<string, unknown>,
  expected: string,
  values: Record<string, unknown>,
) {
  const written = updateFrontmatter(original, changes);
  expect(written).toBe(expected);
  expect(parseFrontmatterProperties(written)).toEqual(values);
}

describe('a keep (|+) scalar ending the block', () => {
  it('untouched, another key changed: its bytes and value stay', () => {
    writes(block('a: 1', 'k: |+', '  x', ''), { a: 2 }, block('a: 2', 'k: |+', '  x', ''), {
      a: 2,
      k: 'x\n',
    });
  });

  it('changed: the blank line ending the block stays the block’s', () => {
    writes(block('a: 1', 'k: |+', '  x', ''), { k: 'y\n' }, block('a: 1', 'k: |', '  y', ''), {
      a: 1,
      k: 'y\n',
    });
  });

  it('a key added after it: the value does not take the blank line (regression)', () => {
    writes(block('k: |+', '  x', ''), { z: 1 }, block('k: |+', '  x', 'z: 1', ''), {
      k: 'x\n',
      z: 1,
    });
  });
});

describe('a keep (|+) scalar a removal leaves at the end of the block', () => {
  it('keeps its blank line: the block gains the one the reader drops', () => {
    writes(
      '---\n  k0: |+\n    v0 one\n\n# about k1\n  k1: |-\n    v1 one\n---\n',
      { k1: undefined },
      '---\n  k0: |+\n    v0 one\n\n\n---\n',
      { k0: 'v0 one\n\n' },
    );
  });
});

describe('an empty value given two lines', () => {
  it('is written plain, as the library writes the empty value it was, the comment kept', () => {
    writes(
      block('k:', '    # c', 'b: 2'),
      { k: 'one\ntwo' },
      block('k: one', '', '  two', '    # c', 'b: 2'),
      { k: 'one\ntwo', b: 2 },
    );
  });
});

describe('a shallower comment under a changed block scalar stays', () => {
  it('under a folded (>) scalar', () => {
    writes(
      block('k: >', '  folded', '  text', ' # c', 'b: 2'),
      { k: 'new' },
      block('k: >-', '  new', ' # c', 'b: 2'),
      { k: 'new', b: 2 },
    );
  });

  it('under a literal with a header comment', () => {
    writes(
      block('k: | # hdr', '  x', ' # c', 'b: 2'),
      { k: 'y\n' },
      block('k: | # hdr', '  y', ' # c', 'b: 2'),
      { k: 'y\n', b: 2 },
    );
  });

  it('under a folded keep (>+) scalar changed to a list', () => {
    writes(
      block('k: >+', '  x', '', ' # c', 'b: 2'),
      { k: ['p', 'q'] },
      block('k:', '  - p', '  - q', ' # c', 'b: 2'),
      { k: ['p', 'q'], b: 2 },
    );
  });

  it('an explicit indent (|2) is left on the library’s path: the value is right, other keys kept', () => {
    writes(block('k: |2', '    x', ' # c', 'b: 2'), { k: 'y\n' }, block('k: |', '  y', 'b: 2'), {
      k: 'y\n',
      b: 2,
    });
  });
});

describe('a comment below other value forms stays', () => {
  it('an alias', () => {
    writes(
      block('a: &n 5', 'k: *n', '  # c', 'b: 2'),
      { k: 7 },
      block('a: &n 5', 'k: 7', '  # c', 'b: 2'),
      { a: 5, k: 7, b: 2 },
    );
  });

  it('a tagged value', () => {
    writes(
      block('k: !!str 5', '  # c', 'b: 2'),
      { k: '6' },
      block('k: !!str "6"', '  # c', 'b: 2'),
      { k: '6', b: 2 },
    );
  });

  it('an empty last item', () => {
    writes(
      block('k:', '  - x', '  -', '    # c', 'b: 2'),
      { k: ['x', 'y'] },
      block('k:', '  - x', '  - y', '    # c', 'b: 2'),
      { k: ['x', 'y'], b: 2 },
    );
  });

  it('an empty last value in a map', () => {
    writes(
      block('k:', '  m: 1', '  n:', '    # c', 'b: 2'),
      { k: { m: 2, n: null } },
      block('k:', '  m: 2', '  n:', '    # c', 'b: 2'),
      { k: { m: 2, n: null }, b: 2 },
    );
  });

  it('an empty anchored last item, written without a trailing space', () => {
    writes(
      block('k:', '  - x', '  - &a', '    # c', 'b: 2'),
      { k: ['y', null] },
      block('k:', '  - y', '  - &a', '    # c', 'b: 2'),
      { k: ['y', null], b: 2 },
    );
  });
});

describe('#453: a comment under the last key, its value changed to two lines', () => {
  it('is not read as the new text', () => {
    const written = updateFrontmatter(block('a: 1', 't: [x]', '    # deep'), { t: 'one\ntwo' });
    expect(parseFrontmatterProperties(written)).toEqual({ a: 1, t: 'one\ntwo' });
  });

  it('nor under a key added after it', () => {
    const written = updateFrontmatter(block('a: 1', 't: x', '    # deep'), { n: 'one\ntwo' });
    expect(parseFrontmatterProperties(written)).toEqual({ a: 1, t: 'x', n: 'one\ntwo' });
    expect(written).toContain('    # deep\n');
  });
});

describe('the read-back check', () => {
  /** `a: 1` changed to `a: 2`, with a writer that writes `bodies[rules]`. */
  function check(bodies: { kept: string; main: string }) {
    const document = parseDocument('a: 1\nb: 2\n');
    document.set('a', 2);
    const edit: Edit = {
      touched: new Set(),
      asWritten: new Map(),
      cleared: new Map(),
      keys: new Set(['a']),
    };
    return checkedBody({
      document,
      before: null,
      edit,
      was: { a: 1, b: 2 },
      blank: '',
      lists: {},
      compose: ({ rules }) => bodies[rules],
    });
  }

  it('takes the first writing that reads back right', () => {
    expect(check({ kept: 'a: 2\nb: 2', main: 'a: 2\nb: 2 # main' })).toBe('a: 2\nb: 2');
  });

  it('falls back when the changed key reads back wrong', () => {
    expect(check({ kept: 'a: 3\nb: 2', main: 'a: 2\nb: 2' })).toBe('a: 2\nb: 2');
  });

  it('falls back when a key the change did not name reads back changed', () => {
    expect(check({ kept: 'a: 2\nb: |\n  2', main: 'a: 2\nb: 2' })).toBe('a: 2\nb: 2');
  });

  it('falls back when the block cannot be read', () => {
    expect(check({ kept: 'a: 2\n b: 2', main: 'a: 2\nb: 2' })).toBe('a: 2\nb: 2');
  });

  it('refuses, writing nothing, when no writing reads back right', () => {
    expect(() => check({ kept: 'a: 2', main: 'a: 2\nb: 3' })).toThrow(FrontmatterRefusedError);
  });
});
