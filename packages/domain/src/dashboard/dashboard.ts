/**
 * A dashboard, as data.
 *
 * A dashboard is an ordinary note whose frontmatter lists widgets. Each widget
 * is a query and a way of drawing it — the same queries the views run, so there
 * is one query engine and several pictures of it.
 *
 * A widget that cannot be read is dropped and the rest of the board still draws.
 * Losing one tile to a typo is a far better failure than losing the dashboard.
 */

import { AGGREGATE_KINDS, type AggregateKind } from '../query/aggregate.ts';
import { asFilters, asName, asQuery, isRecord } from '../query/frontmatter-query.ts';
import { DEFAULT_QUERY_LIMIT, type QueryFilter, type ViewQuery } from '../query/view-query.ts';
import { normaliseSql } from '../query/sql-query.ts';
import { parseHighlight, type GroupHighlight } from './groups.ts';

/** How a widget draws its query. */
export type WidgetKind =
  'number' | 'hero' | 'list' | 'table' | 'bar' | 'donut' | 'line' | 'rank' | 'sql' | 'query';

export const WIDGET_KINDS: readonly WidgetKind[] = [
  'number',
  'hero',
  'list',
  'table',
  'bar',
  'donut',
  'line',
  'rank',
  'sql',
  'query',
];

/**
 * How a `sql` widget draws its result, read from the result's columns: a
 * number is the first cell; a bar chart is the first column as labels and the
 * second as values; a table is every row.
 */
export type SqlShow = 'table' | 'number' | 'bar';

export const SQL_SHOWS: readonly SqlShow[] = ['table', 'number', 'bar'];

/** A `sql` widget's statement, run as written through the index's read-only path. */
export interface SqlWidgetSpec {
  readonly statement: string;
  readonly show: SqlShow;
}

/** The kinds that count notes per value of a property rather than listing them. */
const COUNTED_KINDS: readonly WidgetKind[] = ['bar', 'donut', 'line', 'rank'];

export function isCountedKind(kind: WidgetKind): boolean {
  return COUNTED_KINDS.includes(kind);
}

/**
 * Which of the keys that only some kinds read this kind reads. The parser and
 * the widget editor both ask this, so the editor never offers a setting the
 * widget would ignore.
 */
export interface KindOptions {
  /** A chart has nothing to draw without a grouping; a hero draws one as a sparkline. */
  readonly groupBy: 'required' | 'optional' | 'none';
  readonly highlight: boolean;
  readonly progress: boolean;
  readonly icon: boolean;
  /** How many rows a list or table shows, or how many groups a ranking does. */
  readonly limit: boolean;
}

export function optionsOfKind(kind: WidgetKind): KindOptions {
  return {
    groupBy: isCountedKind(kind) ? 'required' : kind === 'hero' ? 'optional' : 'none',
    highlight: kind === 'bar' || kind === 'rank' || kind === 'hero',
    progress: kind === 'hero',
    icon: kind === 'number',
    limit: kind === 'rank' || kind === 'list' || kind === 'table',
  };
}

/** The glyphs a number tile may wear. */
export type WidgetIcon = 'bolt' | 'inbox' | 'check' | 'chart' | 'hash' | 'star' | 'task';

export const WIDGET_ICONS: readonly WidgetIcon[] = [
  'bolt',
  'inbox',
  'check',
  'chart',
  'hash',
  'star',
  'task',
];

/** The dashboard is a twelve-column grid; a widget takes 1 to 12 of them. */
export const GRID_COLUMNS = 12;

/** How many ranked rows a `rank` widget shows when it does not say. */
export const DEFAULT_RANK_SIZE = 5;
export const MAX_RANK_SIZE = 20;

/**
 * The part of a hero's total it measures progress by: "166 done" of 177, drawn
 * as a ring. Its filters narrow the widget's own query; they never widen it.
 */
export interface WidgetProgress {
  readonly label: string;
  readonly filters: readonly QueryFilter[];
}

