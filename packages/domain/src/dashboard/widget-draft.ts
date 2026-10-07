/**
 * A widget as the editor holds it, and the way back into the file.
 *
 * The editor works on a draft — plain fields, one per control — and the draft
 * is written back *into the entry it came from*. Keys the editor does not know
 * about stay where they were, with the values they had, so a widget carrying a
 * setting written by hand (`aggregate`, `sorts`, a comment's worth of `label`)
 * keeps it through an edit of its title.
 *
 * Whether a draft is a widget is decided by the parser the dashboard itself
 * uses: the editor's messages explain the common mistakes, and the parser has
 * the last word.
 */

import { asFilters, asName, isRecord } from '../query/frontmatter-query.ts';
import { normaliseSql } from '../query/sql-query.ts';
import type { QueryFilter, ViewQuery } from '../query/view-query.ts';
import {
  DASHBOARD_MARKER,
  DASHBOARD_MARKER_VALUE,
  defaultSpan,
  GRID_COLUMNS,
  MAX_RANK_SIZE,
  numberFrom,
  optionsOfKind,
  parseDashboard,
  spanOf,
  SQL_SHOWS,
  WIDGET_ICONS,
  WIDGET_KINDS,
  type SqlShow,
  type WidgetIcon,
  type WidgetKind,
} from './dashboard.ts';

export interface WidgetDraft {
  /** Blank: the widget is titled after its type, as the parser does. */
  readonly title: string;
  readonly kind: WidgetKind;
  readonly type: string;
  /** Blank: no grouping. */
  readonly groupBy: string;
  readonly filters: readonly QueryFilter[];
  /** Blank: the series' default. Otherwise `last`, `max`, `none` or a group's key. */
  readonly highlight: string;
  readonly icon: WidgetIcon | null;
  /** A hero's progress: the filters that pick out the finished part. */
  readonly progress: readonly QueryFilter[];
  /** Null: the kind's default. */
  readonly limit: number | null;
  readonly span: number;
  /** A `sql` widget's statement. Blank for every other kind. */
  readonly sql: string;
  /** How a `sql` widget draws its result. */
  readonly show: SqlShow;
  /** A `query` widget's Atlas query. Blank for every other kind. */
  readonly atlasQuery: string;
}

/** What each kind is called where a person picks one. */
export const WIDGET_KIND_LABELS: Readonly<Record<WidgetKind, string>> = {
  number: 'Number',
  hero: 'Hero',
  list: 'List',
  table: 'Table',
  bar: 'Bar chart',
  donut: 'Donut',
  line: 'Line',
  rank: 'Ranking',
  sql: 'SQL query',
  query: 'Atlas query',
};

/** A fresh widget of a kind: every setting at the value the parser would give it. */
export function newWidgetDraft({ kind, type }: { kind: WidgetKind; type: string }): WidgetDraft {
  return {
    title: '',
    kind,
    type,
    groupBy: '',
    filters: [],
    highlight: '',
    icon: null,
    progress: [],
    limit: null,
    span: defaultSpan(kind),
    sql: '',
    show: 'table',
    atlasQuery: '',
  };
}

/** A widget that draws the result of a statement — what "Add to dashboard" on the query page makes. */
export function sqlWidgetDraft({
  sql,
  show,
  title,
}: {
  sql: string;
  show: SqlShow;
  title: string;
}): WidgetDraft {
  return { ...newWidgetDraft({ kind: 'sql', type: '' }), sql: normaliseSql(sql), show, title };
}

/** A widget that draws an Atlas query's rows — what "Add to dashboard" on a query makes. */
export function queryWidgetDraft({ query, title }: { query: string; title: string }): WidgetDraft {
  return { ...newWidgetDraft({ kind: 'query', type: '' }), atlasQuery: query, title };
}

/**
 * The draft with another kind. A widget still at its old kind's default width
 * takes the new kind's, since that is what it would have been made at; one
 * resized on purpose keeps its size.
 */
