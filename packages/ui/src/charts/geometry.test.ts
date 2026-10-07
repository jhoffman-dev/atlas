import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { areaUnder, donutArcs, linearScale, linePath, niceTicks, ringDash } from './geometry.ts';

const TAU = Math.PI * 2;

describe('donutArcs', () => {
  it('gives each slice its share of the turn, clockwise from twelve', () => {
    const arcs = donutArcs({ values: [3, 1], radius: 50, thickness: 16 });

    expect(arcs.map((arc) => arc.fraction)).toEqual([0.75, 0.25]);
    expect(arcs[0]?.startAngle).toBeCloseTo(-Math.PI / 2);
    expect((arcs[0]?.endAngle ?? 0) - (arcs[0]?.startAngle ?? 0)).toBeCloseTo(TAU * 0.75);
    // The second slice starts where the first one stopped.
    expect(arcs[1]?.startAngle).toBeCloseTo(arcs[0]?.endAngle ?? 0);
  });

  /**
   * The path strings below are written in d3's separator style — commas
   * between every number and no spaces — because `d3-path` is what serializes
   * them now. That is the only thing about these assertions that changed with
   * the swap: same arcs, same radii, same flags, punctuated differently.
   */
  it('draws a wedge as two arcs between the two radii', () => {
    const [arc] = donutArcs({ values: [1, 1], radius: 50, thickness: 20 });

    // Outer radius 50, inner radius 30, and the half turn takes the long arc.
    expect(arc?.path).toMatch(/^M0,-50A50,50,0,1,1,/);
    expect(arc?.path).toContain('A30,30,0,1,0,');
    expect(arc?.path.endsWith('Z')).toBe(true);
  });

  it('takes the short way round for a slice under half the turn', () => {
    const [arc] = donutArcs({ values: [1, 3], radius: 40, thickness: 10 });
    expect(arc?.path).toContain('A40,40,0,0,1,');
  });

  it('closes the ring when one slice is the whole of it', () => {
    const [arc] = donutArcs({ values: [7], radius: 40, thickness: 10 });

    expect(arc?.fraction).toBe(1);
    // The hand-rolled version stopped a whisker short of the full turn, because
    // a circle drawn as one arc starts and ends in the same place and renders
    // as nothing. d3 has no such problem — it draws the ring as two half arcs —
    // so the slice can have the whole turn and the ring still closes. What is
    // asserted here is the closure, which is the part anyone cares about.
    expect((arc?.endAngle ?? 0) - (arc?.startAngle ?? 0)).toBeCloseTo(TAU);
    // Out to the top, round to the bottom, round again to where it started.
    expect(arc?.path).toMatch(/^M0,-40A40,40,0,1,1,0,40A40,40,0,1,1,0,-40/);
    // And the hole, or the ring would be a filled disc.
    expect(arc?.path).toContain('A30,30,0,1,0,');
    expect(arc?.path.endsWith('Z')).toBe(true);
  });

  /**
   * The angles a slice reports are its share of the turn, not its share minus
   * the gap it is drawn with. A first attempt at the d3 swap put the pad on
   * `pie()` instead of `arc()`, which makes each span "share of the remainder
   * plus one pad" — and two equal slices come to exactly half a turn either
   * way, so every test here passed while the contract had quietly moved.
   */
  it('reports the share of the turn, whatever gap it is drawn with', () => {
    const padded = donutArcs({ values: [1, 499], radius: 56, thickness: 22, padAngle: 0.02 });
    const bare = donutArcs({ values: [1, 499], radius: 56, thickness: 22 });

    for (const [at, arc] of padded.entries()) {
      expect(arc.endAngle - arc.startAngle).toBeCloseTo(arc.fraction * TAU, 9);
      expect(arc.startAngle).toBeCloseTo(bare[at]?.startAngle ?? 0, 9);
    }
  });

  it('spaces neighbouring slices without eating into a lone one', () => {
    const [padded] = donutArcs({ values: [1, 1], radius: 50, thickness: 10, padAngle: 0.1 });
    const [alone] = donutArcs({ values: [1], radius: 50, thickness: 10, padAngle: 0.1 });

    // Half a turn, less half the gap at each end, starts below twelve o'clock.
    expect(padded?.path).not.toMatch(/^M0,-50/);
    expect(alone?.path).toMatch(/^M0,-50/);
  });

  it('has nothing to draw when everything is zero', () => {
    expect(donutArcs({ values: [0, 0], radius: 50, thickness: 10 })).toEqual([]);
    expect(donutArcs({ values: [], radius: 50, thickness: 10 })).toEqual([]);
  });

  it('counts a negative or broken value as nothing rather than drawing backwards', () => {
    const arcs = donutArcs({ values: [-4, 2, Number.NaN], radius: 50, thickness: 10 });

    expect(arcs.map((arc) => arc.fraction)).toEqual([0, 1, 0]);
  });

  it('never draws an inner radius through the middle of the ring', () => {
    const [arc] = donutArcs({ values: [1, 1], radius: 20, thickness: 80 });

    // Thickness past the radius leaves no hole at all. The hand-rolled version
    // drew that hole as an arc of radius zero, and the old assertion pinned the
    // string `A0,0` — which tested the serializer rather than the invariant. A
    // zero-radius arc is a degenerate no-op, so d3 closes the wedge at the
    // centre instead: the same shape, without the pointless arc. What matters
    // is that the radius never goes negative and nothing is painted across the
    // middle of the ring.
    expect(arc?.path).toContain('L0,0');
    expect(arc?.path).not.toMatch(/A-/);
    expect(arc?.path.endsWith('Z')).toBe(true);
  });
});