export interface Widget {
  /** Stable across a re-read of the same note, so redraws do not lose state. */
  readonly id: string;
  /**
   * Where the widget sits in the note's `widgets:` list. A widget that cannot
   * be read is not drawn, so this is not always its place on the grid, and an
   * edit has to know which entry of the file it is changing.
   */
  readonly entry: number;
  readonly title: string;
  readonly kind: WidgetKind;
  /** What a widget asks of a type. Null for a `sql` widget, which asks in SQL. */
  readonly query: ViewQuery | null;
  /** A `sql` widget's statement and how it draws. Null for every other kind. */
  readonly sql: SqlWidgetSpec | null;
  /** A `query` widget's Atlas query, as written (ADR-0019). Null for every other kind. */
  readonly atlasQuery: string | null;
  /** Which number a `number` widget shows. Null for every other kind. */
  readonly aggregate: { readonly kind: AggregateKind; readonly column: string | null } | null;
  /**
   * Which property a chart counts by. Required by `bar`, `donut`, `line` and
   * `rank`; optional on a `hero`, which draws it as a sparkline. Null elsewhere.
   */
  readonly groupBy: string | null;
  /** Columns of the twelve-column grid this widget spans. */
  readonly span: number;
  /** Which group a bar chart, ranking or hero calls out. Null: the series' default. */
  readonly highlight: GroupHighlight | null;
  /** A hero's progress ring. Null for every other kind, and for a hero without one. */
  readonly progress: WidgetProgress | null;
  /** A number tile's glyph. Null for every other kind. */
  readonly icon: WidgetIcon | null;
  /** How many rows a `rank` widget shows. Null for every other kind. */
  readonly top: number | null;
}

/** The frontmatter key that marks a note as a dashboard rather than prose. */
export const DASHBOARD_MARKER = 'atlas';
export const DASHBOARD_MARKER_VALUE = 'dashboard';

/** How many widgets one note may hold, so a bad file cannot fire off thousands. */
export const MAX_WIDGETS = 48;

export function isDashboard(frontmatter: Readonly<Record<string, unknown>>): boolean {
  return String(frontmatter[DASHBOARD_MARKER] ?? '').trim() === DASHBOARD_MARKER_VALUE;
}

export function parseDashboard(frontmatter: Readonly<Record<string, unknown>>): Widget[] {
  if (!isDashboard(frontmatter)) return [];

  const declared = frontmatter['widgets'];
  if (!Array.isArray(declared)) return [];

  return declared.slice(0, MAX_WIDGETS).flatMap((item, position) => {
    const widget = parseWidget(item, position);
    return widget === null ? [] : [widget];
  });
}

function parseWidget(source: unknown, position: number): Widget | null {
  if (!isRecord(source)) return null;
  const declared = String(source['kind'] ?? '').trim();
  if (declared === 'sql') return parseSqlWidget(source, position);
  if (declared === 'query') return parseQueryWidget(source, position);

  const query = asQuery(source);
  if (query === null) return null;

  const kind = String(source['kind'] ?? '').trim() as WidgetKind;
  if (!WIDGET_KINDS.includes(kind)) return null;

  const groupBy = asName(source['groupBy']);

  // A chart with nothing to count by has nothing to draw, so it is not a chart.
  if (isCountedKind(kind) && groupBy === null) return null;

  return {
    id: `${position}-${kind}-${query.type}`,
    entry: position,
    title: asName(source['title']) ?? defaultTitle(kind, query.type),
    kind,
    // A ranking sees every group and keeps the top few itself: cut in SQL, the
    // "of" in "96 of 177" would only know the groups that made the cut.
    query: kind === 'rank' ? { ...query, limit: DEFAULT_QUERY_LIMIT } : query,
    sql: null,
    atlasQuery: null,
    aggregate: kind === 'number' ? parseAggregate(source) : null,
    groupBy: optionsOfKind(kind).groupBy === 'none' ? null : groupBy,
    span: spanOf(source, kind),
    ...parseKindOptions(source, kind),
  };
}

/** A `sql` widget: a statement, and one of the three ways to draw it. No statement, no widget. */
function parseSqlWidget(
  source: Readonly<Record<string, unknown>>,
  position: number,
): Widget | null {
  const statement = normaliseSql(String(source['sql'] ?? ''));
  if (statement === '') return null;
  const declared = String(source['show'] ?? '').trim() as SqlShow;
  return {
    id: `${position}-sql`,
    entry: position,
    title: asName(source['title']) ?? defaultTitle('sql', ''),
    kind: 'sql',
    query: null,
    sql: { statement, show: SQL_SHOWS.includes(declared) ? declared : 'table' },
    atlasQuery: null,
    aggregate: null,
    groupBy: null,
    span: spanOf(source, 'sql'),
    highlight: null,
    progress: null,
    icon: null,
    top: null,
  };
}