export function withKind(draft: WidgetDraft, kind: WidgetKind): WidgetDraft {
  const span = draft.span === defaultSpan(draft.kind) ? defaultSpan(kind) : draft.span;
  return { ...draft, kind, span };
}

/**
 * The draft counting another type. Its grouping and filters named the old
 * type's properties, so they go: kept, they would ask the new type about
 * properties it may not have.
 */
export function withType(draft: WidgetDraft, type: string): WidgetDraft {
  if (type === draft.type) return draft;
  return { ...draft, type, groupBy: '', filters: [], progress: [] };
}

/**
 * The draft asking what a saved view asks: its type and its filters. A widget
 * is a query drawn a particular way, so a view someone has already narrowed to
 * the notes they care about is the natural place to start one from.
 */
export function fromViewQuery(draft: WidgetDraft, query: ViewQuery): WidgetDraft {
  return { ...withType(draft, query.type), filters: [...query.filters] };
}

/** Reads one entry of `widgets:` into the editor's fields. */
export function draftFromEntry(entry: unknown): WidgetDraft {
  const source = isRecord(entry) ? entry : {};
  const declared = String(source['kind'] ?? '').trim() as WidgetKind;
  const kind = WIDGET_KINDS.includes(declared) ? declared : 'number';
  const progress = isRecord(source['progress']) ? asFilters(source['progress']['filters']) : [];
  const limit = Math.floor(numberFrom(source['limit']));
  const icon = String(source['icon'] ?? '').trim() as WidgetIcon;
  const show = String(source['show'] ?? '').trim() as SqlShow;
  return {
    title: asName(source['title']) ?? '',
    kind,
    type: asName(source['type']) ?? '',
    groupBy: asName(source['groupBy']) ?? '',
    filters: asFilters(source['filters']),
    highlight: asName(source['highlight']) ?? '',
    icon: WIDGET_ICONS.includes(icon) ? icon : null,
    progress,
    limit: Number.isFinite(limit) ? limit : null,
    span: spanOf(source, kind),
    sql: String(source['sql'] ?? ''),
    show: SQL_SHOWS.includes(show) ? show : 'table',
    atlasQuery: typeof source['query'] === 'string' ? source['query'] : '',
  };
}

/**
 * The draft written into the entry it came from — or into a new one.
 *
 * A key whose value still reads the same as the draft's is left exactly as it
 * was written, so `highlight: 15` does not become `highlight: '15'` and a
 * filter carrying a key the editor ignores keeps it. A setting the new kind
 * does not read is taken out, so switching a bar chart to a number does not
 * leave a `groupBy` behind that nothing uses.
 */
export function entryFromDraft(
  draft: WidgetDraft,
  original: unknown = {},
): Record<string, unknown> {
  const before: Readonly<Record<string, unknown>> = isRecord(original) ? original : {};
  const entry: Record<string, unknown> = { ...before };
  const put = (key: string, value: unknown) => {
    if (value === null || value === undefined) delete entry[key];
    else entry[key] = value;
  };
  const options = optionsOfKind(draft.kind);

  put('title', draft.title.trim() === '' ? null : keepIfSame(before['title'], draft.title.trim()));
  put('kind', draft.kind);
  const isSql = draft.kind === 'sql';
  const isQuery = draft.kind === 'query';
  // A statement or a query asks its own question: a type or filters beside it would be ignored.
  put('sql', isSql ? keepIfSame(before['sql'], normaliseSql(draft.sql)) : null);
  put('show', isSql ? draft.show : null);
  put('query', isQuery ? draft.atlasQuery : null);
  put('type', isSql || isQuery ? null : keepIfSame(before['type'], draft.type.trim()));
  put('groupBy', options.groupBy === 'none' ? null : nameOrNull(before['groupBy'], draft.groupBy));
  put('filters', isSql || isQuery ? null : filtersOrNull(before['filters'], draft.filters));
  put('highlight', options.highlight ? nameOrNull(before['highlight'], draft.highlight) : null);
  put('icon', options.icon ? draft.icon : null);
  put('progress', options.progress ? progressEntry(before['progress'], draft.progress) : null);
  if (options.limit) put('limit', draft.limit);
  writeSpan(entry, draft, before);
  return entry;
}

