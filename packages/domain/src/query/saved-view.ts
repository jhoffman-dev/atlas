import { asQuery, asName } from './frontmatter-query.ts';
import { asCalendarRange, type CalendarRange } from '../calendar/calendar-range.ts';
import { normaliseSql } from './sql-query.ts';
import { type ViewQuery } from './view-query.ts';

/** How a view draws its results. The query behind them is the same either way. */
export type ViewLayout = 'table' | 'board' | 'list' | 'gallery' | 'feed' | 'calendar' | 'timeline';

export const VIEW_LAYOUTS: readonly ViewLayout[] = [
  'table',
  'board',
  'list',
  'gallery',
  'feed',
  'calendar',
  'timeline',
];

export interface ViewDisplay {
  readonly layout: ViewLayout;
  /**
   * The property a board groups into columns, and a table and a gallery into
   * groups. Ignored by the other layouts.
   */
  readonly groupBy: string | null;
  /**
   * The property each group is split by in turn: a board's swimlanes, a
   * table's sub-groups. Null without a `groupBy`, and when it names the same one.
   */
  readonly subGroupBy: string | null;
  /** The date property a calendar places notes by. Ignored by the others. */
  readonly dateKey: string | null;
  /** The date a timeline bar starts on. Ignored by the others. */
  readonly startKey: string | null;
  /**
   * The date a timeline bar ends on. Falls back to the start, which makes every
   * note a milestone — right for a plan that only records deadlines.
   */
  readonly endKey: string | null;
  /** How much a calendar shows at once — a month unless the view says otherwise. */
  readonly calendarRange: CalendarRange;
}

/** The frontmatter key that marks a note as a view rather than prose. */
export const VIEW_MARKER = 'atlas';
export const VIEW_MARKER_VALUE = 'view';

/** Whether this note is a saved view. */
export function isSavedView(frontmatter: Readonly<Record<string, unknown>>): boolean {
  return String(frontmatter[VIEW_MARKER] ?? '').trim() === VIEW_MARKER_VALUE;
}

/**
 * Reads a view out of a note's frontmatter.
 *
 * A view is an ordinary note, so it can be written by hand, kept in version
 * control and edited anywhere. Anything unreadable in it is dropped rather than
 * rejected: a mistyped filter should cost you the filter, not the table.
 */
export function parseSavedView(frontmatter: Readonly<Record<string, unknown>>): ViewQuery | null {
  if (!isSavedView(frontmatter) || parseSqlView(frontmatter) !== null) return null;
  if (parseQueryView(frontmatter) !== null) return null;
  return asQuery(frontmatter);
}

/** The key a query view keeps its Atlas query under (ADR-0019). */
export const QUERY_VIEW_KEY = 'query';

/** How a query's rows can be drawn: each of these can show groups and sub-groups. */
export const QUERY_VIEW_LAYOUTS: readonly ViewLayout[] = ['table', 'board', 'list'];

/**
 * The Atlas query a view runs, exactly as written, or null when the note is
 * not a query view. `sql:` wins over `query:`, and `query:` over `type:`, so
 * a note that says several of them is read one way.
 */
export function parseQueryView(frontmatter: Readonly<Record<string, unknown>>): string | null {
  if (!isSavedView(frontmatter) || parseSqlView(frontmatter) !== null) return null;
  const raw = frontmatter[QUERY_VIEW_KEY];
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  return raw;
}

/** The layout a query view is drawn in: one of the three that can show groups, else a table. */
export function queryViewLayout(frontmatter: Readonly<Record<string, unknown>>): ViewLayout {
  const declared = String(frontmatter['layout'] ?? '').trim() as ViewLayout;
  return QUERY_VIEW_LAYOUTS.includes(declared) ? declared : 'table';
}

/**
 * Why a query view's text cannot be saved, or null. Only a blank query is
 * refused: saved, the note would stop being a query view (parseQueryView).
 * Text that does not read yet is saved as typed — the text is what is saved.
 */
export function queryViewSaveProblem(query: string): string | null {
  return query.trim() === '' ? 'Write a query before saving: FROM task.' : null;
}

/** The frontmatter a query view is written as. */
export function queryViewFrontmatter({
  query,
  layout,
}: {
  query: string;
  layout: ViewLayout;
}): Record<string, unknown> {
  return { [VIEW_MARKER]: VIEW_MARKER_VALUE, layout, [QUERY_VIEW_KEY]: query };
}

