/**
 * #395: a comment line under a changed key's value, deeper than the key, is
 * the value's comment to the yaml library — the field an inline comment uses —
 * so it used to be written onto the value's line. A save is byte-preserving
 * (ADR-0003): changing a value changes that value's bytes and nothing else, so
 * every comment stays on the line it was on.
 */
import { describe, expect, it } from 'vitest';
import { updateFrontmatter } from './frontmatter-write.ts';
import { parseFrontmatterProperties } from './frontmatter.ts';

const block = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;

describe('#395 a comment under a changed value stays on its own line', () => {
  it('the issue: a deep comment under a value in the middle of the block', () => {
    expect(updateFrontmatter(block('a: 1', 't: T', '      # deep', 'b: 2'), { t: 'U' })).toBe(
      block('a: 1', 't: U', '      # deep', 'b: 2'),
    );
  });

  it('two comment lines under the value, at different depths', () => {
    expect(
      updateFrontmatter(block('a: 1', 't: T', '      # set by Mara', '   # and Tobias', 'b: 2'), {
        t: 'U',
      }),
    ).toBe(block('a: 1', 't: U', '      # set by Mara', '   # and Tobias', 'b: 2'));
  });

  it('a comment under the value, then a blank line', () => {
    expect(updateFrontmatter(block('a: 1', 't: T', '  # deep', '', 'b: 2'), { t: 'U' })).toBe(
      block('a: 1', 't: U', '  # deep', '', 'b: 2'),
    );
  });

  it('a blank line, then a comment under the value', () => {
    expect(updateFrontmatter(block('a: 1', 't: T', '', '  # deep', 'b: 2'), { t: 'U' })).toBe(
      block('a: 1', 't: U', '', '  # deep', 'b: 2'),
    );
  });

  it('a comment under the last key, the closing line without a newline', () => {
    expect(updateFrontmatter('---\na: 1\nt: T\n  # deep\n---', { t: 'U' })).toBe(
      '---\na: 1\nt: U\n  # deep\n---',
    );
  });

  it('in an indented block', () => {
    expect(
      updateFrontmatter(block('  a: 1', '  t: T', '      # deep', '  b: 2'), { t: 'U' }),
    ).toBe(block('  a: 1', '  t: U', '      # deep', '  b: 2'));
  });

  it('with CRLF line endings', () => {
    expect(updateFrontmatter('---\r\na: 1\r\nt: T\r\n    # deep\r\nb: 2\r\n---\r\n', { t: 'U' })).toBe(
      '---\r\na: 1\r\nt: U\r\n    # deep\r\nb: 2\r\n---\r\n',
    );
  });

  it('under a quoted value, and a flow list', () => {
    expect(
      updateFrontmatter(block("t: 'T # not a comment'", '  # deep', 'l: [x]', '  # deep', 'b: 2'), {
        t: 'U # still not',
        l: ['x', 'y'],
      }),
    ).toBe(block("t: 'U # still not'", '  # deep', 'l: [x, y]', '  # deep', 'b: 2'));
  });

  it('guard: an inline comment stays inline', () => {
    expect(updateFrontmatter(block('a: 1', 't: T # inline', 'b: 2'), { t: 'U' })).toBe(
      block('a: 1', 't: U # inline', 'b: 2'),
    );
  });

  it('guard: a comment at the key column under a value opens the next key', () => {
    expect(updateFrontmatter(block('a: 1', 't: T', '# about b', 'b: 2'), { t: 'U' })).toBe(
      block('a: 1', 't: U', '# about b', 'b: 2'),
    );
  });
});

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

interface Case {
  readonly original: string;
  readonly expected: string;
  readonly target: string;
}

/**
 * A block of plain keys with comments above (at or left of the key column),
 * below (deeper than it), inline, and blank lines, at a random indent, with LF
 * or CRLF, the closing line with or without its newline. One key's value
 * changes; the expected block is the original with only that value's bytes
 * swapped.
 */
function generated(random: () => number): Case {
  const pick = (n: number) => Math.floor(random() * n);
  const eol = random() < 0.3 ? '\r\n' : '\n';
  const indent = pick(4);
  const pad = ' '.repeat(indent);
  const count = 2 + pick(4);
  const target = pick(count);
  const lines: string[] = [];
  let targetLine = -1;
  for (let at = 0; at < count; at++) {
    for (let n = pick(3); n > 0; n--) lines.push(`${' '.repeat(pick(indent + 1))}# above k${at}`);
    const below = pick(3);
    // An inline comment and comments below it is out of #395's scope.
    const inline = below === 0 && random() < 0.4 ? ' # inline' : '';
    if (at === target) targetLine = lines.length;
    lines.push(`${pad}k${at}: v${at}${inline}`);
    for (let n = below; n > 0; n--) {
      if (random() < 0.2) lines.push('');
      lines.push(`${' '.repeat(indent + 1 + pick(5))}# below k${at}`);
    }
    if (random() < 0.3) lines.push('');
  }
  if (random() < 0.3) lines.push('# trailing');
  const closing = random() < 0.3 ? '---' : `---${eol}`;
  const write = (body: string[]) => `---${eol}${body.join(eol)}${eol}${closing}`;
  const changed = [...lines];
  changed[targetLine] = changed[targetLine]!.replace(`k${target}: v${target}`, `k${target}: w`);
  return { original: write(lines), expected: write(changed), target: `k${target}` };
}

describe('#395 property: a changed value changes that value bytes only', () => {
  const random = seeded(395);
  const cases = Array.from({ length: 300 }, () => generated(random));
  it.each(cases.map((one, at) => [at, one] as const))('case %i', (_, { original, expected, target }) => {
    const written = updateFrontmatter(original, { [target]: 'w' });
    expect(written).toBe(expected);
    expect(parseFrontmatterProperties(written)).toMatchObject({ [target]: 'w' });
  });
});
