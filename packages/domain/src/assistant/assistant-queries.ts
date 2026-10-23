import { outsideArchiveSql } from '../archive/archive.ts';
import { TASK_KEYS } from '../gtd/gtd-status.ts';
import { tagKey } from '../tags/tag-name.ts';
import { FOLLOW_UP_TAG } from '../automations/meeting-items.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { userSpaceNoteSql } from '../vault/vault-visibility.ts';

/*
 * The two things the assistant's tools ask the index that a linked page does
 * not: where each item says it came from (its `source`), and the follow-ups
 * made from a page's meetings. Each is one bounded statement over the
 * index's own tables, however many items or meetings it is asked about.
 */

/** What the statements here start with, so a log or a stand-in index can tell them apart. */
export const ASSISTANT_QUERY_MARK = '/* assistant */';

/** The most notes one statement names: far inside SQLite's limit on bound values. */
export const ASSISTANT_PATHS_PER_QUERY = 1000;

/** The most follow-ups an answer lists. */
export const FOLLOW_UP_LIMIT = 100;

const placeholders = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

/** The paths a statement is asked about: each once, at most {@link ASSISTANT_PATHS_PER_QUERY}. */
function boundedPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)].slice(0, ASSISTANT_PATHS_PER_QUERY);
}

/** A note's first value for a key, as text — a date's as written when the index read it as one. */
const valueOf = (key: string, column: string): string =>
  `(SELECT COALESCE(p.value_date, p.value_text) FROM props AS p WHERE p.path = ${column} AND p.key = '${key}' ORDER BY p.idx LIMIT 1)`;

/** The `source` each of these notes holds, as written: `[[Kickoff#^t0003]]`. Null with no paths. */
export function compileSourcesQuery(paths: readonly string[]): CompiledQuery | null {
  const asked = boundedPaths(paths);
  if (asked.length === 0) return null;
  return {
    sql: [
      `${ASSISTANT_QUERY_MARK} SELECT p.path AS "path", p.value_text AS "source" FROM props AS p`,
      `WHERE p.key = '${TASK_KEYS.source}' AND p.idx = 0 AND p.path IN (${placeholders(asked.length)})`,
    ].join('\n'),
    parameters: asked,
  };
}

/** Each note's `source`, by path, from the rows of {@link compileSourcesQuery}. */
export function sourcesOf(rows: readonly (readonly unknown[])[]): ReadonlyMap<string, string> {
  const sources = new Map<string, string>();
  for (const [path, source] of rows) {
    if (typeof path === 'string' && typeof source === 'string') sources.set(path, source);
  }
  return sources;
}

/** The columns of {@link compileFollowUpsQuery}, in order. */
export const FOLLOW_UP_COLUMNS = ['path', 'title', 'status', 'due', 'source'] as const;

/**
 * The open tasks tagged `#follow-up` (P29-05) linked either way — by a
 * property or a link in a body — with any of `around`: a page and its
 * meetings. A follow-up made from a meeting is joined to it by the meeting's
 * `tasks` and cites a turn of it in `source`, so it is found from the
 * meeting though it never names the person. Archived and hidden notes are
 * left out, as every query leaves them out; `done` is the status that
 * finishes a task, null when the Task type has none.
 */
export function compileFollowUpsQuery({
  around,
  taskType,
  statusKey,
  done,
  limit = FOLLOW_UP_LIMIT,
}: {
  around: readonly string[];
  /** The vault's Task type, as notes of it write `type:`. */
  taskType: string;
  statusKey: string;
  done: string | null;
  limit?: number;
}): CompiledQuery | null {
  const asked = boundedPaths(around);
  if (asked.length === 0) return null;
  const joined = [
    'SELECT r.dst FROM relations AS r WHERE r.src IN (SELECT path FROM around)',
    'SELECT r.src FROM relations AS r WHERE r.dst IN (SELECT path FROM around)',
    'SELECT l.dst FROM links AS l WHERE l.src IN (SELECT path FROM around)',
    'SELECT l.src FROM links AS l WHERE l.dst IN (SELECT path FROM around)',
  ].join(' UNION ');
  const open = done === null ? [] : [`  AND COALESCE(${valueOf(statusKey, 'f.path')}, '') <> ?`];
  return {
    sql: [
      `${ASSISTANT_QUERY_MARK} WITH around(path) AS (VALUES ${asked.map(() => '(?)').join(', ')})`,
      `SELECT f.path AS "path", f.title AS "title", ${valueOf(statusKey, 'f.path')} AS "status",`,
      `  ${valueOf(TASK_KEYS.due, 'f.path')} AS "due", ${valueOf(TASK_KEYS.source, 'f.path')} AS "source"`,
      'FROM files AS f',
      "WHERE f.path IN (SELECT path FROM props WHERE key = 'type' AND value_text = ?)",
      '  AND f.path IN (SELECT path FROM tags WHERE tag = ?)',
      `  AND f.path IN (${joined})`,
      `  AND ${outsideArchiveSql('f.path')} AND ${userSpaceNoteSql('f.path')}`,
      ...open,
      'ORDER BY f.path LIMIT ?',
    ].join('\n'),
    parameters: [
      ...asked,
      taskType,
      tagKey(FOLLOW_UP_TAG),
      ...(done === null ? [] : [done]),
      limit,
    ],
  };
}

/** A follow-up as {@link compileFollowUpsQuery} answers it. */
export interface FollowUpRow {
  readonly path: string;
  readonly title: string;
  readonly status: string | null;
  readonly due: string | null;
  readonly source: string | null;
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The rows of {@link compileFollowUpsQuery}, in {@link FOLLOW_UP_COLUMNS} order. */
export function followUpRowsOf(rows: readonly (readonly unknown[])[]): FollowUpRow[] {
  return rows.flatMap(([path, title, status, due, source]) =>
    typeof path === 'string'
      ? [
          {
            path,
            title: typeof title === 'string' ? title : path,
            status: textOrNull(status),
            due: textOrNull(due),
            source: textOrNull(source),
          },
        ]
      : [],
  );
}