describe('linearScale', () => {
  it('maps the domain onto the range', () => {
    const scale = linearScale({ domain: [0, 10], range: [100, 0] });

    expect(scale(0)).toBe(100);
    expect(scale(10)).toBe(0);
    expect(scale(5)).toBe(50);
  });

  it('extends past the domain rather than clamping', () => {
    const scale = linearScale({ domain: [0, 10], range: [0, 100] });
    expect(scale(15)).toBe(150);
  });

  it('puts everything at the start when the domain has no width', () => {
    const scale = linearScale({ domain: [4, 4], range: [0, 100] });
    expect(scale(4)).toBe(0);
    expect(scale(9)).toBe(0);
  });
});

describe('linePath', () => {
  it('spaces the points evenly and hangs the largest from the top', () => {
    const { path, points } = linePath({ values: [0, 5, 10], width: 200, height: 100 });

    expect(points).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 50 },
      { x: 200, y: 0 },
    ]);
    expect(path).toBe('M0,100L100,50L200,0');
  });

  it('keeps the padding clear on every side', () => {
    const { points } = linePath({ values: [0, 10], width: 200, height: 100, padding: 10 });

    expect(points).toEqual([
      { x: 10, y: 90 },
      { x: 190, y: 10 },
    ]);
  });

  it('puts a single point in the middle, since it has no span to cross', () => {
    const { points, path } = linePath({ values: [3], width: 200, height: 100 });

    expect(points).toEqual([{ x: 100, y: 0 }]);
    // d3 closes a one-point line. Harmless: the line is `fill: none`, a
    // zero-length closed subpath has nothing to paint, and the component
    // already draws a `<circle>` on that very pixel.
    expect(path).toBe('M100,0Z');
  });

  it('rests a flat series of zeroes on the baseline', () => {
    const { points } = linePath({ values: [0, 0], width: 100, height: 40 });
    expect(points.map((point) => point.y)).toEqual([40, 40]);
  });

  it('has no line without values', () => {
    expect(linePath({ values: [], width: 100, height: 40 })).toEqual({ path: '', points: [] });
  });

  it('treats a broken value as zero rather than losing the whole line', () => {
    const { points } = linePath({ values: [Number.NaN, 4], width: 100, height: 40 });

    expect(points[0]?.y).toBe(40);
    expect(points[1]?.y).toBe(0);
  });
});

