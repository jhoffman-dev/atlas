import { describe, expect, it } from 'vitest';
import { lineNoteBlocks as noteBlocks } from '../testing/line-note-blocks.ts';
import type { KindleAnchor } from './anchor.ts';
import { appendHighlights, type NewHighlight } from './edit-highlights.ts';
import { readHighlights } from './highlight-block.ts';
import { literatureNoteText } from './literature-note.ts';

/**
 * Property (ADR-0043 §7): which Kindle highlights are one passage does not
 * depend on the order an export lists them in, nor on whether it is synced
 * at once or as it grew. The highlights all have the same words, at the few
 * places, pages and annotation ids that make passages look alike.
 */

/** mulberry32: a seeded random source, so every run draws the same highlights. */
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

// HIGHLIGHT_PROPERTY_SEED and HIGHLIGHT_PROPERTY_RUNS run other highlights, and more, by hand.
const random = seeded(Number(process.env['HIGHLIGHT_PROPERTY_SEED'] ?? 20261022));
const RUNS = Number(process.env['HIGHLIGHT_PROPERTY_RUNS'] ?? 300);
const TIMEOUT = Math.max(60_000, RUNS * 25);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

const SOURCE = literatureNoteText({
  kind: 'kindle',
  title: 'Emma',
  author: 'Jane Austen',
  asin: 'B000FC1ICM',
  file: null,
});

const LOCATIONS: KindleAnchor['location'][] = [
  null,
  { start: 100, end: null },
  { start: 100, end: 104 },
  { start: 140, end: null },
];

function kindleHighlight(): NewHighlight {
  const location = pick(LOCATIONS);
  const page = location === null ? pick([12, 13]) : pick([undefined, 12, 13]);
  return {
    quote: pick(['Emma Woodhouse, handsome, clever, and rich', 'Emma Woodhouse, handsome']),
    anchor: {
      kind: 'kindle',
      location,
      ...(page !== undefined && { page }),
      annotationId: pick([null, null, 'A1', 'C1']),
    },
  };
}

const batch = (max: number) =>
  Array.from({ length: 1 + Math.floor(random() * max) }, kindleHighlight);

const sync = (text: string, highlights: readonly NewHighlight[]) =>
  appendHighlights({ text, highlights, random, noteBlocks }).text;

/** The note's highlights without their ids, which are drawn in the order written: what a sync leaves. */
const passages = (text: string): string[] =>
  readHighlights(text, noteBlocks)
    .map(({ quote, comment, style, anchor }) => JSON.stringify({ quote, comment, style, anchor }))
    .sort();

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('Kindle passages matched by place, in any order (ADR-0043 §7)', () => {
  it(
    'gives the same note for every order of one export',
    () => {
      for (let run = 0; run < RUNS; run += 1) {
        const held = random() < 0.5 ? SOURCE : sync(SOURCE, batch(3));
        const exported = batch(4);
        const expected = passages(sync(held, exported));
        for (const order of permutations(exported)) {
          expect(passages(sync(held, order))).toEqual(expected);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'gives as many passages synced as the export grew as synced at once, and a sync run again adds none',
    () => {
      for (let run = 0; run < RUNS; run += 1) {
        const exported = batch(4);
        const atOnce = sync(SOURCE, exported);
        let grown = SOURCE;
        for (let size = 1; size <= exported.length; size += 1) {
          grown = sync(grown, exported.slice(0, size));
        }
        expect(readHighlights(grown, noteBlocks)).toHaveLength(
          readHighlights(atOnce, noteBlocks).length,
        );
        expect(sync(atOnce, exported)).toBe(atOnce);
        expect(sync(grown, exported)).toBe(grown);
      }
    },
    TIMEOUT,
  );
});
