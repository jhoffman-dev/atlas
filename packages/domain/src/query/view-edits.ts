/**
 * A view's toolbar changes, held apart from the view note until they are saved.
 *
 * Filtering, sorting, grouping and choosing properties apply at once — the view
 * redraws — but the note is only written when the person says so: "Save view"
 * writes them into this view, "Save as new view…" into a new one, and "Reset"
 * drops them. That is Notion's model, and it is what lets a view be explored
 * without being changed for everyone who opens it next.
 *
 * Edits are kept as a patch over the saved settings, holding only what differs:
 * putting a filter back the way it was leaves nothing to save.
 */

import { asCalendarRange, type CalendarRange } from '../calendar/calendar-range.ts';
import { asFilters, asName, asSorts, asStrings } from './frontmatter-query.ts';
import {
  isSavedView,
  parseSavedView,
  savedViewFrontmatter,
  subGroupOf,
  VIEW_LAYOUTS,
  type ViewLayout,
} from './saved-view.ts';
import type { QueryFilter, QuerySort } from './view-query.ts';

/** What the toolbar can change about a view. */
export interface ViewSettings {
  readonly columns: readonly string[];
  readonly filters: readonly QueryFilter[];
  readonly sorts: readonly QuerySort[];
  readonly groupBy: string | null;
  /** What each group is split by in turn: a board's swimlanes, a table's sub-groups. */
  readonly subGroupBy: string | null;
  /** How the view is drawn; a note that names none, or one unknown, is a table. */
  readonly layout: ViewLayout;
  /** The date a calendar places notes on. */
  readonly dateKey: string | null;
  /** The date a timeline bar starts on. */
  readonly startKey: string | null;
  /** How much a calendar shows at once: month, week, 3day, day or agenda. */
  readonly calendarRange: CalendarRange;
}

/** The settings that differ from the saved ones. Empty: nothing to save. */
export type ViewEdits = Partial<ViewSettings>;

const SETTING_KEYS: readonly (keyof ViewSettings)[] = [
  'columns',
  'filters',
  'sorts',
  'groupBy',
  'subGroupBy',
  'layout',
  'dateKey',
  'startKey',
  'calendarRange',
];

/** Keys a copy does not take from the view it was saved from. */
const NOT_COPIED: readonly string[] = ['favorite', 'description'];

/** The toolbar's settings as the view note declares them, or null for a note that is not a type view. */
export function viewSettingsOf(
  frontmatter: Readonly<Record<string, unknown>>,
): ViewSettings | null {
  const query = parseSavedView(frontmatter);
  if (query === null) return null;
  return {
    columns: query.columns,
    filters: query.filters,
    sorts: query.sorts,
    groupBy: asName(frontmatter['groupBy']),
    // As drawn: a sub-grouping equal to the grouping splits nothing, so it is none.
    subGroupBy: subGroupOf(asName(frontmatter['groupBy']), asName(frontmatter['subGroupBy'])),
    layout: asLayout(frontmatter['layout']),
    dateKey: asName(frontmatter['dateKey']),
    startKey: asName(frontmatter['startKey']),
    calendarRange: asCalendarRange(frontmatter['calendarRange']),
  };
}

/** A layout as written: one the app knows, else a table — which is what one it does not know draws as. */
function asLayout(value: unknown): ViewLayout {
  const declared = String(value ?? '').trim();
  return VIEW_LAYOUTS.find((layout) => layout === declared) ?? 'table';
}

/**
 * The edits after one more change. A setting changed back to what the note
 * says is no longer an edit.
 */
export function editView(saved: ViewSettings, edits: ViewEdits, change: ViewEdits): ViewEdits {
  const next: Record<string, unknown> = { ...edits, ...change };
  for (const key of SETTING_KEYS) {
    if (key in next && sameSetting(key, next[key], saved[key])) delete next[key];
  }
  return next as ViewEdits;
}

/** Whether anything is waiting to be saved. */
export function hasViewEdits(edits: ViewEdits): boolean {
  return SETTING_KEYS.some((key) => key in edits);
}

/**
 * Edits that still differ from the note, after the note itself changed — a
 * save, or an edit in another pane. A setting the note now agrees with is done.
 */
export function remainingEdits(saved: ViewSettings, edits: ViewEdits): ViewEdits {
  return editView(saved, edits, {});
}

/**
 * The frontmatter as the view is drawn: the note's, with the edits laid over
 * it in the note's own shape, so the parsers the view already uses read it.
 */
