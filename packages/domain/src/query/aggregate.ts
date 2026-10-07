/**
 * A single number about a set of notes.
 *
 * Only the vocabulary lives here. Turning one into SQL is the query compiler's
 * job, so that names go on being checked in exactly one place.
 */

import { InvalidQueryError } from './invalid-query-error.ts';

export type AggregateKind = 'count' | 'sum' | 'average' | 'earliest' | 'latest';

export const AGGREGATE_KINDS: readonly AggregateKind[] = [
  'count',
  'sum',
  'average',
  'earliest',
  'latest',
];

const FUNCTIONS: ReadonlyMap<AggregateKind, string> = new Map([
  ['count', 'COUNT'],
  ['sum', 'SUM'],
  ['average', 'AVG'],
  ['earliest', 'MIN'],
  ['latest', 'MAX'],
] as const);

/**
 * The SQL function a kind names.
 *
 * `QueryShape` is public API and a saved view is a file a person can edit, so a
 * kind arriving here need not be one of the five. An unknown one is refused the
 * way an unusable name is, rather than compiling to `undefined("x")`.
 */
export function aggregateFunction(kind: AggregateKind): string {
  const sql = FUNCTIONS.get(kind);
  if (sql === undefined) {
    throw new InvalidQueryError(`unknown aggregate ${JSON.stringify(kind)}`);
  }
  return sql;
}

/** How the number should read: a count is whole, an average rarely is. */
export function formatAggregate(kind: AggregateKind, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'earliest' || kind === 'latest') return String(value);

  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (kind === 'count') return String(Math.round(number));

  // Two decimals at most, and none when it lands on a whole number.
  // Rounding first, and adding zero, means 2.004 reads "2" and -0.001 reads "0", not "2." or "-0".
  // A number too large to scale by 100 is far past having decimals worth rounding.
  const rounded = Math.round(number * 100) / 100;
  return String((Number.isFinite(rounded) ? rounded : number) + 0);
}
