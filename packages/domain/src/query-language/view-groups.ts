/**
 * A saved view's groups and sub-groups, by the same rule a query's are drawn
 * by (ADR-0019): one grouping model, whether the levels came from a view's
 * `groupBy` / `subGroupBy` or a query's `GROUP BY … THEN …`.
 *
 * Also what a group header says about its rows (a sum, a count ticked), what a
 * note added inside a group is given, and the table's groups laid out as the
 * one list of header, row and "+ New" lines it scrolls through.
 */

import { formatAggregate } from '../query/aggregate.ts';
import type { BoardRow } from '../query/group-rows.ts';
import type { ViewDisplay } from '../query/saved-view.ts';
import { drawsGroups } from '../query/view-layout.ts';
import type { QuerySort } from '../query/view-query.ts';
import type { ObjectType, PropertyKind } from '../types/property-def.ts';
import { groupRefusal } from './check.ts';
import { propertyField, type FieldKind, type QueryField } from './fields.ts';
import { groupResultRows, type GroupedBy, type RowGroup } from './result-groups.ts';

/** A property offered in the Group control, and why it cannot be chosen when it cannot. */
export interface GroupChoice {
  readonly key: string;
  readonly label: string;
  /** Why a note cannot sit in one group of it; null when it can. */
  readonly reason: string | null;
}

/** A picture, not a value: there is nothing to group pictures by. */
const NEVER_GROUPED: readonly PropertyKind[] = ['thumbnail'];

/**
 * Every property a view of this type could group by, in the order the type
 * declares them. A field holding several values is listed with the reason it
 * cannot be chosen, rather than left out to be wondered about.
 */
export function groupChoices(type: ObjectType | null): GroupChoice[] {
  return (type?.properties ?? [])
    .filter((property) => !NEVER_GROUPED.includes(property.kind))
    .map((property) => {
      const field = propertyField(property);
      return { key: property.key, label: property.label, reason: groupRefusal(field) };
    });
}

/**
 * The levels a view groups by: its grouping, then its sub-grouping. Each runs
 * the way the view sorts that property, and a relation's groups are the notes
 * it can point at (`related`), so a project with nothing in it yet still has a
 * board column. A key the type does not declare groups as written text. A
 * field that holds several values groups nothing — a note has no one column
 * or lane in it, and a move into one would overwrite the list — so a grouping
 * by one is no grouping at all, and a sub-grouping by one is dropped.
 */
export function viewGroupLevels({
  type,
  groupBy,
  subGroupBy,
  sorts,
  related = {},
}: {
  type: ObjectType | null;
  groupBy: string | null;
  subGroupBy: string | null;
  sorts: readonly QuerySort[];
  /** For a relation's key: the links to every note it can point at. */
  related?: Readonly<Record<string, readonly string[]>>;
}): GroupedBy[] {
  if (groupBy === null) return [];
  const level = (key: string): GroupedBy => {
    const property = type?.properties.find((candidate) => candidate.key === key);
    const field: QueryField =
      property === undefined ? undeclaredField(key) : propertyField(property);
    const direction = sorts.find((sort) => sort.key === key)?.direction;
    return {
      ...field,
      options: field.kind === 'relation' ? (related[key] ?? []) : field.options,
      ...(direction !== undefined && { direction }),
      ...(property?.colors !== undefined && { colors: property.colors }),
    };
  };
  const first = level(groupBy);
  if (groupRefusal(first) !== null) return [];
  if (subGroupBy === null || subGroupBy === groupBy) return [first];
  const second = level(subGroupBy);
  return groupRefusal(second) === null ? [first, second] : [first];
}

/**
 * The levels a view's layout draws: a table and a board both (a board's
 * second level is its swimlanes), a gallery only its first — its groups are
 * its columns — and every other layout none. What the app draws and what the
 * API answers and moves cards between are both these.
 */
