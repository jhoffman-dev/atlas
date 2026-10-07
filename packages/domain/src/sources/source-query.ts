import type { CompiledQuery } from '../query/view-query.ts';
import { SOURCE_MARKER, SOURCE_MARKER_VALUE } from './datasource.ts';

/**
 * Every source note the index knows about, as one `path` column.
 *
 * The index covers user space only; the sources Atlas keeps in `.atlas` are
 * read from the folder, as the sidebar reads its views. The marker is bound
 * rather than written into the text.
 */
export function compileSourceNotesQuery(): CompiledQuery {
  return {
    sql: `SELECT DISTINCT props.path AS "path" FROM props WHERE props.key = ? AND props.value_text = ?`,
    parameters: [SOURCE_MARKER, SOURCE_MARKER_VALUE],
  };
}
