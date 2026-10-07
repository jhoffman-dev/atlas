import { describe, expect, it } from 'vitest';
import { donutArcs, linePath } from './geometry.ts';

/**
 * Adversarial: inputs that are each finite and positive, but that break the
 * arithmetic the geometry does on them as a whole.
 */

describe('donutArcs, when the finite values sum past what a number holds', () => {
  it('still gives two equal values half the turn each', () => {
    const arcs = donutArcs({
      values: [Number.MAX_VALUE, Number.MAX_VALUE],
      radius: 10,
      thickness: 2,
    });

    // `total` overflows to Infinity, so every fraction is value / Infinity = 0
    // and d3's pie gives every slice zero sweep: nothing is drawn at all.
    expect(arcs.map((slice) => slice.fraction)).toEqual([0.5, 0.5]);
    expect(arcs.every((slice) => slice.path !== '')).toBe(true);
  });
});

describe('linePath, over a long series', () => {
  it('comes back rather than overflowing the stack', () => {
    // `Math.max(...values)` passes every value as an argument; V8 runs out of
    // stack somewhere past a hundred thousand of them.
    const values = Array.from({ length: 200_000 }, (_unused, index) => index % 7);

    expect(() => linePath({ values, width: 320, height: 120 })).not.toThrow();
  });
});
