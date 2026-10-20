/**
 * Attack on PR #454 (#430). ADR-0003: changing one key leaves every byte that
 * is not that key's value as it was, and the block reads back with the new
 * value and every other value unchanged.
 *
 * The first two describes are regressions against main's writer (main gets
 * them right). The last is what main gets wrong too, left by the PR.
 */
import { describe, expect, it } from 'vitest';
import { updateFrontmatter } from './frontmatter-write.ts';
import { frontmatterProblem, parseFrontmatterProperties } from './frontmatter.ts';

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;

describe('#454 regression: a whitespace-only line ending a block scalar', () => {
  // Spaces past the scalar's indent are its text (YAML 1.2 l-nb-literal-text):
  // `     ` under `  x` is a line holding three spaces, part of the old value.
  it('a literal changed reads back as the new value, not with the old trailing spaces', () => {
    const written = updateFrontmatter(block('d: |', '  x', '     ', '# c', 'b: 2'), { d: 'y\n' });
    expect(parseFrontmatterProperties(written).d).toBe('y\n');
  });

  it('a strip scalar changed reads back as the new value', () => {
    const written = updateFrontmatter(block('d: |-', '  x', '     ', 'b: 2'), { d: 'y' });
    expect(parseFrontmatterProperties(written).d).toBe('y');
  });

  it('the last key of the block reads back as the new value', () => {
    const written = updateFrontmatter(block('a: 1', 'd: |', '  x', '   '), { d: 'y\n' });
    expect(parseFrontmatterProperties(written).d).toBe('y\n');
  });

  it('a block scalar as the last list item reads back as the new value', () => {
    const written = updateFrontmatter(block('t:', '  - |', '    x', '       ', 'b: 2'), {
      t: ['y\n'],
    });
    expect(parseFrontmatterProperties(written).t).toEqual(['y\n']);
  });

  it('a tab after the indent is text too: the new value does not gain it', () => {
    const written = updateFrontmatter(block('d: |', '  x', '  \t', '# c', 'b: 2'), { d: 'y\n' });
    expect(parseFrontmatterProperties(written).d).toBe('y\n');
  });
});

describe('#454 regression: adding a key after a keep (|+) scalar that ends the block', () => {
  // The reader drops the newline before the closing `---`, so the last blank
  // line of the block is not the |+ value's; writing a key below it makes it so.
  it('the untouched |+ value reads back unchanged', () => {
    const original = block('k: |+', '  x', '');
    const before = parseFrontmatterProperties(original).k;
    const written = updateFrontmatter(original, { z: 1 });
    expect(parseFrontmatterProperties(written).k).toBe(before);
  });

  it('with several blank lines, CRLF, in an indented block', () => {
    const original = '---\r\n k: |+\r\n   x\r\n\r\n\r\n\r\n---\r\n';
    const before = parseFrontmatterProperties(original).k;
    const written = updateFrontmatter(original, { z: 1 });
    expect(parseFrontmatterProperties(written).k).toBe(before);
  });
});

describe('#454 pre-existing (main too): left by the PR', () => {
  it('[high] an indented block with a same-column list changed to [] stays readable', () => {
    const written = updateFrontmatter(
      block(' k2:', ' - a', '    # below', ' # above k3', ' k3: 1'),
      { k2: [] },
    );
    expect(frontmatterProblem(written)).toBeNull();
  });

  it('a block scalar cleared to "" keeps the comment below it', () => {
    const written = updateFrontmatter(block('k: |', '  x', ' # c', 'b: 2'), { k: '' });
    expect(written).toContain(' # c\n');
  });

  it('an empty value given a scalar gains no blank line', () => {
    expect(updateFrontmatter(block('k:', '', '  # c', 'b: 2'), { k: 42 })).toBe(
      block('k: 42', '', '  # c', 'b: 2'),
    );
  });

  it('a key added after the last key goes below that key comment below it', () => {
    expect(updateFrontmatter(block('a: 1', 't:', '  - x', '  # below t'), { n: 'v' })).toBe(
      block('a: 1', 't:', '  - x', '  # below t', 'n: v'),
    );
  });

  it('a column-0 comment between list items keeps its column when the list changes', () => {
    expect(
      updateFrontmatter(block('tags:', '  - a', '# col0', '  - b', 'title: T'), {
        tags: ['a', 'b', 'c'],
      }),
    ).toBe(block('tags:', '  - a', '# col0', '  - b', '  - c', 'title: T'));
  });
});
