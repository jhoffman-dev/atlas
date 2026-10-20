/**
 * #430: the cases #395 left. A save is byte-preserving (ADR-0003): a change
 * writes the changed value's bytes and nothing else, so an inline comment
 * stays on its line, a comment below a value stays below it, whatever form
 * the value had or is given, and blank lines ending the block stay.
 */
import { describe, expect, it } from 'vitest';
import { updateFrontmatter } from './frontmatter-write.ts';
import { parseFrontmatterProperties } from './frontmatter.ts';

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;

describe('#430 an inline comment and a comment below a changed value', () => {
  it('the issue: both stay where they were', () => {
    expect(updateFrontmatter(block('a: 1', 't: T # inl', '    # deep', 'b: 2'), { t: 'U' })).toBe(
      block('a: 1', 't: U # inl', '    # deep', 'b: 2'),
    );
  });

  it('the inline comment keeps its spacing, and a blank line between them stays', () => {
    expect(
      updateFrontmatter(block('t: T   #  inl', '', '   # deep', 'b: 2'), { t: 'U # hash' }),
    ).toBe(block('t: "U # hash"   #  inl', '', '   # deep', 'b: 2'));
  });

  it('under a flow list', () => {
    expect(updateFrontmatter(block('t: [x] # inl', '  # deep', 'b: 2'), { t: ['x', 'y'] })).toBe(
      block('t: [x, y] # inl', '  # deep', 'b: 2'),
    );
  });
});

describe('#430 a comment below a block list or map', () => {
  it('the issue: a block list keeps the comment below its items', () => {
    expect(
      updateFrontmatter(block('a: 1', 't:', '  - x', '    # deep', 'b: 2'), { t: ['y'] }),
    ).toBe(block('a: 1', 't:', '  - y', '    # deep', 'b: 2'));
  });

  it('an item added after the last one goes above the comment', () => {
    expect(updateFrontmatter(block('t:', '  - x', '  # deep', 'b: 2'), { t: ['x', 'y'] })).toBe(
      block('t:', '  - x', '  - y', '  # deep', 'b: 2'),
    );
  });

  it('the last item keeps its own inline comment', () => {
    expect(
      updateFrontmatter(block('t:', '  - x # mine', '   # deep', 'b: 2'), { t: ['w', 'x'] }),
    ).toBe(block('t:', '  - w', '  - x # mine', '   # deep', 'b: 2'));
  });

  it('a block map, the comment under a nested list', () => {
    expect(
      updateFrontmatter(block('t:', '  k: v', '  j:', '    - z', '    # deep', 'b: 2'), {
        t: { k: 'w', j: ['z'] },
      }),
    ).toBe(block('t:', '  k: w', '  j:', '    - z', '    # deep', 'b: 2'));
  });

  it('a block list changed to a scalar', () => {
    expect(updateFrontmatter(block('t:', '  - x', '  # deep', '', 'b: 2'), { t: 'U' })).toBe(
      block('t: U', '  # deep', '', 'b: 2'),
    );
  });

  it('the last key of the block', () => {
    expect(updateFrontmatter(block('a: 1', 't:', '  - x', '    # deep'), { t: ['y'] })).toBe(
      block('a: 1', 't:', '  - y', '    # deep'),
    );
  });

  it('with CRLF line endings, in an indented block', () => {
    expect(
      updateFrontmatter('---\r\n  t:\r\n    - x\r\n      # deep\r\n  b: 2\r\n---\r\n', {
        t: ['y'],
      }),
    ).toBe('---\r\n  t:\r\n    - y\r\n      # deep\r\n  b: 2\r\n---\r\n');
  });
});

describe('#430 a value changed to a block list or map', () => {
  it('the issue: a scalar to a list keeps the comment below it', () => {
    expect(updateFrontmatter(block('a: 1', 't: T', '    # deep', 'b: 2'), { t: ['x', 'y'] })).toBe(
      block('a: 1', 't:', '  - x', '  - y', '    # deep', 'b: 2'),
    );
  });

  it('a scalar to a map', () => {
    expect(updateFrontmatter(block('t: T', '  # deep', '', 'b: 2'), { t: { k: 'v' } })).toBe(
      block('t:', '  k: v', '  # deep', '', 'b: 2'),
    );
  });

  it('a block of text to two lines, the comment shallower than the text', () => {
    expect(updateFrontmatter(block('t: |', '  a', ' # deep', 'b: 2'), { t: 'one\ntwo' })).toBe(
      block('t: |-', '  one', '  two', ' # deep', 'b: 2'),
    );
  });

  it('a list to two lines of text, the comment shallower than the text', () => {
    expect(updateFrontmatter(block('t:', '  - x', ' # deep', 'b: 2'), { t: 'one\ntwo' })).toBe(
      block('t: |-', '  one', '  two', ' # deep', 'b: 2'),
    );
  });

  it('guard: a comment as deep as the new text is not put where it would be read as text', () => {
    const written = updateFrontmatter(block('t:', '  - x', '    # deep', 'b: 2'), {
      t: 'one\ntwo',
    });
    expect(parseFrontmatterProperties(written)).toEqual({ t: 'one\ntwo', b: 2 });
  });

  it('guard: a comment the new value keeps a node of is left where the library puts it', () => {
    // The comment is taken off the item before writing; it cannot go back
    // under the list, so it is given back to the item, not lost.
    const written = updateFrontmatter(block('t:', '  - x', '    # deep', 'b: 2'), {
      t: ['x', 'one\ntwo'],
    });
    expect(parseFrontmatterProperties(written)).toEqual({ t: ['x', 'one\ntwo'], b: 2 });
    expect(written).toContain('# deep');
  });
});

describe('#430 blank lines ending the block', () => {
  it('the issue: one blank line under a changed last key', () => {
    expect(updateFrontmatter('---\na: 1\nt: T\n\n---\n', { t: 'U' })).toBe(
      '---\na: 1\nt: U\n\n---\n',
    );
  });

  it('two blank lines, with CRLF', () => {
    expect(updateFrontmatter('---\r\na: 1\r\nt: T\r\n\r\n\r\n---\r\n', { a: 2 })).toBe(
      '---\r\na: 2\r\nt: T\r\n\r\n\r\n---\r\n',
    );
  });

  it('after a trailing comment', () => {
    expect(updateFrontmatter('---\na: 1\n# end\n\n---\n', { a: 2 })).toBe(
      '---\na: 2\n# end\n\n---\n',
    );
  });

  it('under a block list that changed', () => {
    expect(updateFrontmatter('---\nt:\n  - x\n\n---\n', { t: ['y'] })).toBe(
      '---\nt:\n  - y\n\n---\n',
    );
  });
});