export function editedFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
  edits: ViewEdits,
): Record<string, unknown> {
  return { ...frontmatter, ...viewEditChanges(edits) };
}

/**
 * The edits as a frontmatter write: only the keys that changed, in the form the
 * view parser reads. A grouping taken away is a key removed.
 */
export function viewEditChanges(edits: ViewEdits): Record<string, unknown> {
  const written = savedViewFrontmatter({
    type: '',
    columns: edits.columns ?? [],
    filters: edits.filters ?? [],
    sorts: edits.sorts ?? [],
    limit: 0,
  });
  const changes: Record<string, unknown> = {};
  if (edits.columns !== undefined) changes['columns'] = written['columns'];
  if (edits.filters !== undefined) changes['filters'] = written['filters'];
  if (edits.sorts !== undefined) changes['sorts'] = written['sorts'];
  if (edits.groupBy !== undefined) changes['groupBy'] = edits.groupBy;
  if (edits.subGroupBy !== undefined) changes['subGroupBy'] = edits.subGroupBy;
  if (edits.layout !== undefined) changes['layout'] = edits.layout;
  if (edits.dateKey !== undefined) changes['dateKey'] = edits.dateKey;
  if (edits.startKey !== undefined) changes['startKey'] = edits.startKey;
  if (edits.calendarRange !== undefined) changes['calendarRange'] = edits.calendarRange;
  return changes;
}

/**
 * The frontmatter of a new view saved from this one with its edits: the same
 * view, changed, and without what only belonged to the original — its star,
 * and the description that explained it. A removed grouping is left out.
 */
export function viewCopyFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
  edits: ViewEdits,
): Record<string, unknown> {
  if (!isSavedView(frontmatter)) return {};
  const copy = editedFrontmatter(frontmatter, edits);
  for (const key of NOT_COPIED) delete copy[key];
  if (copy['groupBy'] === null) delete copy['groupBy'];
  if (copy['subGroupBy'] === null) delete copy['subGroupBy'];
  return copy;
}

function sameSetting(key: keyof ViewSettings, left: unknown, right: unknown): boolean {
  return JSON.stringify(normalised(key, left)) === JSON.stringify(normalised(key, right));
}

function normalised(key: keyof ViewSettings, value: unknown): unknown {
  switch (key) {
    case 'columns':
      return asStrings(value);
    case 'filters':
      return asFilters(value);
    case 'sorts':
      return asSorts(value);
    case 'groupBy':
    case 'subGroupBy':
    case 'dateKey':
    case 'startKey':
      return asName(value);
    case 'layout':
      return asLayout(value);
    case 'calendarRange':
      return asCalendarRange(value);
  }
}

/** The columns with this property shown if it was hidden, or hidden if it was shown. */
export function toggleColumn(columns: readonly string[], key: string): string[] {
  return columns.includes(key) ? columns.filter((column) => column !== key) : [...columns, key];
}

/** The columns with this one moved one place earlier (-1) or later (+1); unchanged at an end. */
export function moveColumn(columns: readonly string[], key: string, by: -1 | 1): string[] {
  const from = columns.indexOf(key);
  const to = from + by;
  if (from === -1 || to < 0 || to >= columns.length) return [...columns];
  const moved = [...columns];
  moved.splice(from, 1);
  moved.splice(to, 0, key);
  return moved;
}

/**
 * The edit a new grouping makes, given the sub-grouping the view draws.
 * Taking the grouping away takes its sub-grouping with it, and grouping by
 * what was the sub-grouping leaves nothing to split by — either way the note
 * is not left naming a sub-grouping it no longer uses. A view that draws none
 * may still name one it does not draw (`subGroupBy` equal to `groupBy`), which
 * a new grouping would bring to life unasked, so that one goes too.
 */
export function groupingEdit(subGroupBy: string | null, groupBy: string | null): ViewEdits {
  return groupBy === null || subGroupBy === null || groupBy === subGroupBy
    ? { groupBy, subGroupBy: null }
    : { groupBy };
}

/** The sorts after a column heading is clicked: sorted by it, then the other way, then not at all. */
export function toggledSorts(sorts: readonly QuerySort[], column: string): QuerySort[] {
  const current = sorts.find((sort) => sort.key === column);
  if (current === undefined) return [{ key: column, direction: 'asc' }];
  return current.direction === 'asc' ? [{ key: column, direction: 'desc' }] : [];
}
