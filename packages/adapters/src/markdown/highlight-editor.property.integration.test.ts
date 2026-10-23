import { describe, expect, it } from 'vitest';
import { literatureHighlightReader } from '@dfai/application';
import {
  appendHighlights,
  BLOCK_ANCHOR_ATTR,
  commentLines,
  undoCommentEscapes,
  HIGHLIGHT_COLORS,
  HighlightNotReadBackError,
  readHighlights,
  splitFrontmatter,
  withHighlightComment,
  withoutHighlight,
  type HighlightAnchor,
  type HighlightView,
  type NewHighlight,
} from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';
import { noteBlocks } from './note-blocks.ts';

/**
 * Property (#523): whatever a literature note holds, however it was written
 * and edited by hand, DFAI's editor draws exactly its highlights, as their
 * comments read; saves it unedited byte for byte; and a comment typed in
 * place changes only that comment's bytes, after which the editor reads and
 * saves the note byte for byte again.
 */

/** mulberry32: a seeded random source, so every run draws the same notes. */
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

// HIGHLIGHT_EDITOR_SEED and HIGHLIGHT_EDITOR_RUNS run other notes, and more, by hand.
const random = seeded(Number(process.env['HIGHLIGHT_EDITOR_SEED'] ?? 20261023));
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const count = (max: number) => Math.floor(random() * (max + 1));
const RUNS = Number(process.env['HIGHLIGHT_EDITOR_RUNS'] ?? 200);
const TIMEOUT = Math.max(60_000, RUNS * 40);

const WORDS = [
  'warfare',
  '*bold*',
  '#tag',
  '==mark==',
  '%%',
  '%%hide%%',
  '50%%',
  '[[Larkspur Payroll]]',
  '![[Field notes]]',
  '<b>',
  '-->',
  '`code %%`',
  '^abc123',
  '\\',
  'é',
  '1.',
  '-',
  '> nested',
];

const words = (max: number) =>
  Array.from({ length: 1 + count(max) }, () => pick(WORDS)).join(pick([' ', '\n', '\n\n']));

const ANCHORS: (() => HighlightAnchor)[] = [
  () => ({
    kind: 'pdf',
    page: 1 + count(300),
    quote: { exact: `passage ${count(1e6)}`, prefix: '', suffix: '' },
    rects: [{ x: 0.1, y: random() * 0.5, width: 0.4, height: 0.02 }],
  }),
  () => ({
    kind: 'epub',
    cfi: `epubcfi(/6/${2 * (1 + count(40))}!/4/2/1:${count(300)})`,
    quote: { exact: `passage ${count(1e6)}`, prefix: '', suffix: '' },
  }),
  () => ({
    kind: 'kindle',
    location: { start: 1 + count(9000), end: null },
    annotationId: `AMZ-${count(1e6)}`,
  }),
];

function newHighlight(): NewHighlight {
  const area = random() < 0.2;
  const anchor = area
    ? {
        kind: 'pdf' as const,
        page: 1 + count(9),
        quote: null,
        rects: [{ x: 0, y: 0, width: 1, height: 0.2 }],
      }
    : pick(ANCHORS)();
  return {
    quote: area ? '' : words(8),
    ...(area && { image: `attachments/Generated p${count(9)} area ${count(99)}.png` }),
    anchor,
    style: { mark: pick(['highlight', 'underline'] as const), color: pick(HIGHLIGHT_COLORS) },
    ...(random() < 0.7 && { comment: words(6) }),
  };
}

const FILLER = [
  // Prose never leaves a `%%` open: an append after one is refused (ADR-0043 §5), and nothing is drawn.
  () =>
    `Prose with ${pick(['*bold*', '#tag', '%%aside%%', '[[Larkspur Payroll]]', '^abc123'])} in it.\n`,
  () => '> A plain quote, no marker.\n',
  () => '- a list item ^li0001\n',
  () => '## A heading\n',
  () => '%%\nA hidden aside.\n%%\n',
  () => '| a | b |\n| - | - |\n| 1 | 2 |\n',
];

/** A literature note DFAI wrote, then edited by hand: lazy lines, removals, Windows endings. */
function generatedNote(): string {
  const filler = Array.from({ length: count(3) }, () => pick(FILLER)()).join('\n');
  let text = refusedOr(
    `---\ntype: literature\nkind: pdf\ntitle: "Generated"\n---\n${filler}`,
    (note) =>
      appendHighlights({
        text: note,
        highlights: Array.from({ length: 1 + count(4) }, newHighlight),
        random,
        noteBlocks,
      }).text,
  );
  const blocks = readHighlights(text, noteBlocks);
  // Never down to none: the property is about the highlights a note holds.
  if (blocks.length === 0) return generatedNote();
  const removed = blocks.length > 1 && random() < 0.3 ? pick(blocks) : null;
  if (removed !== null) {
    text = refusedOr(text, (note) => withoutHighlight({ text: note, id: removed.id, noteBlocks }));
  }
  if (random() < 0.4) text = lazyComments(text);
  if (random() < 0.3) text = text.replace(/\n/g, '\r\n');
  return text;
}

