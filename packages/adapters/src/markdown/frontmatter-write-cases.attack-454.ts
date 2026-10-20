/**
 * Attack on PR #454: a broader seeded generator than #395/#430's, and an
 * oracle that needs no expected text. A case is a block of keys in many
 * Obsidian/Atlas forms with comments, blank lines and whitespace-only lines
 * around them, and one or two changes (set, empty, remove, add).
 */
import { isDeepStrictEqual } from 'node:util';
import { parseFrontmatterProperties } from './frontmatter.ts';

/** mulberry32, as in the #395 test, so a failing case can be replayed. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Line {
  readonly text: string;
  /** The key this line is the key line or value of; null for comments, blanks around keys. */
  readonly ownedBy: string | null;
  /** The key this comment is above or below, so its removal may take it. */
  readonly near: string | null;
}

export interface Case {
  readonly original: string;
  readonly changes: Record<string, unknown>;
  /** Lines that no change reaches, in order: they must all be in the output, in order. */
  readonly fixed: readonly string[];
  readonly expected: Record<string, unknown>;
  readonly name: string;
}

type Form = (v: string, pad: string, d: string, pick: (n: number) => number) => string[];

/** Each form: the text after `key:` on its first line, then its lines below. */
const FORMS: Record<string, Form> = {
  plain: (v) => [` ${v}`],
  quoted: (v) => [` "${v} # q"`],
  unicode: () => [' 日本語 🎉 é'],
  flowList: (v) => [` [${v}, "[[Link]]"]`],
  flowMap: (v) => [` {a: ${v}, b: [x]}`],
  emptyFlow: () => [' []'],
  empty: () => [''],
  blockList: (v, _p, d) => ['', `${d}- ${v}a`, `${d}- ${v}b`],
  sameColList: (v, p) => ['', `${p}- ${v}a`, `${p}- ${v}b`],
  listWithComments: (v, _p, d, pick) => [
    '',
    `${d}- ${v}a`,
    `${' '.repeat(pick(2) === 0 ? 0 : d.length)}# between ${v}`,
    `${d}- ${v}b # own`,
  ],
  blockMap: (v, _p, d) => ['', `${d}home: "[[${v}]]"`, `${d}list:`, `${d}  - ${v}`],
  seqOfMaps: (v, _p, d) => ['', `${d}- k: ${v}`, `${d}  j: [1]`],
  literal: (v, _p, d) => [' |', `${d}${v} one`, '', `${d}${v} two`],
  strip: (v, _p, d) => [' |-', `${d}${v} one`],
  keep: (v, _p, d) => [' |+', `${d}${v} one`, ''],
  folded: (v, _p, d) => [' >', `${d}${v} one`, `${d}${v} two`],
  dashes: (_v, _p, d) => [' |', `${d}a`, `${d}---`, `${d}b`],
};
const SCALARS = new Set(['literal', 'strip', 'keep', 'folded', 'dashes']);

const NEW_VALUES: readonly unknown[] = [
  'w',
  'w # hash',
  '',
  42,
  true,
  'ü 日本',
  'line one\nline two',
  'ends with newline\n',
  ['w'],
  ['w', 'x', 'y'],
  [],
  { m: 'w' },
  { m: 'w', n: ['x', 'y'] },
  {},
  [{ k: 'v' }],
  null,
  undefined,
];

