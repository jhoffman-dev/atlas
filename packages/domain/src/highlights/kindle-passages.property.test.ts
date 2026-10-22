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

const WORDS = ['Emma Woodhouse, handsome, clever, and rich', 'Emma Woodhouse, handsome'];

/** Any Kindle highlight: a location or none, a page or none, whatever the location. */
function kindleHighlight(annotationId: string | null): NewHighlight {
  const location = pick(LOCATIONS);
  const page = location === null ? pick([12, 13]) : pick([undefined, 12, 13]);
  return {
    quote: pick(WORDS),
    anchor: { kind: 'kindle', location, ...(page !== undefined && { page }), annotationId },
  };
}

/** Highlights any sync might be handed, an annotation id even given twice. */
const batch = (max: number) =>
  Array.from({ length: 1 + Math.floor(random() * max) }, () =>
    kindleHighlight(pick([null, null, 'A1', 'C1'])),
  );

/** The page each location is on, in the one book. */
const PAGE_OF = new Map([
  [100, 12],
  [140, 13],
]);

/**
 * One export's highlights as Kindle gives them: all with locations, with or
 * without their pages, or all with pages alone; an annotation id to one
 * highlight at most.
 */
function oneExport(max: number): NewHighlight[] {
  const shape = pick(['located', 'paged', 'page alone'] as const);
  const ids = ['A1', 'C1', 'D1'];
  return Array.from({ length: 1 + Math.floor(random() * max) }, (): NewHighlight => {
    const location = shape === 'page alone' ? null : pick(LOCATIONS.slice(1));
    const page = location === null ? pick([12, 13]) : PAGE_OF.get(location.start);
    const annotationId =
      random() < 0.5 ? null : (ids.splice(Math.floor(random() * ids.length), 1)[0] ?? null);
    return {
      quote: pick(WORDS),
      anchor: {
        kind: 'kindle',
        location,
        ...(shape !== 'located' && page !== undefined && { page }),
        annotationId,
      },
    };
  });
}

const sync = (text: string, highlights: readonly NewHighlight[]) =>
  appendHighlights({ text, highlights, random, noteBlocks }).text;

/** The note's highlights without their ids, which are drawn in the order written: what a sync leaves. */
const passages = (text: string): string[] =>
  readHighlights(text, noteBlocks)
    .map(({ quote, comment, style, anchor }) => JSON.stringify({ quote, comment, style, anchor }))
    .sort();

/** Some of `items`: an export synced again with highlights since deleted. */
const part = <T>(items: readonly T[]): T[] => items.filter(() => random() < 0.5);

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, at) =>
    permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
  );
}

describe('Kindle passages matched by place, in any order (ADR-0043 §7)', () => {
  it(
    'gives the same note for every order of one batch, and adds none of it again',
    () => {
      for (let run = 0; run < RUNS; run += 1) {
        const held = random() < 0.5 ? SOURCE : sync(SOURCE, batch(3));
        const exported = batch(4);
        const once = sync(held, exported);
        expect(sync(once, exported)).toBe(once);
        expect(sync(once, part(exported))).toBe(once);
        const expected = passages(once);
        for (const order of permutations(exported)) {
          expect(passages(sync(held, order))).toEqual(expected);
        }
      }
    },
    TIMEOUT,
  );

  it(
    'gives as many passages for an export synced as it grew as synced at once, and a sync run again adds none',
    () => {
      for (let run = 0; run < RUNS; run += 1) {
        const exported = oneExport(4);
        const atOnce = sync(SOURCE, exported);
        let grown = SOURCE;
        for (let size = 1; size <= exported.length; size += 1) {
          grown = sync(grown, exported.slice(0, size));
        }
        expect(readHighlights(grown, noteBlocks)).toHaveLength(
          readHighlights(atOnce, noteBlocks).length,
        );
        expect(sync(atOnce, exported)).toBe(atOnce);
        expect(sync(atOnce, part(exported))).toBe(atOnce);
        expect(sync(grown, exported)).toBe(grown);
      }
    },
    TIMEOUT,
  );

  it(
    'adds nothing when any export, or any part of it, is synced again into a note grown from mixed ones',
    () => {
      for (let run = 0; run < RUNS; run += 1) {
        const exported = batch(4);
        let grown = sync(SOURCE, batch(3));
        for (let size = 1; size <= exported.length; size += 1) {
          grown = sync(grown, exported.slice(0, size));
        }
        expect(sync(grown, exported)).toBe(grown);
        expect(sync(grown, part(exported))).toBe(grown);
      }
    },
    TIMEOUT,
  );
});