describe('niceTicks', () => {
  it('steps in ones, twos or fives so the reader can add them up', () => {
    expect(niceTicks({ max: 7, count: 4 })).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks({ max: 3, count: 4 })).toEqual([0, 1, 2, 3]);
    expect(niceTicks({ max: 42, count: 4 })).toEqual([0, 10, 20, 30, 40, 50]);
  });

  it('always covers the largest value', () => {
    for (const max of [1, 9, 17, 99, 1001]) {
      const ticks = niceTicks({ max });
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
      expect(ticks[0]).toBe(0);
    }
  });

  it('falls back to a nominal scale when there is nothing to scale', () => {
    expect(niceTicks({ max: 0 })).toEqual([0, 1]);
    expect(niceTicks({ max: Number.NaN })).toEqual([0, 1]);
  });
});

describe('linePath with a given top', () => {
  it('scales to the top it is given rather than to its largest value', () => {
    const { points } = linePath({ values: [5], width: 100, height: 100, max: 10 });
    // Half of ten sits half way up a hundred-tall box.
    expect(points[0]?.y).toBeCloseTo(50);
  });

  it('puts a value equal to the top at the ceiling', () => {
    const { points } = linePath({ values: [10], width: 100, height: 100, max: 10 });
    expect(points[0]?.y).toBeCloseTo(0);
  });

  it('falls back to the largest value when the top makes no sense', () => {
    const withZero = linePath({ values: [4], width: 100, height: 100, max: 0 });
    const without = linePath({ values: [4], width: 100, height: 100 });
    expect(withZero.points[0]?.y).toBeCloseTo(without.points[0]?.y ?? -1);
  });
});

/**
 * Adversarial pass. A `d` that is wrong renders silently — the wrong shape, or
 * nothing at all — so each of these reads the painted shape back out of the
 * string rather than trusting the angles beside it.
 */

/**
 * The turn between a wedge's two outer-arc endpoints, clockwise from the first,
 * read back out of its `d`.
 *
 * Bigger than the slice's own angle means the two ends have crossed: the wedge
 * is then painted mirrored about its start edge, over the neighbour it was
 * meant to be spaced away from, rather than inside its own share of the ring.
 */
const paintedSweep = (path: string): number => {
  if (path === '') return 0;
  const drawn = /^M(-?[\d.]+),(-?[\d.]+)A[\d.]+,[\d.]+,0,\d,1,(-?[\d.]+),(-?[\d.]+)/.exec(path);
  if (drawn === null) throw new Error(`not a wedge: ${path}`);
  const [, startX, startY, endX, endY] = drawn as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const from = Math.atan2(Number(startY), Number(startX));
  const to = Math.atan2(Number(endY), Number(endX));
  // The sweep flag is 1, so the paint runs clockwise from the first point.
  return (to - from + TAU) % TAU;
};

describe('donutArcs, where the gap is as wide as the slice', () => {
  it('keeps a slice inside its own share of the turn', () => {
    // The dashboard's own donut: one note in five hundred, and its gap.
    const arcs = donutArcs({ values: [1, 499], radius: 56, thickness: 22, padAngle: 0.02 });

    for (const arc of arcs) {
      expect(paintedSweep(arc.path)).toBeLessThanOrEqual(arc.endAngle - arc.startAngle + 1e-9);
    }
  });

  it('paints nothing at all for a count of zero', () => {
    const [nothing] = donutArcs({ values: [0, 5, 5], radius: 50, thickness: 10, padAngle: 0.1 });

    expect(nothing?.fraction).toBe(0);
    expect(paintedSweep(nothing?.path ?? '')).toBeLessThan(1e-9);
  });
});

describe('niceTicks, below one', () => {
  it.each([0.0001, 0.001, 0.0025])('gives %j a scale of distinct steps', (max) => {
    const ticks = niceTicks({ max });

    expect(new Set(ticks).size).toBe(ticks.length);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
  });
});

