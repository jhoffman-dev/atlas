import {
  normaliseSql,
  schemaFromResult,
  sqlProblem,
  SCHEMA_SQL,
  type SchemaTable,
} from '@atlas/domain';
import { messageWithoutPaths } from '../api/api-error.ts';
import type { IndexPort, QueryResult } from '../index/ports.ts';

/** A statement the index refused or could not run, in words that can be shown. */
export class SqlQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlQueryError';
  }
}

/**
 * Runs a statement written by hand, through the index's read-only path — the
 * one every view and the local API use, which refuses anything that would
 * change the index. The index's own error comes back as the message, with the
 * machine's paths taken out.
 */
export async function runSql({
  index,
  sql,
}: {
  index: IndexPort;
  sql: string;
}): Promise<QueryResult> {
  const problem = sqlProblem(sql);
  if (problem !== null) throw new SqlQueryError(problem);
  try {
    return await index.query(normaliseSql(sql), []);
  } catch (cause) {
    throw new SqlQueryError(messageWithoutPaths(cause));
  }
}

/** The index's tables and views and their columns, asked through the same read-only path. */
export async function loadSchema({ index }: { index: IndexPort }): Promise<SchemaTable[]> {
  return schemaFromResult(await runSql({ index, sql: SCHEMA_SQL }));
}
