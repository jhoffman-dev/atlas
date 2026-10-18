/**
 * Adversarial (#200): updateFrontmatter must name a key the way the reader
 * does — an alias key `*k` by the key `&k` anchors, a null key `~` as "" — or
 * a change adds a second key that shadows the one already there. And a value
 * that refers to itself must not make the write throw. Mirrors
 * frontmatter-add.adversarial.test.ts (#193).
 */
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { updateFrontmatter } from './frontmatter-write.ts';
import { parseFrontmatterProperties } from './frontmatter.ts';

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;

/** The block as YAML values, with cycles kept (JSON cannot hold them). */
const valuesOf = (frontmatter: string) =>
  parseDocument(frontmatter.replace(/^---\n/, '').replace(/\n---\n$/, '\n')).toJS() as Record<
    string,
    unknown
  >;

describe('updateFrontmatter, on a key written as an alias', () => {
  const before = block('k: &k tasks', '*k : old', 'title: Plan');

  it('the reader names it by the key its anchor holds', () => {
    expect(parseFrontmatterProperties(before)).toEqual({ k: 'tasks', tasks: 'old', title: 'Plan' });
  });

  it('changes that key in its place rather than adding one that shadows it', () => {
    // The changed key is the library's to write, and it writes an alias key
    // in explicit form; the lines around it keep their bytes.
    const written = updateFrontmatter(before, { tasks: 'new' });
    expect(written).toBe(block('k: &k tasks', '? *k', ': new', 'title: Plan'));
    expect(parseFrontmatterProperties(written)).toEqual({
      k: 'tasks',
      tasks: 'new',
      title: 'Plan',
    });
  });

  it('a value it already holds is no change', () => {
    expect(updateFrontmatter(before, { tasks: 'old' })).toBe(before);
  });

  it('removes it when cleared, leaving the other lines as they were', () => {
    expect(updateFrontmatter(before, { tasks: null })).toBe(block('k: &k tasks', 'title: Plan'));
  });

  it('another key changed leaves the alias line as it was', () => {
    expect(updateFrontmatter(before, { title: 'Next' })).toBe(
      block('k: &k tasks', '*k : old', 'title: Next'),
    );
  });
});

describe('updateFrontmatter, on a null key', () => {
  const before = block('~: old', 'title: Plan');

  it('the reader names it ""', () => {
    expect(parseFrontmatterProperties(before)).toEqual({ '': 'old', title: 'Plan' });
  });

  it('changes that key in its place rather than adding one that shadows it', () => {
    expect(updateFrontmatter(before, { '': 'new' })).toBe(block('~: new', 'title: Plan'));
  });

  it('a value it already holds is no change', () => {
    expect(updateFrontmatter(before, { '': 'old' })).toBe(before);
  });

  it('removes it when cleared, leaving the other lines as they were', () => {
    expect(updateFrontmatter(before, { '': null })).toBe(block('title: Plan'));
  });

  it('another key changed leaves the null key line as it was', () => {
    expect(updateFrontmatter(before, { title: 'Next' })).toBe(block('~: old', 'title: Next'));
  });
});

describe('updateFrontmatter, with a value that refers to itself', () => {
  // YAML allows `&e` / `*e` cycles; `toJS` builds a circular object, which
  // JSON.stringify — the "already holds it?" check — throws on.
  it.each([
    // A map written into a map keeps its node, and with it the anchor `&e`.
    ['through a map', block('extra: &e', '  me: *e', 'title: Plan'), 'extra: &e'],
    ['through a list', block('extra: &e', '  - *e', 'title: Plan'), 'extra:'],
  ])('%s: the cyclic key is changed, the others keep their bytes', (_, before, head) => {
    let written = '';
    expect(() => {
      written = updateFrontmatter(before, { extra: { a: 1 } });
    }).not.toThrow();
    expect(written).toBe(block(head, '  a: 1', 'title: Plan'));
  });

  it('a key beside the cycle changes and the cycle keeps its bytes', () => {
    const before = block('extra: &e', '  me: *e', 'title: Plan');
    expect(updateFrontmatter(before, { title: 'Next' })).toBe(
      block('extra: &e', '  me: *e', 'title: Next'),
    );
  });

  it('a JavaScript object cycle is written as an anchor, the other keys keep their bytes', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    const before = block('# kept', 'title: Plan', 'extra: old');
    let written = '';
    expect(() => {
      written = updateFrontmatter(before, { extra: cyclic });
    }).not.toThrow();
    expect(written.startsWith('---\n# kept\ntitle: Plan\n')).toBe(true);
    const extra = valuesOf(written)['extra'] as Record<string, unknown>;
    expect(extra['a']).toBe(1);
    expect(extra['self']).toBe(extra);
    expect(valuesOf(written)['title']).toBe('Plan');
  });

  it.each([
    ['through a map', block('extra: &e', '  me: *e', 'title: Plan')],
    ['through a list', block('extra: &e', '  - *e', 'title: Plan')],
  ])('%s: written back as it was read, the block keeps every byte', (_, before) => {
    // Counted as changed, the value was written again one level deeper on
    // every save, and the file grew with each round trip.
    const extra = parseFrontmatterProperties(before)['extra'];
    expect(updateFrontmatter(before, { extra })).toBe(before);
  });
});

