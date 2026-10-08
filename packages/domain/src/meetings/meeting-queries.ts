import { outsideArchiveSql } from '../archive/archive.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { DUPLICATE_OF_KEY, IMPORT_ERROR_KEY } from './meeting-arrival.ts';
import { MEETING_TYPE } from './meeting-header.ts';

/** What the statements here start with, so a log or a stand-in index can tell them apart. */
export const MEETING_QUERY_MARK = '/* meetings */';

/** A note's first value for a key, as text — a date's as written when the index read it as one. */
const valueOf = (key: string) =>
  `(SELECT COALESCE(p.value_date, p.value_text) FROM props AS p WHERE p.path = files.path AND p.key = '${key}' ORDER BY p.idx LIMIT 1)`;

/** Notes of the Meeting type, as a condition on `files.path`. */
const IS_MEETING = `files.path IN (SELECT path FROM props WHERE key = 'type' AND value_text = ?)`;

/**
 * The notes the index says hold a meeting's provider + external_id: what a
 * copy of it may be a duplicate of. Archived notes count — a meeting filed
 * away and sent again is still the same meeting. Notes marked as a copy or as
 * failing import are listed too: the index can be behind the files (a mark
 * written, or taken out, since it last read them), so whoever asks reads each
 * file to know what it holds now. Ids are compared without the spaces around
 * them: `' g-1'` and `'g-1'` are one meeting.
 */
export function compileMeetingHoldersQuery({
  provider,
  externalId,
}: {
  provider: string;
  externalId: string;
}): CompiledQuery {
  return {
    sql: [
      `${MEETING_QUERY_MARK} SELECT files.path AS "path" FROM files`,
      `WHERE ${IS_MEETING}`,
      `  AND files.path IN (SELECT path FROM props WHERE key = 'provider' AND value_text = ?)`,
      `  AND files.path IN (SELECT path FROM props WHERE key = 'external_id' AND trim(value_text) = ?)`,
      `ORDER BY files.path`,
    ].join('\n'),
    parameters: [MEETING_TYPE, provider, externalId.trim()],
  };
}

/** The columns {@link compileMeetingListQuery} comes back as, in order. */
export const MEETING_LIST_COLUMNS = [
  'path',
  'title',
  'date',
  'start',
  'end',
  'kind',
  'provider',
  'external_id',
  IMPORT_ERROR_KEY,
  DUPLICATE_OF_KEY,
] as const;

/** The most meetings one page lists. */
export const MEETING_LIST_LIMIT = 500;

/**
 * Meetings, newest first by their day and start, then by path so a page never
 * reshuffles: every note of the Meeting type, and any note carrying an import
 * error, since a file that failed the contract may not say what it is. `since`
 * keeps those on or after a day (`YYYY-MM-DD`); a note with no day is kept
 * only when no `since` is given. Archived notes — duplicates among them —
 * are left out unless asked for.
 */
export function compileMeetingListQuery({
  since,
  includeArchived,
  limit,
  offset,
}: {
  since: string | null;
  includeArchived: boolean;
  limit: number;
  offset: number;
}): CompiledQuery {
  const title = `COALESCE(${valueOf('title')}, files.title)`;
  const columns = [
    `files.path AS "path"`,
    `${title} AS "title"`,
    ...MEETING_LIST_COLUMNS.slice(2).map((key) => `${valueOf(key)} AS "${key}"`),
  ];
  const conditions = [
    `(${IS_MEETING} OR files.path IN (SELECT path FROM props WHERE key = ?))`,
    ...(includeArchived ? [] : [outsideArchiveSql('files.path')]),
    ...(since === null ? [] : [`"date" >= ?`]),
  ];
  return {
    sql: [
      `${MEETING_QUERY_MARK} SELECT ${columns.join(',\n  ')}`,
      `FROM files`,
      `WHERE ${conditions.join('\n  AND ')}`,
      `ORDER BY "date" IS NULL, "date" DESC, "start" DESC, files.path`,
      `LIMIT ? OFFSET ?`,
    ].join('\n'),
    parameters: [
      MEETING_TYPE,
      IMPORT_ERROR_KEY,
      ...(since === null ? [] : [since]),
      Math.max(1, Math.floor(limit)),
      Math.max(0, Math.floor(offset)),
    ],
  };
}
