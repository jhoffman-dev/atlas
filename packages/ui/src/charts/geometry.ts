/**
 * The arc and line maths, kept out of the components that draw it.
 *
 * Every angle, point and path string a chart needs is computed here, by pure
 * functions with no React and no DOM. The components take the results and add
 * attributes to them.
 *
 * The geometry is `d3-shape` and `d3-scale` (ADR-0015). Atlas still renders its
 * own SVG, so the flat-fill look stays ours, and only the generators these four
 * functions are built on are imported rather than a charting library:
 *
 *     donutArcs    →  d3.pie() + d3.arc()
 *     linearScale  →  d3.scaleLinear()
 *     linePath     →  d3.line() over d3.scalePoint()
 *     areaUnder    →  d3.area()
 *     niceTicks    →  scale.nice().ticks()
 *
 * The rules stayed ours. What counts as a value worth drawing, what a slice
 * narrower than its own gap paints, and what a scale with nothing to scale
 * falls back to are decisions; d3 draws what it is handed.
 *
 * Coordinates are relative to the centre of the donut and to the top left of
 * the line's box, so nothing here needs to know where on the page it lands.
 */

import { scaleLinear, scalePoint } from 'd3-scale';
import { area, arc, curveMonotoneX, line, pie } from 'd3-shape';

/**
 * d3 measures a slice from twelve o'clock; SVG measures its angles from three.
 * The angles on a `DonutArc` are SVG's, so a caller placing a label beside a
 * slice does not have to know which convention it came from.
 */
const TOP = -Math.PI / 2;

/**
 * The slices of a donut, in the order the caller listed them.
 *
 * Both sorts are off on purpose. `.sort(null)` alone falls through to
 * `sortValues`, which defaults to descending, and the ring would stop matching
 * the legend drawn beside it.
 */
const slicesOf = pie<number>()
  .sort(null)
  .sortValues(null)
  .value((value) => value);

const wedge = arc();

/**
 * The largest of `values`, or `floor` if none is larger. A loop rather than
 * `Math.max(...values)`, which passes every value as an argument and runs out
 * of stack on a long series.
 */
export function largestOf(values: readonly number[], floor = -Infinity): number {
  let largest = floor;
  for (const value of values) if (value > largest) largest = value;
  return largest;
}

const polyline = line<Point>()
  .x((point) => point.x)
  .y((point) => point.y);

/**
 * Monotone, so the curve never bends above the higher of two neighbours or
 * below the lower: it smooths the corners without inventing a peak or a dip
 * between two readings that no note has.
 */
const smoothline = line<Point>()
  .x((point) => point.x)
  .y((point) => point.y)
  .curve(curveMonotoneX);