/**
 * `write(text)`, or `text` when the write is refused by its own postcondition:
 * a quote whose `%%` would hide the highlights after it (ADR-0043 §5).
 */
function refusedOr(text: string, write: (text: string) => string): string {
  try {
    return write(text);
  } catch (error) {
    if (error instanceof HighlightNotReadBackError) return text;
    throw error;
  }
}

/**
 * Comment lines with their `>` taken off, as Obsidian may leave them: a lazy
 * line, which only a line of words straight after another line of words is.
 */
const lazyComments = (text: string): string =>
  readHighlights(text, noteBlocks)
    .reverse()
    .reduce(
      (note, block) =>
        note.slice(0, block.markerEnd) +
        lazyLines(note.slice(block.markerEnd, block.quoteEnd)) +
        note.slice(block.quoteEnd),
      text,
    );

function lazyLines(comment: string): string {
  const lines = comment.split('\n');
  return lines
    .map((line, at) => {
      const before = lines[at - 1] ?? '>';
      const words = /^> [a-z]/;
      return words.test(line) && words.test(before) ? line.slice(2) : line;
    })
    .join('\n');
}

function savedUnedited(text: string): string {
  const { body } = splitFrontmatter(text);
  const parsed = remarkMarkdown.parseBody(body);
  return (
    text.slice(0, text.length - body.length) +
    remarkMarkdown.serializeBody({ originalBody: body, parsed, doc: parsed.doc })
  );
}

/** Each highlight the editor draws, by id, in the note's order. */
function drawn(text: string): Map<string, HighlightView> {
  const { frontmatter, body } = splitFrontmatter(text);
  const properties = remarkMarkdown.frontmatterProperties(frontmatter);
  const reader = literatureHighlightReader(remarkMarkdown, { properties, text });
  const views = new Map<string, HighlightView>();
  for (const node of remarkMarkdown.parseBody(body).doc.content) {
    const id = node.attrs?.[BLOCK_ANCHOR_ATTR];
    if (node.type !== 'rawBlock' || typeof id !== 'string') continue;
    const view = reader?.({ markdown: String(node.attrs?.['markdown'] ?? ''), id }) ?? null;
    if (view !== null) views.set(id, view);
  }
  return views;
}

function expectDrawnAsRead(text: string) {
  const read = readHighlights(text, noteBlocks);
  const views = drawn(text);
  expect([...views.keys()]).toEqual(read.map((block) => block.id));
  for (const block of read)
    expect(views.get(block.id)?.comment).toBe(undoCommentEscapes(block.comment));
}

describe('generated literature notes in the editor', () => {
  it(
    'are drawn as their highlights and saved unedited byte for byte',
    () => {
      for (let run = 0; run < RUNS; run += 1) {
        const text = generatedNote();
        expect(savedUnedited(text)).toBe(text);
        expectDrawnAsRead(text);
      }
    },
    TIMEOUT,
  );

  it(
    "change only a comment's bytes when it is typed in place",
    () => {
      let edited = 0;
      for (let run = 0; run < RUNS; run += 1) {
        const text = generatedNote();
        const target = pick(readHighlights(text, noteBlocks));
        const comment = random() < 0.15 ? '' : words(6);
        let changed: string;
        try {
          changed = withHighlightComment({ text, id: target.id, comment, noteBlocks });
        } catch (error) {
          // The write's own postcondition: a comment that would hide the rest is refused, unwritten.
          expect(error).toBeInstanceOf(HighlightNotReadBackError);
          continue;
        }
        edited += 1;
        expect(changed.slice(0, target.markerEnd)).toBe(text.slice(0, target.markerEnd));
        expect(changed.endsWith(text.slice(target.quoteEnd))).toBe(true);
        expect(savedUnedited(changed)).toBe(changed);
        expectDrawnAsRead(changed);
        expect(drawn(changed).get(target.id)?.comment).toBe(
          undoCommentEscapes(commentLines(comment).join('\n')),
        );
      }
      // Most runs write: the property is about edits, not refusals.
      expect(edited).toBeGreaterThan(RUNS * 0.8);
    },
    TIMEOUT,
  );
});