/** The value as written when it reads as the same text, so its YAML is untouched. */
function keepIfSame(written: unknown, wanted: string): unknown {
  return asName(written) === wanted ? written : wanted;
}

function nameOrNull(written: unknown, wanted: string): unknown {
  return wanted.trim() === '' ? null : keepIfSame(written, wanted.trim());
}

function filtersOrNull(written: unknown, wanted: readonly QueryFilter[]): unknown {
  if (wanted.length === 0) return null;
  return sameFilters(asFilters(written), wanted)
    ? written
    : wanted.map((filter) => ({ ...filter }));
}

function sameFilters(left: readonly QueryFilter[], right: readonly QueryFilter[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A hero's progress, keeping the label it was given. */
function progressEntry(written: unknown, filters: readonly QueryFilter[]): unknown {
  if (filters.length === 0) return null;
  const before = isRecord(written) ? written : {};
  return { ...before, filters: filtersOrNull(before['filters'], filters) };
}

/**
 * `span` only when it says something: a widget that never had one and is still
 * its kind's default width stays without. The older `width` goes once `span`
 * is written, since `span` wins and a stale `width` would only mislead.
 */
function writeSpan(
  entry: Record<string, unknown>,
  draft: WidgetDraft,
  before: Readonly<Record<string, unknown>>,
): void {
  const declared = 'span' in before || 'width' in before;
  if (!declared && draft.span === defaultSpan(draft.kind)) return;
  if (declared && spanOf(before, draft.kind) === draft.span) return;
  entry['span'] = draft.span;
  delete entry['width'];
}

/**
 * What is wrong with a draft, in words, or nothing. The first messages say why
 * in terms of the controls; the last word is the dashboard's own parser, so a
 * draft that passes here always draws.
 */
export function widgetProblems(
  draft: WidgetDraft,
  { knownTypes }: { knownTypes?: readonly string[] } = {},
): string[] {
  const problems = explainedProblems(draft, knownTypes);
  if (problems.length > 0) return problems;
  const parsed = parseDashboard({
    [DASHBOARD_MARKER]: DASHBOARD_MARKER_VALUE,
    widgets: [entryFromDraft(draft)],
  });
  return parsed.length === 1 ? [] : ['This widget cannot be read as it stands.'];
}

function explainedProblems(
  draft: WidgetDraft,
  knownTypes: readonly string[] | undefined,
): string[] {
  const problems: string[] = [];
  const options = optionsOfKind(draft.kind);
  const type = draft.type.trim();
  if (draft.kind === 'sql') {
    if (normaliseSql(draft.sql) === '') problems.push('Write the query this widget runs.');
  } else if (draft.kind === 'query') {
    if (draft.atlasQuery.trim() === '') problems.push('Write the query this widget runs.');
  } else if (type === '') problems.push('Choose the type of note this widget counts.');
  else if (knownTypes !== undefined && !knownTypes.includes(type)) {
    problems.push(`There is no type called “${type}”.`);
  }
  if (options.groupBy === 'required' && draft.groupBy.trim() === '') {
    problems.push(
      `A ${WIDGET_KIND_LABELS[draft.kind].toLowerCase()} needs a property to group by.`,
    );
  }
  if (!Number.isInteger(draft.span) || draft.span < 1 || draft.span > GRID_COLUMNS) {
    problems.push(`A widget spans 1 to ${GRID_COLUMNS} columns.`);
  }
  const limitProblem = options.limit ? problemWithLimit(draft) : null;
  if (limitProblem !== null) problems.push(limitProblem);
  return problems;
}

function problemWithLimit({ kind, limit }: WidgetDraft): string | null {
  if (limit === null) return null;
  if (kind === 'rank' && (limit < 1 || limit > MAX_RANK_SIZE)) {
    return `A ranking shows 1 to ${MAX_RANK_SIZE} groups.`;
  }
  return limit < 1 ? 'Show at least one row.' : null;
}