export interface DonutArc {
  /** The `d` of a `<path>`: the slice, as a wedge of the ring. */
  readonly path: string;
  /** The slice's share of the total, 0 to 1. */
  readonly fraction: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A donut's slices, in the order given, starting at twelve o'clock and running
 * clockwise.
 *
 * Values that are negative or not finite count as nothing: a chart of counts
 * should not be able to draw a wedge pointing backwards because one row of the
 * index was odd.
 */
export function donutArcs({
  values,
  radius,
  thickness,
  padAngle = 0,
}: {
  readonly values: readonly number[];
  readonly radius: number;
  readonly thickness: number;
  /** The gap between neighbouring slices, in radians. */
  readonly padAngle?: number;
}): DonutArc[] {
  const counted = values.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const largest = largestOf(counted, 0);
  if (largest === 0) return [];
  // Scaled to the largest before summing: finite values can still sum past
  // what a number holds, and a total of Infinity would give every slice nothing.
  const safe = counted.map((value) => value / largest);
  const total = safe.reduce((sum, value) => sum + value, 0);

  const inner = Math.max(radius - thickness, 0);
  const drawn = safe.filter((value) => value > 0).length;
  // One slice is a whole ring, and a ring has no neighbour to be spaced from.
  const pad = drawn > 1 ? padAngle : 0;

  return slicesOf(safe).map((slice) => {
    const sweep = slice.endAngle - slice.startAngle;

    return {
      fraction: slice.value / total,
      startAngle: slice.startAngle + TOP,
      endAngle: slice.endAngle + TOP,
      // A slice no wider than the gap it owes its neighbours has nothing left
      // to paint. d3 collapses one to a zero-area sliver rather than to the
      // mirrored major arc the hand-rolled version drew, so nothing renders
      // either way — but a sliver is still a node in the DOM and still claims
      // to be a slice. Saying so with an empty `d` is the honest version.
      path:
        sweep > pad
          ? (wedge({
              innerRadius: inner,
              outerRadius: radius,
              startAngle: slice.startAngle,
              endAngle: slice.endAngle,
              padAngle: pad,
            }) ?? '')
          : '',
    };
  });
}

/**
 * A value-to-pixel mapping.
 *
 * A domain with no width has no sensible slope. d3 puts every value at the
 * middle of the range; this puts them at its start, which for the inverted
 * range a chart's y axis uses is the baseline. A series with nothing to scale
 * should rest on the floor rather than float half way up the box.
 */
export function linearScale({
  domain,
  range,
}: {
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}): (value: number) => number {
  const [fromStart, fromEnd] = domain;
  const [toStart, toEnd] = range;
  if (fromEnd === fromStart) return () => toStart;

  const scale = scaleLinear().domain([fromStart, fromEnd]).range([toStart, toEnd]);
  return (value) => scale(value);
}

/**
 * A line across a box: one point per value, evenly spaced, with the largest
 * value at the top of the box and zero at its foot.
 *
 * Straight segments by default. `smooth` rounds the corners with a monotone
 * curve, which passes through every point and never overshoots one — an
 * ordinary spline would invent values between the points that no note has.
 */
export function linePath({
  values,
  width,
  height,
  padding = 0,
  max,
  smooth = false,
}: {
  readonly values: readonly number[];
  readonly width: number;
  readonly height: number;
  readonly padding?: number;
  readonly smooth?: boolean;
  /**
   * What sits at the top of the box. Defaults to the largest value, but a chart
   * with gridlines passes its top tick — otherwise the line touches the ceiling
   * and the top gridline sits below it.
   */
  readonly max?: number;
}): { readonly path: string; readonly points: readonly Point[] } {
  if (values.length === 0) return { path: '', points: [] };

  const largest =
    max !== undefined && Number.isFinite(max) && max > 0
      ? max
      : largestOf(
          values.map((value) => (Number.isFinite(value) ? value : 0)),
          0,
        );
  // A flat series of zeroes still has a baseline to sit on.
  const toY = linearScale({
    domain: [0, largest > 0 ? largest : 1],
    range: [height - padding, padding],
  });
  // A point scale spaces its domain across the range and centres a lone point,
  // which is what a chart of one reading wants.
  const toX = scalePoint<number>()
    .domain(values.map((_value, index) => index))
    .range([padding, width - padding]);

  const points = values.map((value, index) => ({
    // A point scale has no value off its own domain, so d3 types the lookup as
    // optional. Every index here came from that domain a line above.
    x: round(toX(index) ?? 0),
    y: round(toY(Number.isFinite(value) ? value : 0)),
  }));

  // Drawn from the rounded points rather than the raw ones, so the line and the
  // dots the component puts on it land on the same pixels.
  return { path: (smooth ? smoothline : polyline)(points) ?? '', points };
}

/**
 * The region between a smoothed line and a baseline, for filling under it. The
 * same curve as `linePath({ smooth: true })`, so the fill meets the line.
 */
export function areaUnder({
  points,
  baseline,
}: {
  readonly points: readonly Point[];
  /** The y the fill drops to — the foot of the box. */
  readonly baseline: number;
}): string {
  if (points.length === 0) return '';
  const fill = area<Point>()
    .x((point) => point.x)
    .y0(baseline)
    .y1((point) => point.y)
    .curve(curveMonotoneX);
  return fill(points) ?? '';
}

/**
 * A progress ring drawn as a stroked circle: the `stroke-dasharray` that paints
 * `fraction` of its circumference and leaves the rest bare. A fraction outside
 * 0 to 1, or not a number at all, is held to the nearest end.
 */
export function ringDash({
  radius,
  fraction,
}: {
  readonly radius: number;
  readonly fraction: number;
}): string {
  const circumference = 2 * Math.PI * Math.max(radius, 0);
  const held = Number.isFinite(fraction) ? Math.min(Math.max(fraction, 0), 1) : 0;
  return `${round(held * circumference)} ${round(circumference)}`;
}

/**
 * Round numbers from zero up to at least `max`, for gridlines and the scale
 * beside them. Steps are 1, 2 or 5 times a power of ten, which is what a reader
 * can add up in their head.
 */
export function niceTicks({
  max,
  count = 4,
}: {
  readonly max: number;
  readonly count?: number;
}): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];

  // `.nice()` widens the domain to whole steps, which is what makes the top
  // tick sit at or above `max` — `.ticks()` on its own stops short of it, and
  // the chart above would then be drawn taller than its own ceiling.
  const ticks = scaleLinear().domain([0, max]).nice(count).ticks(count);
  const top = ticks[ticks.length - 1];

  // A max too small to have a step of its own underflows d3's step to zero and
  // it hands back no ticks at all. It returns rather than hanging, so the loop
  // that used to freeze the window cannot come back — but an axis with no ticks
  // is its own kind of wrong, and zero and the value itself is the only scale
  // left that still covers it.
  if (top === undefined || top < max) return [0, max];
  return ticks;
}

/** Three decimals is finer than any screen and keeps the path strings short. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
