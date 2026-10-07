/**
 * SQL written by hand, over the index.
 *
 * The statement goes to the index's read-only path unchanged — the same guard
 * that every view and the local API go through decides what may run, so
 * nothing here tries to judge a statement's safety. What lives here is what
 * the page around the statement needs: whether there is anything to run, the
 * index's shape for the schema list, and sorting a result by its own columns.
 */

import type { QuerySort } from './view-query.ts';

/** A query's answer, as the index hands it back. */
export interface SqlResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

/**
 * The statement as it is sent: trimmed, and without the semicolons that end
 * it. One statement is all the index runs, and a trailing `;` is how most
 * people finish one.
 */
export function normaliseSql(text: string): string {
  return text.trim().replace(/[\s;]+$/, '');
}

/** Why there is nothing to run, or null when there is. */
export function sqlProblem(text: string): string | null {
  return normaliseSql(text) === '' ? 'Write a query to run.' : null;
}

/**
 * The index's tables and views and their columns, in one statement so it runs
 * through the same read-only path as any other. FTS5's shadow tables and
 * SQLite's own are left out: nobody queries them on purpose.
 */
export const SCHEMA_SQL = [
  'SELECT m.name AS "table", m.type AS "kind", p.name AS "column"',
  'FROM sqlite_master AS m, pragma_table_info(m.name) AS p',
  "WHERE m.type IN ('table', 'view')",
  "AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'",
  "AND m.name NOT LIKE 'fts\\_%' ESCAPE '\\'",
  'ORDER BY m.type DESC, m.name, p.cid',
].join('\n');

export interface SchemaTable {
  readonly name: string;
  readonly kind: 'table' | 'view';
  readonly columns: readonly string[];
}

/**
 * The schema statement's rows as a list of tables. Views come first: a type's
 * `v_<type>` view is what a person usually wants, and the raw tables are the
 * index's own layout.
 */
export function schemaFromResult(result: SqlResult): SchemaTable[] {
  const at = (name: string) => result.columns.indexOf(name);
  const [table, kind, column] = [at('table'), at('kind'), at('column')];
  if (table < 0 || kind < 0 || column < 0) return [];

  const found = new Map<string, { kind: 'table' | 'view'; columns: string[] }>();
  for (const row of result.rows) {
    const name = String(row[table] ?? '');
    const entry = found.get(name) ?? {
      kind: row[kind] === 'view' ? 'view' : 'table',
      columns: [],
    };
    entry.columns.push(String(row[column] ?? ''));
    found.set(name, entry);
  }
  return [...found.entries()]
    .map(([name, entry]) => ({ name, ...entry }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name)
        : left.kind === 'view'
          ? -1
          : 1,
    );
}

/**
 * The rows ordered by the result's own columns, for a heading clicked on a
 * result nobody can re-query by property. Blanks go last; numbers compare as
 * numbers. The sort is stable, so ties keep the order the query gave them.
 */
export function sortResultRows(
  result: SqlResult,
  sorts: readonly QuerySort[],
): (readonly unknown[])[] {
  const keys = sorts
    .map((sort) => ({
      at: result.columns.indexOf(sort.key),
      sign: sort.direction === 'desc' ? -1 : 1,
    }))
    .filter((key) => key.at >= 0);
  return [...result.rows].sort((left, right) => {
    for (const { at, sign } of keys) {
      const order = compareCells(left[at], right[at], sign);
      if (order !== 0) return order;
    }
    return 0;
  });
}

const isBlank = (value: unknown) => value === null || value === undefined || value === '';

/** Blanks last in either direction: an empty cell is not the smallest value, only a missing one. */
function compareCells(left: unknown, right: unknown, sign: number): number {
  if (isBlank(left) || isBlank(right)) {
    return isBlank(left) === isBlank(right) ? 0 : isBlank(left) ? 1 : -1;
  }
  if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign;
  return String(left).localeCompare(String(right), undefined, { numeric: true }) * sign;
}
