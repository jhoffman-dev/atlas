/**
 * Adversarial pass on #376 (#284): a block that lists a key twice. A change to
 * any other key writes only that key's bytes; a change to the duplicated key —
 * as YAML sees it, whatever the spelling — is refused with a
 * FrontmatterRefusedError naming the property, and nothing is returned.
 */
import { describe, expect, it } from 'vitest';
import { FrontmatterRefusedError } from '@atlas/application';
import { updateFrontmatter } from './frontmatter-write.ts';
import { frontmatterProblem, parseFrontmatterProperties } from './frontmatter.ts';

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;
const twice = (key: string) =>
  `This note's properties list "${key}" twice; fix it in the source before changing it.`;
const inside = (key: string, inner: string) =>
  `This note's property "${key}" lists "${inner}" twice; fix it in the source before changing it.`;

/** The refusal `updateFrontmatter` throws, or a failure when it returns instead. */
function refusalOf(frontmatter: string, changes: Record<string, unknown>): FrontmatterRefusedError {
  try {
    const written = updateFrontmatter(frontmatter, changes);
    throw new Error(`expected a refusal, got ${JSON.stringify(written)}`);
  } catch (cause) {
    if (cause instanceof FrontmatterRefusedError) return cause;
    throw cause;
  }
}

/** mulberry32: a small seeded generator, so a failing case can be replayed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('#376 refusal names the property YAML calls duplicated, however it is spelled', () => {
  it.each([
    ['a double-quoted copy', block('a: 1', 't: T', '"a": 2')],
    ['a single-quoted copy', block("'a': 1", 't: T', 'a: 2')],
    ['an anchored copy', block('a: 1', 't: T', '&k a: 2')],
    ['a tagged copy', block('a: 1', 't: T', '!!str a: 2')],
    ['an anchored and tagged copy', block('a: 1', 't: T', '&k !!str a: 2')],
    ['an explicit-key copy', block('a: 1', 't: T', '? a', ': 2')],
    ['three copies', block('a: 1', 'a: 2', 't: T', 'a: 3')],
    ['a copy after a commented-out copy', block('a: 1', '# a: 2', 't: T', 'a: 3')],
    ['a block scalar as the first copy', block('a: |', '  one', '  two', 't: T', 'a: 2')],
    ['an empty value in both copies', block('a:', 't: T', 'a:')],
    ['a flow map block', '---\n{a: 1, a: 2, t: T}\n---\n'],
    ['CRLF line endings', '---\r\na: 1\r\nt: T\r\na: 2\r\n---\r\n'],
    ['a byte-order mark', '\uFEFF---\na: 1\nt: T\na: 2\n---\n'],
  ])('%s', (_, frontmatter) => {
    const refused = refusalOf(frontmatter, { a: 9 });
    expect({ key: refused.key, message: refused.message }).toEqual({
      key: 'a',
      message: twice('a'),
    });
  });

  it('a null key spelled ~ and null is refused as the empty-named property', () => {
    expect(refusalOf(block('~: 1', 't: T', 'null: 2'), { '': 3 }).key).toBe('');
  });

  it('a number key spelled 1 and 0x1 is refused as "1"', () => {
    expect(refusalOf(block('1: x', 't: T', '0x1: y'), { '1': 3 }).key).toBe('1');
  });

  it.each([
    ['a list of maps', block('l:', '  - x: 1', '    x: 2', 't: T'), 'l', 'x'],
    ['a map two levels deep', block('m:', '  n:', '    x: 1', '    x: 2', 't: T'), 'm', 'x'],
    ['an inline map value', block('m: {x: 1, x: 2}', 't: T'), 'm', 'x'],
  ])('a duplicate inside %s refuses its top-level property', (_, frontmatter, key, inner) => {
    const refused = refusalOf(frontmatter, { [key]: 1 });
    expect({ key: refused.key, message: refused.message }).toEqual({
      key,
      message: inside(key, inner),
    });
  });

  it('removing the duplicated key alongside an adjacent one is refused', () => {
    expect(refusalOf(block('t: T', 'a: 1', 'a: 2', 'u: U'), { u: null, a: null }).key).toBe('a');
  });
});

describe('#376 a change beside a duplicate writes only its own bytes', () => {
  it.each([
    [
      'a flow map block',
      '---\n{a: 1, a: 2, b: 3}\n---\n',
      { b: 4 },
      '---\n{a: 1, a: 2, b: 4}\n---\n',
    ],
    ['keys differing by case', block('a: 1', 'A: 2'), { a: 3 }, block('a: 3', 'A: 2')],
    ['a trailing-space key', block('a: 1', '"a ": 2'), { a: 3 }, block('a: 3', '"a ": 2')],
    [
      'a list of maps',
      block('l:', '  - x: 1', '    x: 2', 't: T'),
      { t: 'U' },
      block('l:', '  - x: 1', '    x: 2', 't: U'),
    ],
    [
      'two levels deep',
      block('m:', '  n:', '    x: 1', '    x: 2', 't: T'),
      { t: 'U' },
      block('m:', '  n:', '    x: 1', '    x: 2', 't: U'),
    ],
    [
      'an anchored copy',
      block('a: 1', 't: T', '&k a: 2'),
      { t: 'U' },
      block('a: 1', 't: U', '&k a: 2'),
    ],
    [
      'three copies, the change between',
      block('a: 1', 'a: 2', 't: T', 'a: 3'),
      { t: 'U' },
      block('a: 1', 'a: 2', 't: U', 'a: 3'),
    ],
    [
      'a block scalar copy',
      block('a: |', '  one', '  two', 't: T', 'a: 2'),
      { t: 'U' },
      block('a: |', '  one', '  two', 't: U', 'a: 2'),
    ],
    [
      'a tab after the colon',
      block('a:\t1', 't: T', 'a: 2'),
      { t: 'U' },
      block('a:\t1', 't: U', 'a: 2'),
    ],
    ['empty values', block('a:', 't: T', 'a:'), { t: 'U' }, block('a:', 't: U', 'a:')],
    [
      'repeated merge keys',
      block('base: &b {x: 1}', 'm:', '  <<: *b', '  <<: *b', 't: T'),
      { t: 'U' },
      block('base: &b {x: 1}', 'm:', '  <<: *b', '  <<: *b', 't: U'),
    ],
    [
      'an alias of the duplicate',
      block('a: &x 1', 't: *x', 'a: 2'),
      { t: 'U' },
      block('a: &x 1', 't: U', 'a: 2'),
    ],
    [
      'a byte-order mark',
      '\uFEFF---\na: 1\nt: T\na: 2\n---\n',
      { t: 'U' },
      '\uFEFF---\na: 1\nt: U\na: 2\n---\n',
    ],
    [
      'removing the adjacent keys',
      block('t: T', 'a: 1', 'a: 2', 'u: U'),
      { t: null, u: null },
      block('a: 1', 'a: 2'),
    ],
    ['adding a new key', block('a: 1', 'a: 2'), { n: 'N' }, block('a: 1', 'a: 2', 'n: N')],
  ])('%s', (_, frontmatter, changes, expected) => {
    expect(updateFrontmatter(frontmatter, changes)).toBe(expected);
  });

  it('a block with no change at all is returned as it was, even with an unplaceable duplicate', () => {
    const frontmatter = block('? {x: 1, x: 2}', ': v', 't: T');
    expect(updateFrontmatter(frontmatter, {})).toBe(frontmatter);
  });

  it('over seeded blocks, changing a random non-duplicated key rewrites only its own line', () => {
    const random = seeded(376);
    for (let round = 0; round < 200; round += 1) {
      const size = 2 + Math.floor(random() * 12);
      const lines = Array.from(
        { length: size },
        (_, i) => `k${i}:${' '.repeat(1 + Math.floor(random() * 3))}v${i}`,
      );
      const duplicated = Math.floor(random() * size);
      const at = Math.floor(random() * (size + 1));
      lines.splice(at, 0, `k${duplicated}: again`);
      let target = Math.floor(random() * size);
      if (target === duplicated) target = (target + 1) % size;
      const line = lines.findIndex((each) => each.startsWith(`k${target}:`));
      const expected = lines.with(line, `k${target}: changed`);
      const seen = { round, size, duplicated, at, target };
      expect({
        ...seen,
        out: updateFrontmatter(block(...lines), { [`k${target}`]: 'changed' }),
      }).toEqual({
        ...seen,
        out: block(...expected),
      });
      expect({
        ...seen,
        refused: refusalOf(block(...lines), { [`k${duplicated}`]: 'x' }).key,
      }).toEqual({
        ...seen,
        refused: `k${duplicated}`,
      });
    }
  });

  it('500 keys with a duplicate: a change and a refusal stay well under a second', () => {
    const lines = [...Array.from({ length: 500 }, (_, i) => `k${i}: v${i}`), 'k0: again'];
    const frontmatter = block(...lines);
    const started = performance.now();
    updateFrontmatter(frontmatter, { k250: 'x' });
    refusalOf(frontmatter, { k0: 'x' });
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('#376 the reader and the writer agree on which blocks a change can go through', () => {
  it('every block the writer refuses a change to is one the reader reports a problem with', () => {
    for (const frontmatter of [
      block('a: 1', 't: T', 'a: 2'),
      block('m: {x: 1, x: 2}', 't: T'),
      block('? {x: 1, x: 2}', ': v', 't: T'),
    ]) {
      expect(() => updateFrontmatter(frontmatter, { a: 1, m: 1, t: 1 })).toThrow(
        FrontmatterRefusedError,
      );
      expect(frontmatterProblem(frontmatter)).not.toBeNull();
    }
  });
});

describe('#376 an indented block (pre-existing, not from #376)', () => {
  // Known failure, tracked in #377: the writer puts the changed key back at
  // column 0 among keys indented by two. Flip to `it` when #377 is fixed.
  it.fails('changing one key of a block indented by two spaces keeps the block readable', () => {
    const frontmatter = block('  a: 1', '  t: T', '  b: 2');
    const written = updateFrontmatter(frontmatter, { t: 'U' });
    expect(parseFrontmatterProperties(written)).toEqual({ a: 1, t: 'U', b: 2 });
  });
});