export function generated(random: () => number): Case {
  const pick = (n: number) => Math.floor(random() * n);
  const forms = Object.keys(FORMS);
  const eol = random() < 0.25 ? '\r\n' : '\n';
  const indent = pick(3);
  const pad = ' '.repeat(indent);
  const deeper = ' '.repeat(indent + 2);
  const count = 2 + pick(4);
  const lines: Line[] = [];
  const formOf: string[] = [];
  for (let at = 0; at < count; at++) {
    const key = `k${at}`;
    for (let n = pick(2); n > 0; n--)
      lines.push({
        text: `${' '.repeat(pick(indent + 1))}# above ${key}`,
        ownedBy: null,
        near: key,
      });
    const form = forms[pick(forms.length)]!;
    formOf.push(form);
    const [first, ...rest] = FORMS[form]!(`v${at}`, pad, deeper, pick);
    const inline = !SCALARS.has(form) && first !== '' && random() < 0.3 ? ' # inline' : '';
    lines.push({ text: `${pad}${key}:${first}${inline}`, ownedBy: key, near: key });
    for (const text of rest) lines.push({ text, ownedBy: key, near: key });
    if (SCALARS.has(form) && random() < 0.15) {
      // A whitespace-only line ending a block scalar, as an editor leaves one.
      lines.push({ text: ' '.repeat(pick(indent + 6)), ownedBy: key, near: key });
    }
    for (let n = pick(3); n > 0; n--) {
      if (random() < 0.25) lines.push({ text: '', ownedBy: null, near: null });
      else {
        // Under a block scalar a comment as deep as its text is its text.
        const col = SCALARS.has(form) ? pick(indent + 2) : pick(indent + 5);
        lines.push({ text: `${' '.repeat(col)}# below ${key} ${n}`, ownedBy: null, near: key });
      }
    }
  }
  if (random() < 0.3) lines.push({ text: '# trailing', ownedBy: null, near: null });
  for (let n = pick(3); n > 0; n--) lines.push({ text: '', ownedBy: null, near: null });

  const changes: Record<string, unknown> = {};
  for (let n = 1 + pick(2); n > 0; n--) {
    const key = random() < 0.1 ? 'added' : `k${pick(count)}`;
    changes[key] = NEW_VALUES[pick(NEW_VALUES.length)];
  }
  const closing = random() < 0.25 ? '---' : `---${eol}`;
  const original = `---${eol}${lines.map((l) => l.text).join(eol)}${eol}${closing}`;
  const removed = (key: string | null) =>
    key !== null && key in changes && (changes[key] === null || changes[key] === undefined);
  const fixed = lines
    .filter((l) => (l.ownedBy === null || !(l.ownedBy in changes)) && !removed(l.near))
    .map((l) => l.text);
  const before = parseFrontmatterProperties(original);
  const expected: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) delete expected[key];
    else expected[key] = value;
  }
  const name = Object.entries(changes)
    .map(([k, v]) => `${k}(${formOf[Number(k.slice(1))] ?? 'new'})->${JSON.stringify(v)}`)
    .join(', ');
  return { original, changes, fixed, expected, name };
}

export interface Verdict {
  readonly threw: boolean;
  readonly valuesOk: boolean;
  /** How many of the case's fixed lines are missing from the output, in order. */
  readonly linesLost: number;
  readonly eolOk: boolean;
  /** Blank lines gained or lost against those no change reaches. */
  readonly blankDrift: number;
}

export function judged(
  one: Case,
  write: (f: string, c: Record<string, unknown>) => string,
): Verdict {
  let out: string;
  try {
    out = write(one.original, one.changes);
  } catch {
    return {
      threw: true,
      valuesOk: false,
      linesLost: one.fixed.length,
      eolOk: false,
      blankDrift: 0,
    };
  }
  const crlf = one.original.startsWith('---\r\n');
  const eolOk = crlf ? !/(?<!\r)\n/.test(out) : !out.includes('\r');
  const back = parseFrontmatterProperties(out);
  const valuesOk = isDeepStrictEqual(normal(back), normal(one.expected));
  const outLines = out.replace(/\r\n/g, '\n').split('\n');
  let at = 1;
  let lost = 0;
  for (const line of one.fixed) {
    if (line === '') continue;
    const found = outLines.indexOf(line, at);
    if (found === -1) lost++;
    else at = found + 1;
  }
  const blanksBefore = one.fixed.filter((l) => l === '').length;
  const blanksAfter = outLines.slice(1, -1).filter((l) => l === '').length;
  return {
    threw: false,
    valuesOk,
    linesLost: lost,
    eolOk,
    blankDrift: Math.abs(blanksAfter - blanksBefore),
  };
}

function normal(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}