/** The key a SQL view keeps its statement under. */
export const SQL_VIEW_KEY = 'sql';

/** The layouts a SQL view's result can be drawn in: it has rows, but no type to move them in. */
export const SQL_VIEW_LAYOUTS: readonly ViewLayout[] = ['table', 'list'];

/**
 * The statement a SQL view runs, or null when the note is not one. A view with
 * `sql:` is a SQL view whatever else it says — `type:` included — and its
 * result is read-only.
 */
export function parseSqlView(frontmatter: Readonly<Record<string, unknown>>): string | null {
  if (!isSavedView(frontmatter)) return null;
  const sql = normaliseSql(String(frontmatter[SQL_VIEW_KEY] ?? ''));
  return sql === '' ? null : sql;
}

/**
 * Why a SQL view's result cannot be drawn in a layout, or null. A list needs
 * something to name each row by, so its query has to return `path` and `title`.
 */
export function sqlLayoutProblem(layout: ViewLayout, columns: readonly string[]): string | null {
  if (!SQL_VIEW_LAYOUTS.includes(layout)) return `A query can be saved as a table or a list.`;
  if (layout === 'list' && !(columns.includes('path') && columns.includes('title'))) {
    return 'A list needs the query to return path and title.';
  }
  return null;
}

/** The frontmatter a SQL view is written as. */
export function sqlViewFrontmatter({
  sql,
  layout,
}: {
  sql: string;
  layout: ViewLayout;
}): Record<string, unknown> {
  return { [VIEW_MARKER]: VIEW_MARKER_VALUE, layout, [SQL_VIEW_KEY]: normaliseSql(sql) };
}

/** The frontmatter a view should be written back as. */
export function savedViewFrontmatter(
  query: ViewQuery,
  display?: ViewDisplay,
): Record<string, unknown> {
  return {
    [VIEW_MARKER]: VIEW_MARKER_VALUE,
    type: query.type,
    ...(display === undefined
      ? {}
      : {
          layout: display.layout,
          ...(display.groupBy === null ? {} : { groupBy: display.groupBy }),
          ...(display.subGroupBy === null ? {} : { subGroupBy: display.subGroupBy }),
        }),
    columns: [...query.columns],
    filters: query.filters.map((filter) => ({
      key: filter.key,
      operator: filter.operator,
      ...(filter.value === undefined || filter.value === null ? {} : { value: filter.value }),
    })),
    sorts: query.sorts.map((sort) => ({ key: sort.key, direction: sort.direction })),
    limit: query.limit,
  };
}

/**
 * How the view should be drawn.
 *
 * A board with nothing to group by is a table with extra steps, so it falls back
 * rather than showing one empty column.
 */
export function parseViewDisplay(frontmatter: Readonly<Record<string, unknown>>): ViewDisplay {
  const declared = String(frontmatter['layout'] ?? '').trim() as ViewLayout;

  const layout = VIEW_LAYOUTS.includes(declared) ? declared : 'table';
  const startKey = asName(frontmatter['startKey']);
  const groupBy = asName(frontmatter['groupBy']);
  const settings = {
    groupBy,
    subGroupBy: subGroupOf(groupBy, asName(frontmatter['subGroupBy'])),
    dateKey: asName(frontmatter['dateKey']),
    startKey,
    endKey: asName(frontmatter['endKey']) ?? startKey,
    calendarRange: asCalendarRange(frontmatter['calendarRange']),
  };

  // A board with nothing to group by, or a calendar with no date to place notes
  // on, is a table with extra steps.
  if (layout === 'board' && settings.groupBy === null) return { layout: 'table', ...settings };
  if (layout === 'calendar' && settings.dateKey === null) return { layout: 'table', ...settings };
  // A timeline with no date to start bars from has nothing to draw.
  if (layout === 'timeline' && settings.startKey === null) return { layout: 'table', ...settings };

  return { layout, ...settings };
}

/**
 * The sub-grouping a view can use: none without a grouping to split, and none
 * that would split each group by the very property that made it.
 */
export function subGroupOf(groupBy: string | null, subGroupBy: string | null): string | null {
  return groupBy === null || subGroupBy === groupBy ? null : subGroupBy;
}
