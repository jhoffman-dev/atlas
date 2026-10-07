/**
 * A query's rows in groups, and each group in sub-groups (ADR-0019, P24-03).
 *
 * Grouping is the board's rule ({@link groupRows}) applied once per level: a
 * select's groups come in the order its type declares them, a relation's are
 * named for the note it points at, and the rows without a value come last.
 */

import type { StatusTone } from '../page/status-tone.ts';
import {
  groupingKey,
  groupRows,
  type BoardColumn,
  type BoardRow,
  type GroupingKind,
} from '../query/group-rows.ts';
import { noteNames, type NoteNames } from '../types/relation-names.ts';
import type { FieldKind, QueryField } from './fields.ts';

export interface RowGroup {
  /** Stable across runs, and unique among all the groups: what a collapsed header is remembered by. */
  readonly id: string;
  /** The field it groups by, as a query names it: what a note added to it is given. */
  readonly field: string;
  /** That field's kind, which says how a note added to the group is given its value. */
  readonly kind: FieldKind;
  readonly label: string;
  /** The value a row in it holds, or null for the rows with none. */
  readonly value: string | null;
  readonly tone: StatusTone | null;
  readonly rows: readonly BoardRow[];
  /** The next level's groups; empty at the last level. */
  readonly subgroups: readonly RowGroup[];
}

/**
 * A field to group by; when the query sorts by it, which way its groups run;
 * and the tones its type chose for its options, which its pills are drawn in.
 */
export type GroupedBy = QueryField & {
  readonly direction?: 'asc' | 'desc';
  readonly colors?: Readonly<Record<string, StatusTone>>;
};

/** The kinds whose groups are drawn as the pills their values are drawn as. */
const TONED: readonly FieldKind[] = ['select', 'multiSelect'];

export function groupResultRows({
  rows,
  groups,
  names = noteNames(null),
  keepEmpty = false,
}: {
  rows: readonly BoardRow[];
  /** The fields to group by, then sub-group by. */
  groups: readonly GroupedBy[];
  names?: NoteNames;
  /**
   * Whether a declared value no row has still gets its group at the top level
   * — a board's empty column — rather than being left out, as a list leaves it.
   */
  keepEmpty?: boolean;
}): RowGroup[] {
  return level({ rows, groups, names, keepEmpty, parent: '' });
}

function level({
  rows,
  groups,
  names,
  keepEmpty,
  parent,
}: {
  rows: readonly BoardRow[];
  groups: readonly GroupedBy[];
  names: NoteNames;
  keepEmpty: boolean;
  parent: string;
}): RowGroup[] {
  const [field, ...rest] = groups;
  if (field === undefined) return [];
  const columns =
    field.kind === 'checkbox'
      ? checkboxColumns(rows, field.text)
      : inValueOrder(
          field,
          groupRows({
            rows,
            groupBy: field.text,
            options: field.options,
            grouping: groupingOf(field),
            colors: field.colors ?? {},
            names,
          }),
        );
  return columns
    .filter((column) => keepEmpty || column.rows.length > 0)
    .map((column) => {
      // Named, not spelled: [[Atlas]] and [[atlas]] are one group whichever came first.
      // Quoted, so a value holding `/` can never read as a group and its sub-group.
      const id = `${parent}/${JSON.stringify([field.text, column.value === null ? null : groupName(field, column.label)])}`;
      return {
        id,
        field: field.text,
        kind: field.kind,
        label: column.label,
        value: column.value,
        // Only a choice from a list is a pill; a number, a date or a word is a plain heading.
        tone: TONED.includes(field.kind) ? (column.tone ?? null) : null,
        rows: column.rows,
        subgroups: level({ rows: column.rows, groups: rest, names, keepEmpty: false, parent: id }),
      };
    });
}

/**
 * Ticked, then unticked — which is anything but `true`, a note that never had
 * the box included, as `flagged = false` reads it (ADR-0019).
 */
function checkboxColumns(rows: readonly BoardRow[], key: string): BoardColumn[] {
  const ticked = rows.filter((row) => groupKeyOf(CHECKBOX, row.values[key]) === 'true');
  const isTicked = new Set(ticked);
  const unticked = rows.filter((row) => !isTicked.has(row));
  return [
    { value: 'true', label: 'true', rows: ticked, tone: null },
    { value: 'false', label: 'false', rows: unticked, tone: null },
  ];
}

const CHECKBOX = { kind: 'checkbox' } as const;

/**
 * The key of the group a value puts a row in, at a level grouping by a field
 * of this kind — the one rule a board's columns are drawn by and a card's move
 * is checked against. A box is `true` when ticked and `false` otherwise, a
 * missing one included; a relation is its first linked note's name, however
 * the link is spelled; anything else its text, trimmed and composed. Null is
 * "No value".
 */
export function groupKeyOf(field: Pick<QueryField, 'kind'>, raw: unknown): string | null {
  if (field.kind === 'checkbox') return String(raw) === 'true' ? 'true' : 'false';
  if (raw === null || raw === undefined) return null;
  return groupingKey(groupingOf(field), String(raw));
}

/**
 * A select's declared options first, in the type's order; then every other
 * value in the order of its kind — numbers by size, dates by day, the rest by
 * name. Both run backwards when the query sorts the field descending, as
 * issue #6 asks ("honouring sort direction"); no value is last either way.
 */
function inValueOrder(field: GroupedBy, columns: readonly BoardColumn[]): BoardColumn[] {
  const declared = new Set(field.options);
  const isDeclared = (column: BoardColumn) => column.value !== null && declared.has(column.value);
  const options = columns.filter(isDeclared);
  const others = columns
    .filter((column) => column.value !== null && !isDeclared(column))
    .sort(VALUE_ORDER[field.kind] ?? byLabel);
  if (field.direction === 'desc') {
    options.reverse();
    others.reverse();
  }
  return [...options, ...others, ...columns.filter((column) => column.value === null)];
}

type ColumnOrder = (left: BoardColumn, right: BoardColumn) => number;

const byLabel: ColumnOrder = (left, right) => left.label.localeCompare(right.label);

const byNumber: ColumnOrder = (left, right) =>
  Number(left.value) - Number(right.value) || byLabel(left, right);

/** ISO dates and times sort as text; a space before the time reads as its `T`. */
const byDate: ColumnOrder = (left, right) => {
  const [a, b] = [left.value ?? '', right.value ?? ''].map((value) => value.replace(' ', 'T'));
  return a === b ? 0 : (a as string) < (b as string) ? -1 : 1;
};

const VALUE_ORDER: Partial<Record<FieldKind, ColumnOrder>> = {
  number: byNumber,
  date: byDate,
  modified: byDate,
};

/** What a group is known by: a relation's note, whatever case the link was written in. */
function groupName(field: QueryField, label: string): string {
  return field.kind === 'relation' ? label.toLowerCase() : label;
}

function groupingOf(field: Pick<QueryField, 'kind'>): GroupingKind {
  return field.kind === 'relation' ? 'relation' : 'option';
}
