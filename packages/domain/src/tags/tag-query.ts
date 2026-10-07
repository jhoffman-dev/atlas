import { outsideArchiveSql } from '../archive/archive.ts';
import type { CompiledQuery } from '../query/view-query.ts';

/** Rows per page of tag counts: the host hands back at most 5,000 at once. */
export const TAG_PAGE_SIZE = 5000;

/**
 * One page of every tag in the index with how often it is used, and the
 * spelling of its first use — by path, then by place in the note — which is
 * how it is shown. Columns: key, name, count.
 *
 * Archived notes are left out, as the views and search leave them out (U-22);
 * a rename asks for them too, so a tag renamed still reaches them.
 */
export function compileTagCountsQuery(page: number, reach: TagReach = {}): CompiledQuery {
  const within = inReach('tags.path', reach);
  return {
    sql: `/* tags:counts */ SELECT tags.tag AS "key",
        (SELECT first.name FROM tags AS first WHERE first.tag = tags.tag${inReach('first.path', reach, ' AND ')}
          ORDER BY first.path, first.idx LIMIT 1) AS "name",
        count(*) AS "count"
 FROM tags${within === '' ? '' : ` WHERE ${within}`} GROUP BY tags.tag ORDER BY tags.tag LIMIT ? OFFSET ?`,
    parameters: [TAG_PAGE_SIZE, page * TAG_PAGE_SIZE],
  };
}

/**
 * One page of each tag's uses, note by note, spelled as its first use in that
 * note — so the uses in some notes can be counted without the rest. Columns:
 * path, key, name, count; in path order, then by tag. Archived notes only
 * when `reach` asks for them, as above.
 */
export function compileTagUsesQuery(page: number, reach: TagReach = {}): CompiledQuery {
  const within = inReach('tags.path', reach);
  return {
    sql: `/* tags:uses */ SELECT tags.path AS "path", tags.tag AS "key",
        (SELECT first.name FROM tags AS first WHERE first.path = tags.path AND first.tag = tags.tag
          ORDER BY first.idx LIMIT 1) AS "name",
        count(*) AS "count"
 FROM tags${within === '' ? '' : ` WHERE ${within}`} GROUP BY tags.path, tags.tag ORDER BY tags.path, tags.tag LIMIT ? OFFSET ?`,
    parameters: [TAG_PAGE_SIZE, page * TAG_PAGE_SIZE],
  };
}

/**
 * One page of the notes using a tag, or any tag nested under it, with how
 * many times. Columns: path, title, count. `key` is bound, never written into
 * the text. Archived notes only when `reach` asks for them, as above.
 */
export function compileTaggedNotesQuery(
  key: string,
  page: number,
  reach: TagReach = {},
): CompiledQuery {
  const nested = `${key}/`;
  return {
    sql: `/* tags:notes */ SELECT files.path AS "path", files.title AS "title", count(*) AS "count"
 FROM tags JOIN files ON files.path = tags.path
 WHERE (tags.tag = ? OR substr(tags.tag, 1, length(?)) = ?)${inReach('tags.path', reach, ' AND ')}
 GROUP BY files.path ORDER BY files.title COLLATE NOCASE, files.path LIMIT ? OFFSET ?`,
    parameters: [key, nested, nested, TAG_PAGE_SIZE, page * TAG_PAGE_SIZE],
  };
}

/** Whether a tag query reaches into the Archive. */
export interface TagReach {
  readonly includeArchived?: boolean;
}

/** The condition that keeps archived notes out, joined on with `join`; nothing when they are in reach. */
function inReach(column: string, reach: TagReach, join = ''): string {
  return reach.includeArchived === true ? '' : `${join}${outsideArchiveSql(column)}`;
}