export function drawnLevels({
  display,
  type,
  sorts,
  related = {},
}: {
  display: Pick<ViewDisplay, 'layout' | 'groupBy' | 'subGroupBy'>;
  type: ObjectType | null;
  sorts: readonly QuerySort[];
  related?: Readonly<Record<string, readonly string[]>>;
}): GroupedBy[] {
  if (!drawsGroups(display.layout)) return [];
  const levels = viewGroupLevels({
    type,
    groupBy: display.groupBy,
    subGroupBy: display.subGroupBy,
    sorts,
    related,
  });
  return display.layout === 'gallery' ? levels.slice(0, 1) : levels;
}

/**
 * The grouping keys a view's query reads for its rows. Only the ones the type
 * declares: the index's view of a type has a column for nothing else, and
 * asking for one it lacks fails the whole query. An undeclared key still
 * groups (as written text, above) — its notes have no value to read, so they
 * gather under "No value".
 */
export function viewGroupKeys({
  type,
  groupBy,
  subGroupBy,
}: {
  type: ObjectType | null;
  groupBy: string | null;
  subGroupBy: string | null;
}): string[] {
  const declared = new Set(type?.properties.map((property) => property.key) ?? []);
  return [groupBy, subGroupBy].filter((key): key is string => key !== null && declared.has(key));
}

function undeclaredField(key: string): QueryField {
  return {
    text: key,
    label: key,
    via: null,
    key,
    kind: 'text',
    options: [],
    target: null,
    many: false,
  };
}

/**
 * A board drawn as columns crossed with swimlanes: the columns are the first
 * level, the lanes the second, and each lane holds the cards of every column
 * that are also in it. Every column runs through every lane, so a card can be
 * dropped into any pairing — even one nothing is in yet.
 */
export interface BoardLane {
  readonly group: RowGroup;
  /** One cell per column, in the columns' order. */
  readonly cells: readonly { readonly column: RowGroup; readonly rows: readonly BoardRow[] }[];
}

export function boardLanes({
  columns,
  lanes,
}: {
  columns: readonly RowGroup[];
  lanes: readonly RowGroup[];
}): BoardLane[] {
  return lanes.map((lane) => {
    const inLane = new Set(lane.rows.map((row) => row.path));
    return {
      group: lane,
      cells: columns.map((column) => ({
        column,
        rows: column.rows.filter((row) => inLane.has(row.path)),
      })),
    };
  });
}

/** A board's columns and, when it sub-groups, its swimlanes — each with its empty values kept. */
export function boardGroups({
  rows,
  levels,
  names,
}: {
  rows: readonly BoardRow[];
  levels: readonly GroupedBy[];
  names?: Parameters<typeof groupResultRows>[0]['names'];
}): { columns: RowGroup[]; lanes: BoardLane[] } {
  const [column, lane] = levels;
  if (column === undefined) return { columns: [], lanes: [] };
  const shared = { rows, keepEmpty: true, ...(names !== undefined && { names }) };
  const columns = groupResultRows({ ...shared, groups: [column] });
  if (lane === undefined) return { columns, lanes: [] };
  return {
    columns,
    lanes: boardLanes({ columns, lanes: groupResultRows({ ...shared, groups: [lane] }) }),
  };
}

/**
 * What a group header says under a column: a number column's sum, a
 * checkbox's count ticked. Null for every other kind, whose rows have nothing
 * to add up — and for a number column with no numbers in it.
 */
export function columnSummary({
  rows,
  key,
  kind,
}: {
  rows: readonly BoardRow[];
  key: string;
  kind: PropertyKind | undefined;
}): string | null {
  if (kind === 'checkbox') {
    const ticked = rows.filter((row) => String(row.values[key]) === 'true').length;
    return `${ticked} checked`;
  }
  if (kind !== 'number') return null;
  const numbers = rows
    .map((row) => row.values[key])
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .map(Number)
    .filter(Number.isFinite);
  if (numbers.length === 0) return null;
  return `Sum ${formatAggregate(
    'sum',
    numbers.reduce((total, value) => total + value, 0),
  )}`;
}

/**
 * The properties a note added inside a group is given: each level's value, so
 * it lands in the group it was added to. "No value" gives nothing, and a field
 * reached through a relation (`project.owner`) is not the note's own to set.
 */
