import { describe, expect, it } from 'vitest';
import { stackedSegments } from './geometry.ts';

/**
 * Attack on PR #336: `stackedSegments` promises that "the segments add up to
 * `width` exactly", that a value that is nothing takes no room and keeps its
 * place, and that every segment starts where the one before it ended.
 */

/** mulberry32: a seeded RNG, so a failing case replays exactly. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counts as a dashboard has them: whole numbers, often zero, sometimes large. */
function countsFrom(random: () => number): number[] {
  const length = 1 + Math.floor(random() * 12);
  return Array.from({ length }, () => {
    const roll = random();
    if (roll < 0.25) return 0;
    if (roll < 0.9) return Math.floor(random() * 40);
    return Math.floor(random() * 1_000_000);
  });
}

const widthFrom = (random: () => number) =>
  random() < 0.5 ? 100 : Math.round(random() * 100_000) / 100;

const ends = (values: number[], width: number) => {
  const segments = stackedSegments({ values, width });
  const last = segments.at(-1);
  return { segments, end: last === undefined ? 0 : last.start + last.size };
};

describe('stackedSegments, attacked (seeded)', () => {
  const SEEDS = Array.from({ length: 400 }, (_, at) => 336_000 + at);

  it('no segment is ever negative, for any counts and any width ≥ 0', () => {
    for (const seed of SEEDS) {
      const random = seeded(seed);
      const { segments } = ends(countsFrom(random), widthFrom(random));
      for (const segment of segments) {
        expect(segment.size, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(segment.start, `seed ${seed}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('every segment starts where the one before it ended, in the order given', () => {
    for (const seed of SEEDS) {
      const random = seeded(seed);
      const values = countsFrom(random);
      const { segments } = ends(values, widthFrom(random));
      expect(segments).toHaveLength(values.length);
      let start = 0;
      for (const segment of segments) {
        expect(segment.start, `seed ${seed}`).toBe(start);
        start = segment.start + segment.size;
      }
    }
  });

  it('a zero keeps its place and takes no room', () => {
    for (const seed of SEEDS) {
      const random = seeded(seed);
      const values = countsFrom(random);
      const { segments } = ends(values, widthFrom(random));
      values.forEach((value, at) => {
        if (value === 0) expect(segments[at]?.size, `seed ${seed}`).toBe(0);
        else expect(segments[at]?.size, `seed ${seed}`).toBeGreaterThan(0);
      });
    }
  });

  it('the segments add up to the width exactly, as documented (no rounding drift)', () => {
    const drifted: string[] = [];
    for (const seed of SEEDS) {
      const random = seeded(seed);
      const values = countsFrom(random);
      const width = widthFrom(random);
      if (!values.some((value) => value > 0)) continue;
      const { end } = ends(values, width);
      if (end !== width)
        drifted.push(`seed ${seed}: ${JSON.stringify(values)} → ${end} ≠ ${width}`);
    }
    expect(drifted.slice(0, 3)).toEqual([]);
  });

  it('three equal values over 100 end at 100, not 99.99999999999999', () => {
    expect(ends([1, 1, 1], 100).end).toBe(100);
  });

  it('every value zero gives every segment zero, and none is NaN', () => {
    const { segments } = ends([0, 0, 0], 100);
    expect(segments).toEqual([
      { start: 0, size: 0 },
      { start: 0, size: 0 },
      { start: 0, size: 0 },
    ]);
  });

  it('a single value takes the whole width', () => {
    expect(stackedSegments({ values: [7], width: 100 })).toEqual([{ start: 0, size: 100 }]);
  });

  it('no values give no segments', () => {
    expect(stackedSegments({ values: [], width: 100 })).toEqual([]);
  });

  it('a width of 0 gives zero-size segments that still chain', () => {
    const { segments } = ends([3, 4, 5], 0);
    for (const segment of segments) expect(segment).toEqual({ start: 0, size: 0 });
  });

  it('a fractional width is divided in proportion', () => {
    const { segments, end } = ends([1, 3], 0.4);
    expect(segments[0]?.size).toBeCloseTo(0.1, 12);
    expect(segments[1]?.size).toBeCloseTo(0.3, 12);
    expect(end).toBeCloseTo(0.4, 12);
  });

  it('many tiny values still fill the width', () => {
    const { end, segments } = ends(
      Array.from({ length: 1000 }, () => 1e-9),
      100,
    );
    expect(segments.every((segment) => segment.size > 0)).toBe(true);
    expect(end).toBeCloseTo(100, 9);
  });

  it('huge values whose sum overflows to Infinity still fill the width', () => {
    // Each value is finite and positive, so each is "something"; the whole
    // overflows, every share becomes 0 and the bar draws nothing at all.
    const { segments, end } = ends([Number.MAX_VALUE, Number.MAX_VALUE], 100);
    expect(segments.map((segment) => segment.size)).toEqual([50, 50]);
    expect(end).toBe(100);
  });

  it('NaN, Infinity and negative values take no room and keep their place', () => {
    const { segments } = ends([Number.NaN, 2, Number.POSITIVE_INFINITY, -4, 2, -0], 100);
    expect(segments.map((segment) => segment.size)).toEqual([0, 50, 0, 0, 50, 0]);
  });

  it('a negative width does not produce negative segments', () => {
    const { segments } = ends([1, 1], -10);
    for (const segment of segments) expect(segment.size).toBeGreaterThanOrEqual(0);
  });
});