describe('updateFrontmatter, on two spellings of one key, keeps the shadowed one', () => {
  const before = block('~: e', '"": z', 't: T');

  it('setting the key writes the pair the reader reads; the other keeps its bytes', () => {
    expect(updateFrontmatter(before, { '': 'f' })).toBe(block('~: e', '"": f', 't: T'));
  });

  it('changing another key leaves both spellings as they were', () => {
    expect(updateFrontmatter(before, { t: 'U' })).toBe(block('~: e', '"": z', 't: U'));
  });
});

describe('updateFrontmatter, on a list used as a key', () => {
  const before = block('? [a, b]', ': x', 't: T');

  it('names it as the reader does, and changes it in its place', () => {
    expect(Object.keys(parseFrontmatterProperties(before))).toEqual(['[ a, b ]', 't']);
    const written = updateFrontmatter(before, { '[ a, b ]': 'y' });
    expect(written).toBe(block('? [a, b]', ': y', 't: T'));
  });

  it('an alias of it as a key is named as the reader names it', () => {
    const aliased = block('k: &k [a, b]', '*k : x', 't: T');
    expect(parseFrontmatterProperties(aliased)).toEqual({ k: ['a', 'b'], '*k': 'x', t: 'T' });
    expect(parseFrontmatterProperties(updateFrontmatter(aliased, { '*k': 'y' }))).toEqual({
      k: ['a', 'b'],
      '*k': 'y',
      t: 'T',
    });
  });

  it('refuses to change the list an alias key names, rather than rename that key', () => {
    // Written out in the alias's place, the key would read as "[ a, b ]", not "*k".
    const aliased = block('k: &k [a, b]', '*k : x', 't: T');
    expect(() => updateFrontmatter(aliased, { k: [1] })).toThrow(/would be renamed/);
  });
});

describe('updateFrontmatter, given a cycle of another length than the one stored', () => {
  // `x = [x]` and `y = [[y]]` read the same at every depth. Comparing them by
  // one partner per object alternated between pairings and never ended.
  const listOfItself = (depth: number) => {
    const outer: unknown[] = [];
    let inner = outer;
    for (let at = 1; at < depth; at += 1) {
      const next: unknown[] = [];
      inner.push(next);
      inner = next;
    }
    inner.push(outer);
    return outer;
  };
  const mapOfItself = (depth: number) => {
    const outer: Record<string, unknown> = {};
    let inner = outer;
    for (let at = 1; at < depth; at += 1) {
      const next: Record<string, unknown> = {};
      inner['m'] = next;
      inner = next;
    }
    inner['m'] = outer;
    return outer;
  };

  it.each([
    ['a one-list cycle, given two', block('a: &e [*e]', 't: T'), listOfItself(2)],
    ['a two-list cycle, given one', block('a: &e [[*e]]', 't: T'), listOfItself(1)],
    ['a two-list cycle, given three', block('a: &e [[*e]]', 't: T'), listOfItself(3)],
    ['a one-map cycle, given two', block('a: &e', '  m: *e', 't: T'), mapOfItself(2)],
    ['a two-map cycle, given one', block('a: &e', '  m:', '    m: *e', 't: T'), mapOfItself(1)],
  ])('%s: reads the same, so the block keeps every byte', (_, before, given) => {
    expect(updateFrontmatter(before, { a: given })).toBe(before);
  });
});

describe('updateFrontmatter, on two spellings of one key inside a map', () => {
  const before = block('m:', '  1: one', '  "1": two', 't: T');

  it('a set edits the spelling the reader reads, the other keeps its bytes', () => {
    const written = updateFrontmatter(before, { m: { '1': 'three' } });
    expect(parseFrontmatterProperties(written)).toEqual({ m: { '1': 'three' }, t: 'T' });
    expect(written).toBe(block('m:', '  1: one', '  "1": three', 't: T'));
  });

  it('a remove removes every spelling', () => {
    const written = updateFrontmatter(before, { m: { x: 1 } });
    expect(parseFrontmatterProperties(written)).toEqual({ m: { x: 1 }, t: 'T' });
  });
});