export function groupPrefill(chain: readonly RowGroup[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const group of chain) {
    if (group.field.includes('.')) continue;
    const value = prefillValue(group.kind, group.value);
    if (value !== undefined) values[group.field] = value;
  }
  return values;
}

/**
 * A group's value as its field is written in a new note's frontmatter — a
 * number as a number, a tick as `true` — or undefined when the group gives
 * the note nothing. That is "No value", and the unticked group: it holds
 * every note whose box is not ticked, a note with no box among them
 * (ADR-0019), so a new note lands in it without a `false` nobody chose.
 */
export function prefillValue(kind: FieldKind | undefined, value: string | null): unknown {
  if (value === null) return undefined;
  if (kind === 'checkbox') return value === 'true' ? true : undefined;
  if (kind === 'number') {
    const number = Number(value);
    return value.trim() !== '' && Number.isFinite(number) ? number : value;
  }
  return value;
}

/**
 * A group's value as a card moved into that group is written: typed as
 * {@link prefillValue} types it, except that a move must leave the group it
 * came from — so the unticked group writes `false` and "No value" clears the
 * property (null) rather than giving nothing.
 */
export function movedValue(kind: FieldKind | undefined, value: string | null): unknown {
  if (kind === 'checkbox') return value === 'true';
  return value === null ? null : prefillValue(kind, value);
}

/**
 * The value a note added to one group of a saved view is given, as the
 * property to write — typed by the property's kind, as a table's "+ New" is.
 * Nothing for no grouping, for no value asked, and for a group that gives a
 * note nothing ({@link prefillValue}).
 */
export function groupValueProperty({
  type,
  key,
  value,
}: {
  type: ObjectType | null;
  key: string | null;
  value: string | null | undefined;
}): Record<string, unknown> {
  if (key === null || value === undefined) return {};
  const kind = type?.properties.find((property) => property.key === key)?.kind;
  const written = prefillValue(kind, value);
  return written === undefined ? {} : { [key]: written };
}

/**
 * The values a board's grouping property declares, so its columns read in
 * workflow order. A relation declares none — its columns are the notes it can
 * point at — so it has no first column to add to and no last one meaning done.
 */
export function groupColumnOptions(type: ObjectType | null, key: string | null): readonly string[] {
  const property = type?.properties.find((candidate) => candidate.key === key);
  return property === undefined || property.kind === 'relation' ? [] : property.options;
}

/** One line of a grouped table, in the order it scrolls. */
export type GroupLine =
  | {
      readonly kind: 'group';
      readonly group: RowGroup;
      readonly depth: number;
      readonly collapsed: boolean;
    }
  | { readonly kind: 'row'; readonly row: BoardRow; readonly depth: number }
  /** "+ New" at the foot of an innermost group: `chain` is it and the groups it is in. */
  | { readonly kind: 'new'; readonly chain: readonly RowGroup[]; readonly depth: number };

/**
 * The groups as the lines a table draws: each header, then — unless it is
 * folded shut — its sub-groups, or its rows and a "+ New" under them. A folded
 * group contributes its header and nothing else, so a large one costs nothing.
 */
export function groupLines({
  groups,
  collapsed,
  chain = [],
}: {
  groups: readonly RowGroup[];
  collapsed: ReadonlySet<string>;
  chain?: readonly RowGroup[];
}): GroupLine[] {
  const depth = chain.length;
  return groups.flatMap((group): GroupLine[] => {
    const shut = collapsed.has(group.id);
    const header: GroupLine = { kind: 'group', group, depth, collapsed: shut };
    if (shut) return [header];
    const inside = [...chain, group];
    if (group.subgroups.length > 0) {
      return [header, ...groupLines({ groups: group.subgroups, collapsed, chain: inside })];
    }
    return [
      header,
      ...group.rows.map((row): GroupLine => ({ kind: 'row', row, depth: depth + 1 })),
      { kind: 'new', chain: inside, depth: depth + 1 },
    ];
  });
}
