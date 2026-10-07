import { describe, expect, it } from 'vitest';
import type { EditorNode } from '@atlas/domain';
import { parseMarkdownBody, RAW_BLOCK, serializeMarkdownBody } from './markdown-blocks.ts';
import { documentOf } from './writer-fuzz.test-support.ts';

/**
 * The writer's promise from the other side (A21-03 adversarial pass): starting
 * from markdown a person wrote — Obsidian-style, CRLF or LF, sometimes with a
 * byte-order mark — typing into one block rewrites that block and nothing
 * else. Every other block keeps its bytes (ADR-0003), and the edited block
 * reads back as the editor had it.
 *
 * `writer-reads-back.property.test.ts` starts from documents the writer made;
 * this one starts from files it did not.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'word',
  '[[Note]]',
  '[[a|b]]',
  '[[x#h]]',
  '![[img.png]]',
  '&amp;',
  '&#124;',
  '&copy;',
  '&nbsp;',
  '👨‍👩‍👧',
  'שלום עולם',
  'مرحبا',
  '<br>',
  '\\|',
  '#tag',
  '@Julie',
  '`code`',
  '*em*',
  '**b**',
  '~~s~~',
  '\\[\\[x]]',
  '[[a\\|b]]',
  'é',
  '1.',
  '-',
  '$x$',
  '[^1]',
  'www.x.com',
  'a@b.co',
  '<',
  '&',
];

type Random = () => number;

const pick = <T>(random: Random, list: readonly T[]): T =>
  list[Math.floor(random() * list.length)]!;

const lineOf = (random: Random): string =>
  Array.from({ length: 1 + Math.floor(random() * 5) }, () => pick(random, WORDS)).join(' ');

/** A cell's text: a bare `|` would end the cell, so it is written `\|` as a person would. */
const cellOf = (random: Random): string => lineOf(random).replace(/(?<!\\)\|/g, '\\|');

function nestedList(random: Random, lineEnding: string): string {
  const markers = ['-', '*', '+', '1.', '1)'];
  const [outer, middle, inner] = [
    pick(random, markers),
    pick(random, markers),
    pick(random, markers),
  ];
  const indent = (width: number) => ' '.repeat(width);
  return [
    `${outer} ${lineOf(random)}`,
    `${indent(outer.length + 1)}${middle} ${lineOf(random)}`,
    `${indent(outer.length + middle.length + 2)}${inner} ${lineOf(random)}`,
    `${outer} ${lineOf(random)}`,
  ].join(lineEnding);
}

function blockOf(random: Random, lineEnding: string): string {
  switch (Math.floor(random() * 8)) {
    case 0:
      return `${'#'.repeat(1 + Math.floor(random() * 6))} ${lineOf(random)}`;
    case 1:
      return nestedList(random, lineEnding);
    case 2:
      return ['| h1 | h2 |', '| --- | --- |', `| ${cellOf(random)} | ${cellOf(random)} |`].join(
        lineEnding,
      );
    case 3:
      return [`> [!note] ${lineOf(random)}`, `> ${lineOf(random)}`].join(lineEnding);
    case 4:
      return [`- [ ] ${lineOf(random)}`, `- [x] ${lineOf(random)}`].join(lineEnding);
    case 5:
      return [`> ${lineOf(random)}`, `> ${lineOf(random)}`].join(lineEnding);
    default:
      return random() < 0.3 ? `${lineOf(random)}${lineEnding}${lineOf(random)}` : lineOf(random);
  }
}

/** A seeded note body, as a person might have written it. */
function noteOf(seed: number): string {
  const random = mulberry32(seed);
  const lineEnding = random() < 0.5 ? '\r\n' : '\n';
  const bom = random() < 0.2 ? '\uFEFF' : '';
  const blocks = Array.from({ length: 2 + Math.floor(random() * 4) }, () =>
    blockOf(random, lineEnding),
  );
  return `${bom}${blocks.join(lineEnding + lineEnding)}${lineEnding}`;
}

/** `node` with `Q ` typed at the start of its first paragraph or heading, or null if it has none. */
function typedInto(node: EditorNode): EditorNode | null {
  if (node.type === 'paragraph' || node.type === 'heading')
    return { ...node, content: [{ type: 'text', text: 'Q ' }, ...(node.content ?? [])] };
  const children = node.content ?? [];
  for (const [index, child] of children.entries()) {
    const typed = typedInto(child);
    if (typed !== null) return { ...node, content: children.with(index, typed) };
  }
  return null;
}

/** What went wrong typing into block `at` of `note`, or nothing. */
function problemsTypingInto(note: string, at: number): string[] {
  const parsed = parseMarkdownBody(note);
  const node = parsed.doc.content[at]!;
  const typed = node.type === RAW_BLOCK ? null : typedInto(node);
  if (typed === null) return [];
  const content = parsed.doc.content.with(at, typed);
  const saved = serializeMarkdownBody({
    originalBody: note,
    parsed,
    doc: { type: 'doc', content },
  });
  const reread = parseMarkdownBody(saved);
  const where = `${JSON.stringify(note)} block ${at} => ${JSON.stringify(saved)}`;

  const before = parsed.blocks.map((block) => block.source);
  const after = reread.blocks.map((block) => block.source);
  if (before.length !== after.length)
    return [`${where}: ${before.length} blocks became ${after.length}`];
  const problems = before.flatMap((source, index) =>
    index !== at && source !== after[index] ? [`${where}: untouched block ${index} changed`] : [],
  );
  if (documentOf([reread.doc.content[at]!]) !== documentOf([typed]))
    problems.push(`${where}: the edited block read back differently`);
  return problems;
}

const SEEDS = 300;

describe('typing into one block of a hand-written note', () => {
  it(`rewrites that block alone, and it reads back as typed, for ${SEEDS} seeded notes`, () => {
    const problems: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const note = noteOf(seed);
      const blocks = parseMarkdownBody(note).doc.content.length;
      for (let at = 0; at < blocks; at += 1)
        problems.push(...problemsTypingInto(note, at).map((problem) => `seed ${seed}: ${problem}`));
    }
    expect(problems.slice(0, 6), `${problems.length} problems`).toEqual([]);
  }, 120_000);
});
