/**
 * Reading a `sql` widget's answer, by position rather than by name.
 *
 * A statement names its own columns, so the widget cannot look for `label` and
 * `count` the way a chart over a type does. It reads the shape instead: the
 * first cell is the number; the first two columns are a bar chart's labels and
 * values.
 */

import { formatAggregate } from '../query/aggregate.ts';
import { InvalidQueryError } from '../query/invalid-query-error.ts';
import type { SqlResult } from '../query/sql-query.ts';
import type { GroupCount } from './groups.ts';
import type { SqlShow } from './dashboard.ts';

/** The first cell of the result, as a number tile shows it; a dash when there is none. */
export function sqlNumber(result: SqlResult): string {
  return formatAggregate('sum', result.rows[0]?.[0] ?? null);
}

/**
 * The result as bars: the first column labels each, the second is its value.
 * A value that is not a number counts as nothing rather than breaking the
 * chart; a result with fewer than two columns has nothing to chart.
 */
export function sqlGroups(result: SqlResult): GroupCount[] {
  const problem = sqlShowProblem('bar', result.columns);
  if (problem !== null) throw new InvalidQueryError(problem);
  return result.rows.map((row) => {
    const value = Number(row[1]);
    return { label: String(row[0] ?? ''), count: Number.isFinite(value) ? value : 0 };
  });
}

/** Why a result cannot be drawn this way, or null: a chart needs a label and a value. */
export function sqlShowProblem(show: SqlShow, columns: readonly string[]): string | null {
  if (columns.length === 0) return 'The query returned no columns.';
  if (show === 'bar' && columns.length < 2) {
    return 'A bar chart needs the query to return a label and a value.';
  }
  return null;
}
