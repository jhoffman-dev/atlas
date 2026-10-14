/**
 * Adversarial: addToFrontmatterMap (#162) promises null, never a throw, for a
 * block it cannot add to, and null for "a key `entries` names already". These
 * are the inputs where it does neither.
 */
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { addToFrontmatterMap } from './frontmatter-add.ts';

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;
const TASKS = { tasks: { kind: 'relation', target: 'task', many: true } };

/** The block as YAML values, with cycles kept (JSON cannot hold them). */
const valuesOf = (frontmatter: string) =>
  parseDocument(frontmatter.replace(/^---\n/, '').replace(/\n---\n$/, '\n')).toJS() as Record<
    string,
    unknown
  >;

describe('addToFrontmatterMap, on a block holding an anchor that refers to itself', () => {
  // YAML allows `&e` / `*e` cycles; `toJS` builds a circular object, and the
  // read-back check's JSON.stringify throws on it.
  it.each([
    [
      'elsewhere in the block',
      block('name: meeting', 'extra: &e', '  me: *e', 'properties:', '  title: text'),
    ],
    [
      'inside `properties`',
      block('name: meeting', 'properties: &p', '  title: text', '  self: *p'),
    ],
    [
      'through a list',
      block('name: meeting', 'extra: &e', '  - *e', 'properties:', '  title: text'),
    ],
  ])('%s: returns null or the block with the keys added — never throws', (_, before) => {
    let written: string | null = null;
    expect(() => {
      written = addToFrontmatterMap(before, 'properties', TASKS);
    }).not.toThrow();
    if (written !== null) {
      const was = valuesOf(before);
      expect(
        isDeepStrictEqual(valuesOf(written)['properties'], {
          ...(was['properties'] as object),
          ...TASKS,
        }),
      ).toBe(true);
    }
  });
});

describe('addToFrontmatterMap, given a key the map already holds under another spelling', () => {
  // YAML's duplicate-key check compares nodes, so `*k` (an alias of `tasks`),
  // `2024` (an int) and `true` (a bool) are not duplicates of the string keys
  // written after them — but every reader that turns the block into values
  // (Atlas's index, its type parser) keeps only the last, so the person's own
  // property is silently replaced. `expected` spreads `entries` over what was
  // held, so the read-back check agrees with the shadowed result.
  it.each([
    [
      'an alias of it',
      block('name: meeting', 'k: &k tasks', 'properties:', '  *k : text'),
      'tasks',
    ],
    ['the number it reads as', block('name: meeting', 'properties:', '  2024: text'), '2024'],
    ['the boolean it reads as', block('name: meeting', 'properties:', '  true: text'), 'true'],
  ])('refuses %s rather than shadow the property', (_, before, key) => {
    expect(addToFrontmatterMap(before, 'properties', { [key]: 'date' })).toBeNull();
  });
});

describe('addToFrontmatterMap, on a block that is not a map', () => {
  // Unreachable from #162's migration (a type file needs `name:`), but the
  // port's contract is null, and updateFrontmatter's `document.set` throws.
  it.each([
    ['a list', block('- a', '- b')],
    ['a scalar', block('just text')],
    ['only a document-end marker', block('...')],
  ])('returns null for %s rather than throw', (_, before) => {
    expect(() => addToFrontmatterMap(before, 'properties', TASKS)).not.toThrow();
  });
});

describe('addToFrontmatterMap, on a key that holds something other than a map', () => {
  // A list whose item refers back to it, and a flow `!!set`, threw from the
  // writer before the read-back check could refuse them.
  it.each([
    ['a list that holds itself', block('name: meeting', 'properties: &p', '  - *p')],
    ['a set', block('name: meeting', 'properties: !!set {title}')],
  ])('returns null for %s rather than throw', (_, before) => {
    let written: string | null = '';
    expect(() => {
      written = addToFrontmatterMap(before, 'properties', TASKS);
    }).not.toThrow();
    expect(written).toBeNull();
  });

  it('returns null for a block that is a set rather than throw', () => {
    const before = '---\n!!set\n? name\n---\n';
    let written: string | null = '';
    expect(() => {
      written = addToFrontmatterMap(before, 'properties', TASKS);
    }).not.toThrow();
    expect(written).toBeNull();
  });
});
