import type { StatusTone } from '../page/status-tone.ts';

const SMALLEST = 5;
const LARGEST = 18;

/**
 * How big a note is drawn: by how connected it is, on a square-root scale so a
 * hub stands out without swallowing its neighbours, and never past a ceiling.
 */
export function nodeRadius(degree: number): number {
  const grown = SMALLEST + 2 * Math.sqrt(Math.max(0, degree));
  return Math.min(LARGEST, Math.round(grown * 10) / 10);
}

/**
 * The ramp a type is drawn from. Backlog comes last: it is the quietest tone,
 * nearest the neutral a note without a type is drawn in.
 */
const GRAPH_TONES: readonly StatusTone[] = ['next', 'doing', 'review', 'done', 'backlog'];

/**
 * A tone for each type, by the type's place in alphabetical order.
 *
 * Deciding by order rather than by name keeps neighbouring types apart on the
 * ramp; deciding on the sorted list rather than the order given keeps a type
 * its colour however the notes arrive. Past five types the ramp repeats, which
 * the chips' own swatches make readable.
 */
export function graphTypeTones(types: readonly string[]): ReadonlyMap<string, StatusTone> {
  const named = [...new Set(types.filter((type) => type !== ''))].sort((left, right) =>
    left.localeCompare(right),
  );
  return new Map(
    named.map((type, index) => [type, GRAPH_TONES[index % GRAPH_TONES.length] as StatusTone]),
  );
}