/**
 * A `query` widget: an Atlas query, drawn as its rows in their groups — the
 * same query a query view runs, so a view can be put on a dashboard as it is.
 * No query, no widget; whether it reads is the query's own check, when it runs.
 */
function parseQueryWidget(
  source: Readonly<Record<string, unknown>>,
  position: number,
): Widget | null {
  const text = source['query'];
  if (typeof text !== 'string' || text.trim() === '') return null;
  return {
    id: `${position}-query`,
    entry: position,
    title: asName(source['title']) ?? defaultTitle('query', ''),
    kind: 'query',
    query: null,
    sql: null,
    atlasQuery: text,
    aggregate: null,
    groupBy: null,
    span: spanOf(source, 'query'),
    highlight: null,
    progress: null,
    icon: null,
    top: null,
  };
}

/** The keys only one or two kinds read. Everything else gets null. */
function parseKindOptions(
  source: Readonly<Record<string, unknown>>,
  kind: WidgetKind,
): Pick<Widget, 'highlight' | 'progress' | 'icon' | 'top'> {
  const options = optionsOfKind(kind);
  return {
    highlight: options.highlight ? parseHighlight(source['highlight']) : null,
    progress: options.progress ? parseProgress(source['progress']) : null,
    icon: options.icon ? parseIcon(source['icon']) : null,
    top: kind === 'rank' ? parseTop(source['limit']) : null,
  };
}

function parseAggregate(source: Readonly<Record<string, unknown>>): {
  kind: AggregateKind;
  column: string | null;
} {
  const declared = String(source['aggregate'] ?? '').trim() as AggregateKind;
  const kind = AGGREGATE_KINDS.includes(declared) ? declared : 'count';
  const column = asName(source['of']);

  // Anything but a count needs something to work over; without it, count is the
  // only honest answer.
  return kind !== 'count' && column === null ? { kind: 'count', column: null } : { kind, column };
}

/**
 * `span` counts grid columns. The older `width` counted thirds of the page and
 * still reads as that many thirds, so a dashboard written before the grid had
 * twelve columns keeps its layout.
 */
export function spanOf(source: Readonly<Record<string, unknown>>, kind: WidgetKind): number {
  const span = numberFrom(source['span']);
  if (Number.isInteger(span) && span >= 1 && span <= GRID_COLUMNS) return span;

  const width = numberFrom(source['width']);
  if (width === 1 || width === 2 || width === 3) return width * (GRID_COLUMNS / 3);

  return defaultSpan(kind);
}

/** A number reads in a quarter of the page; a hero or a ranking in a third; a chart in half. */
export function defaultSpan(kind: WidgetKind): number {
  if (kind === 'number') return 3;
  if (kind === 'hero' || kind === 'rank') return 4;
  return 6;
}

/** Progress needs something to narrow by; a ring of the whole is always full. */
function parseProgress(value: unknown): WidgetProgress | null {
  if (!isRecord(value)) return null;
  const filters = asFilters(value['filters']);
  if (filters.length === 0) return null;
  return { label: asName(value['label']) ?? progressLabel(filters), filters };
}

/** `status is done` reads as "done"; anything subtler as "matching". */
function progressLabel(filters: readonly QueryFilter[]): string {
  const [first] = filters;
  return filters.length === 1 && first?.operator === 'is' && first.value !== undefined
    ? String(first.value)
    : 'matching';
}

function parseIcon(value: unknown): WidgetIcon | null {
  const icon = String(value ?? '').trim() as WidgetIcon;
  return WIDGET_ICONS.includes(icon) ? icon : null;
}

function parseTop(value: unknown): number {
  const top = Math.floor(numberFrom(value));
  return Number.isFinite(top) && top >= 1 ? Math.min(top, MAX_RANK_SIZE) : DEFAULT_RANK_SIZE;
}

/**
 * A count written in the file, or NaN when it is not one. Only a number or the
 * text of one counts: `Number([8])` is 8 and `Number(true)` is 1, and a list or
 * a flag must not pass for a column count.
 */
export function numberFrom(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return Number.NaN;
}

export function defaultTitle(kind: WidgetKind, type: string): string {
  if (kind === 'sql' || kind === 'query') return 'Query';
  return kind === 'number' || kind === 'hero' ? `${type} count` : type;
}
