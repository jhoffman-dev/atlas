import {
  carriesChecklistProgress,
  compileViewQuery,
  isViewColumn,
  type ObjectType,
  type ViewQuery,
} from '@atlas/domain';
import type { IndexPort, QueryResult, ViewTypeSpec } from '../index/ports.ts';

export interface ViewResult extends QueryResult {
  /** The SQL that ran, so it can be shown and copied. */
  readonly sql: string;
}

/**
 * Runs a view and reports the SQL it used.
 *
 * The SQL is returned rather than hidden because the point of building on SQL
 * rather than formulas is that you can read what the view actually asked for —
 * and take it somewhere else when the controls run out.
 */
export async function runView({
  index,
  query,
  includeArchived = false,
}: {
  index: IndexPort;
  query: ViewQuery;
  /** Lists archived notes too; they are out of the way unless asked for (U-22). */
  includeArchived?: boolean;
}): Promise<ViewResult> {
  const compiled = compileViewQuery(query, {}, { includeArchived });
  const result = await index.query(compiled.sql, compiled.parameters);
  return { ...result, sql: compiled.sql };
}

/**
 * The shape the index needs to build a SQL view for each type.
 *
 * A property named like one of the view's own columns — possible in a type
 * file written by hand — is left out rather than given a second column
 * SQLite would rename to `modified:1`. Each note's checklist progress is a
 * column too, unless the type declares a `progress` of its own (P30-03).
 */
export function viewSpecsFor(types: readonly ObjectType[]): ViewTypeSpec[] {
  return types.map((type) => ({
    name: type.name,
    columns: type.properties
      .filter((property) => !isViewColumn(property.key))
      .map((property) => ({ key: property.key, kind: property.kind, many: property.many })),
    progress: carriesChecklistProgress(type),
  }));
}
