import { DASHBOARD_MARKER, DASHBOARD_MARKER_VALUE } from '../dashboard/dashboard.ts';
import { FAVORITE_KEY, FAVORITE_VALUE } from '../favorites/favorite.ts';
import { VIEW_MARKER, VIEW_MARKER_VALUE } from '../query/saved-view.ts';
import type { CompiledQuery } from '../query/view-query.ts';
import { outsideArchiveSql } from '../archive/archive.ts';
import { VIEW_ORDER_KEY } from './type-views.ts';

/**
 * The keys that decide what a view lists and how it is drawn — its tabs and its
 * icon. A board with nothing to group by is drawn as a table, so the layout
 * alone is not enough to say.
 */
const VIEW_DISPLAY_KEYS = [
  'type',
  'layout',
  'groupBy',
  'dateKey',
  'startKey',
  'query',
  'title',
  VIEW_ORDER_KEY,
] as const;

/** The columns {@link compileSidebarQuery} comes back as, in order. */
export const SIDEBAR_QUERY_COLUMNS = ['path', 'key', 'value', 'title'] as const;

/**
 * Every note the sidebar's derived sections care about, asked of the index in
 * one go.
 *
 * It returns the marks themselves — one row per `atlas:` or `favorite:`
 * property, plus a view's display keys — rather than three lists, so the same frontmatter rule that
 * classifies a note read from disk classifies a note read from the index. Each
 * row carries the note's title as the index stored it, which `pageTitle` decided. The
 * host caps how many rows any query may return, so there is no limit here.
 *
 * Nothing in the statement comes from a note: the keys and values are the
 * markers themselves, and they are bound rather than written into the text.
 *
 * An archived note is none of these: a favourite that was archived leaves
 * Favorites with it, and comes back when it is unarchived (U-22).
 */
export function compileSidebarQuery(): CompiledQuery {
  return {
    sql: `SELECT files.path AS "path", props.key AS "key", props.value_text AS "value",
        files.title AS "title"
 FROM files
 JOIN props ON props.path = files.path
 WHERE ((props.key = ? AND props.value_text = ?)
    OR (props.key = ? AND props.value_text = ?)
    OR (props.key = ? AND props.value_text = ?)
    OR (props.key IN (${VIEW_DISPLAY_KEYS.map(() => '?').join(', ')})
        AND files.path IN (SELECT path FROM props WHERE key = ? AND value_text = ?)))
   AND ${outsideArchiveSql('files.path')}`,
    parameters: [
      VIEW_MARKER,
      VIEW_MARKER_VALUE,
      DASHBOARD_MARKER,
      DASHBOARD_MARKER_VALUE,
      FAVORITE_KEY,
      FAVORITE_VALUE,
      ...VIEW_DISPLAY_KEYS,
      VIEW_MARKER,
      VIEW_MARKER_VALUE,
    ],
  };
}
