import type { CompiledQuery } from '../query/view-query.ts';
import { vaultPathName, type VaultPath } from './vault-path.ts';

/** The property a note says which day it is about by: a meeting's, an event's. */
export const NOTE_DAY_KEY = 'date';

/**
 * Whether a note's file name begins with `day` — a daily note, or a meeting
 * filed as `2026-10-14 Standup.md` — so it is about that day whatever its
 * properties say.
 */
export function isNamedForDay(path: VaultPath, day: string): boolean {
  const name = vaultPathName(path);
  return name.startsWith(day) && !/\d/.test(name.charAt(day.length));
}

/**
 * The notes whose {@link NOTE_DAY_KEY} property is `day`, asked of the index:
 * one `path` column, in path order. A day with a time (`2026-10-14 09:00`) is
 * on that day.
 */
export function compileNotesOnDayQuery(day: string): CompiledQuery {
  return {
    sql: [
      '/* notes on day */',
      'SELECT DISTINCT props.path AS "path" FROM props',
      'WHERE props.key = ? AND substr(COALESCE(props.value_date, props.value_text), 1, 10) = ?',
      'ORDER BY props.path',
    ].join('\n'),
    parameters: [NOTE_DAY_KEY, day],
  };
}
