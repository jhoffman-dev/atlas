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
    expect(updateFrontmatter(block('  a: 1', '  t: T', '      # deep', '  b: 2'), { t: 'U' })).toBe(
      block('  a: 1', '  t: U', '      # deep', '  b: 2'),
    );
  });

  it('with CRLF line endings', () => {
    expect(
      updateFrontmatter('---\r\na: 1\r\nt: T\r\n    # deep\r\nb: 2\r\n---\r\n', { t: 'U' }),
    ).toBe('---\r\na: 1\r\nt: U\r\n    # deep\r\nb: 2\r\n---\r\n');
  });

  it('under a quoted value, and a flow list', () => {
    expect(
      updateFrontmatter(block("t: 'T # not a comment'", '  # deep', 'l: [x]', '  # deep', 'b: 2'), {
        t: 'U # still not',
        l: ['x', 'y'],
      }),
    ).toBe(block("t: 'U # still not'", '  # deep', 'l: [x, y]', '  # deep', 'b: 2'));
  });

  it('under an empty value given one', () => {
    expect(updateFrontmatter(block('a: 1', 't:', '  # deep', 'b: 2'), { t: 'U' })).toBe(
      block('a: 1', 't: U', '  # deep', 'b: 2'),
    );
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

/** How a key's value is written: its lines after `key: `, the later ones at `deeper`. */
const FORMS = {
  plain: (v: string) => [v],
  quotedHash: (v: string) => [`'${v} # not a comment'`],
  twoLinePlain: (v: string, deeper: string) => [`${v} one`, `${deeper}${v} two`],
  twoLineQuoted: (v: string, deeper: string) => [`"${v} one`, `${deeper}${v} two"`],
  flowList: (v: string) => [`[${v}, x]`],
  block: (v: string, deeper: string) => ['|', `${deeper}${v} one`, `${deeper}${v} two`],
  blockList: (v: string, deeper: string) => ['', `${deeper}- ${v}a`, `${deeper}- ${v}b`],
  blockMap: (v: string, deeper: string) => ['', `${deeper}m: ${v}`, `${deeper}n: [${v}]`],
} satisfies Record<string, (v: string, deeper: string) => string[]>;
type Form = keyof typeof FORMS;

/** The values a key is changed to: one-line, holding `#`, a list, two lines, and a map. */
const NEW_VALUES: readonly unknown[] = [
  'w',
  'w # hash',
  ['w', 'x'],
  'w one\nw two',
  { m: 'w', n: ['x'] },
];

/** A key's first line: `key: value`, or `key:` alone when the value starts below it. */
const keyLine = (pad: string, key: string, first: string) =>
  `${pad}${key}:${first === '' ? '' : ` ${first}`}`;

interface Case {
  readonly original: string;
  readonly expected: string;
  readonly target: string;
  readonly value: unknown;
  /** The target's form, and what it is changed to, for the test's name. */
  readonly change: string;
}

/** Whether `value`, written in the place of a value of `form`, is a block scalar, list or map. */
function writtenInBlocks(form: Form, value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\n');
  return form !== 'flowList' || !Array.isArray(value);
}

/**
 * The target key alone, changed to `value`, as the writer writes it with no
 * comments or other keys about: what its lines must read in any block.
 */
function writtenAlone(pad: string, lines: readonly string[], target: string, value: unknown) {
  const block = `---\n${[keyLine(pad, target, lines[0] ?? ''), ...lines.slice(1)].join('\n')}\n---\n`;
  return updateFrontmatter(block, { [target]: value })
    .slice(4, -5)
    .split('\n');
}

/**
 * A block of keys written in every form, with comments above (at or left of
 * the key column), below (deeper than it), inline, and blank lines, at a
 * random indent, with LF or CRLF, the closing line with or without its
 * newline. One key's value changes, to one of {@link NEW_VALUES}; the expected
 * block is the original with only that key's lines swapped for the key as
 * written alone.
 */
function generated(random: () => number): Case {
  const pick = (n: number) => Math.floor(random() * n);
  const forms = Object.keys(FORMS) as Form[];
  const eol = random() < 0.3 ? '\r\n' : '\n';
  const indent = pick(4);
  const pad = ' '.repeat(indent);
  const deeper = ' '.repeat(indent + 2);
  const count = 2 + pick(4);
  const target = pick(count);
  const value = NEW_VALUES[pick(NEW_VALUES.length)];
  const lines: string[] = [];
  let targetLines: readonly string[] = [];
  let targetForm: Form = 'plain';
  let targetBelow = 0;
  let targetAt = -1;
  for (let at = 0; at < count; at++) {
    for (let n = pick(3); n > 0; n--) lines.push(`${' '.repeat(pick(indent + 1))}# above k${at}`);
    const form = forms[pick(forms.length)]!;
    const block = form === 'block';
    const ownLine = !block && form !== 'blockList' && form !== 'blockMap';
    // An inline comment on a value given in blocks has no line left to stand
    // on: the library places it, and the lines below it go with it.
    const inline = !block && random() < 0.4 ? ' # inline' : '';
    const placed = at === target && ownLine && inline !== '' && writtenInBlocks(form, value);
    const below = placed ? 0 : pick(3);
    const valueLines = FORMS[form](`v${at}`, deeper);
    valueLines[valueLines.length - 1] += inline;
    if (at === target) {
      targetAt = lines.length;
      targetLines = valueLines;
      targetForm = form;
      targetBelow = below;
    }
    lines.push(keyLine(pad, `k${at}`, valueLines[0] ?? ''), ...valueLines.slice(1));
    for (let n = below; n > 0; n--) {
      // A blank line, or a line as deep as its text, is a block scalar's own.
      if (!block && random() < 0.2) lines.push('');
      lines.push(`${' '.repeat(indent + 1 + (block ? 0 : pick(5)))}# below k${at}`);
    }
    if (!block && random() < 0.3) lines.push('');
  }
  const trailing = random() < 0.3;
  if (trailing) lines.push('# trailing');
  // Blank lines ending the block are its own (#430) — but a block scalar's
  // own when nothing stands between them and it.
  const lastIsBlock = !trailing && lines.at(-1)?.startsWith(' '.repeat(indent + 2) + 'v');
  if (lines.at(-1) !== '' && !lastIsBlock && random() < 0.2) lines.push('');
  const closing = random() < 0.3 ? '---' : `---${eol}`;
  const write = (body: string[]) => `---${eol}${body.join(eol)}${eol}${closing}`;
  const changed = [...lines];
  changed.splice(
    targetAt,
    targetLines.length,
    ...writtenAlone(pad, targetLines, `k${target}`, value),
  );
  const change = `${targetForm}, ${targetBelow} below, to ${JSON.stringify(value)}`;
  return { original: write(lines), expected: write(changed), target: `k${target}`, value, change };
}

describe('#395 property: a changed value changes that value bytes only', () => {
  const random = seeded(395);
  const cases = Array.from({ length: 1000 }, () => generated(random));
  it.each(cases.map((one, at) => [at, one.change, one] as const))(
    'case %i: %s',
    (_, __, { original, expected, target, value }) => {
      const written = updateFrontmatter(original, { [target]: value });
      expect(written).toBe(expected);
      expect(parseFrontmatterProperties(written)).toMatchObject({ [target]: value });
    },
  );
});
