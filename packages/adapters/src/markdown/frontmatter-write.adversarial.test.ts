/**
 * Adversarial (#200): updateFrontmatter must name a key the way the reader
 * does — an alias key `*k` by the key `&k` anchors, a null key `~` as "" — or
 * a change adds a second key that shadows the one already there. And a value
 * that refers to itself must not make the write throw. Mirrors
 * frontmatter-add.adversarial.test.ts (#193).
 */
import { isDeepStrictEqual } from 'node:util';
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
    expect(written.startsWith(block('# kept', 'title: Plan').replace(/---\n$/, ''))).toBe(true);
    const extra = valuesOf(written)['extra'] as Record<string, unknown>;
    expect(extra['a']).toBe(1);
    expect(extra['self']).toBe(extra);
    expect(isDeepStrictEqual(valuesOf(written)['title'], 'Plan')).toBe(true);
  });
});