describe('niceTicks, given a max too small for a step of its own', () => {
  /**
   * Out of process on purpose: the step underflows to zero, the loop never
   * advances, and calling this in the suite would hang it rather than fail it.
   * The child is given a small heap so it dies quickly instead of taking the
   * machine with it.
   *
   * `--experimental-strip-types` is what lets the child import a `.ts` file at
   * all. Node has stripped types without asking since 23; Node 22, which is
   * what CI runs, needs to be told. Without it this test failed on CI while
   * passing on every developer machine — a difference in Node version, not in
   * the code.
   */
  it('comes back at all', () => {
    const geometry = new URL('./geometry.ts', import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=64',
        '--experimental-strip-types',
        '--input-type=module',
        '--eval',
        `import { niceTicks } from ${JSON.stringify(geometry)};` +
          ` process.stdout.write(String(niceTicks({ max: Number.MIN_VALUE }).length));`,
      ],
      { encoding: 'utf8', timeout: 20_000 },
    );

    // A child that could not start also exits non-zero, and would make this
    // test pass for the wrong reason if we only checked that it did not hang.
    // The count on stdout is what proves the function actually returned.
    //
    // stderr is deliberately not asserted: Node 22 prints an experimental
    // warning for the flag above, so requiring it to be empty would fail on CI
    // and pass here — which is the exact shape of the bug being fixed.
    expect(child.status).toBe(0);
    expect(Number(child.stdout)).toBeGreaterThan(0);
  });
});

describe('linePath, smoothed', () => {
  it('passes through the same points as the straight line', () => {
    const straight = linePath({ values: [1, 5, 2], width: 200, height: 100 });
    const smooth = linePath({ values: [1, 5, 2], width: 200, height: 100, smooth: true });
    expect(smooth.points).toEqual(straight.points);
  });

  it('curves between them instead of drawing straight segments', () => {
    const straight = linePath({ values: [1, 5, 2], width: 200, height: 100 });
    const smooth = linePath({ values: [1, 5, 2], width: 200, height: 100, smooth: true });
    expect(straight.path).not.toContain('C');
    expect(smooth.path).toContain('C');
  });

  it('never bends above its highest point', () => {
    const { path } = linePath({ values: [0, 10, 10, 0], width: 300, height: 100, smooth: true });
    // Every y in the path, control points included, stays inside the box: the
    // monotone curve does not overshoot the flat top at y = 0.
    const ys = [...path.matchAll(/,(-?[\d.]+)/g)].map((match) => Number(match[1]));
    expect(ys.length).toBeGreaterThan(4);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });
});

describe('areaUnder', () => {
  it('closes the line down to the baseline', () => {
    const { points } = linePath({ values: [2, 4], width: 100, height: 50, smooth: true });
    const fill = areaUnder({ points, baseline: 50 });
    expect(fill.startsWith('M0,25')).toBe(true);
    expect(fill).toContain('L100,50');
    expect(fill.endsWith('Z')).toBe(true);
  });

  it('has nothing to fill without points', () => {
    expect(areaUnder({ points: [], baseline: 10 })).toBe('');
  });
});

describe('ringDash', () => {
  const circumference = 2 * Math.PI * 26;

  it('paints the fraction of the circumference and leaves the rest bare', () => {
    const [painted, whole] = ringDash({ radius: 26, fraction: 0.25 }).split(' ').map(Number);
    expect(painted).toBeCloseTo(circumference / 4, 2);
    expect(whole).toBeCloseTo(circumference, 2);
  });

  it('holds a fraction outside 0 to 1 to the nearest end', () => {
    expect(ringDash({ radius: 26, fraction: 1.4 })).toBe(ringDash({ radius: 26, fraction: 1 }));
    expect(ringDash({ radius: 26, fraction: -1 }).startsWith('0 ')).toBe(true);
    expect(ringDash({ radius: 26, fraction: Number.NaN }).startsWith('0 ')).toBe(true);
  });
});
