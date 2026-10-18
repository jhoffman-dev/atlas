import { useMemo, useState, type ReactNode } from 'react';
import {
  countLabel,
  groupTotals,
  humanizeKey,
  newNoteLabel,
  tableArrangement,
  toBoardRows,
  type BoardRow,
  type GroupLine,
  type PropertyKind,
  type QuerySort,
} from '@atlas/domain';
import type { DoneTicks } from './done-checkbox.tsx';
import { FlatRows } from './flat-rows.tsx';
import {
  GroupedRows,
  rowOrder,
  useGroupLines,
  type LinePlace,
  type TableGrouping,
} from './grouped-rows.tsx';
import { Icon } from './icon.tsx';
import { SelectAllBox, type RowSelection } from './row-selection.tsx';
import { useSteadyCallback } from './steady-callback.ts';
import { sameEntries, sameItems, useSteadyValue } from './steady-value.ts';
import { leadCellCount, TableRow, TITLE, type RowLook } from './table-cells.tsx';

export interface TableResult {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
  readonly truncated: boolean;
  readonly sql: string;
}

/** What the table knows about the view's type, to head and fill its columns. */
export interface TableSchema {
  /** The declared kind of each property. */
  readonly kinds: Readonly<Record<string, PropertyKind>>;
  /** The declared label of each property; a key without one is humanised. */
  readonly labels: Readonly<Record<string, string>>;
  /** The type's name, for "New task" and "177 tasks". */
  readonly noun: string;
}

const NO_SCHEMA: TableSchema = { kinds: {}, labels: {}, noun: '' };

/** What the index hands back beside the properties, which are not columns to read. */
const HIDDEN_COLUMNS: readonly string[] = ['path', 'summary'];

export interface TableViewProps {
  readonly result: TableResult | null;
  readonly sorts: readonly QuerySort[];
  readonly error: string | null;
  readonly schema?: TableSchema;
  readonly onOpenNote: (path: string) => void;
  /** Left out, the cells are read-only: a SQL result's columns need not be properties. */
  readonly onEditCell?: (args: { path: string; column: string; value: string }) => void;
  readonly onToggleSort: (column: string) => void;
  /** Adds a note of the view's type; the footer offers it when given. */
  readonly onNewNote?: () => void;
  /** Given when the view's type can be ticked done: each row leads with a box. */
  readonly ticks?: DoneTicks;
  /** Columns the result carries for the layout's sake, not the view's — a status a box reads. */
  readonly hiddenColumns?: readonly string[];
  /** Given while rows can be chosen: each row leads with a box to choose it by. */
  readonly selection?: RowSelection;
  /** Given while the view groups: its rows drawn under group header rows. */
  readonly grouping?: TableGrouping;
}

/**
 * A view's results as a table.
 *
 * Editing a cell changes that note's frontmatter — the table is a way of looking
 * at the files, not a place data lives. The SQL behind it is one "Show SQL"
 * away, in the page's "…" menu.
 */
export function TableView({
  result,
  sorts,
  error,
  schema = NO_SCHEMA,
  onOpenNote,
  onEditCell,
  onToggleSort,
  onNewNote,
  ticks,
  hiddenColumns = [],
  selection,
  grouping,
}: TableViewProps) {
  if (error !== null) {
    return (
      <p className="table__error" role="alert">
        {error}
      </p>
    );
  }
  if (result === null) return <p className="table__empty">Running…</p>;
  return (
    <TableSheet
      result={result}
      sorts={sorts}
      schema={schema}
      onOpenNote={onOpenNote}
      onToggleSort={onToggleSort}
      hiddenColumns={hiddenColumns}
      {...(onEditCell !== undefined && { onEditCell })}
      {...(onNewNote !== undefined && { onNewNote })}
      {...(ticks !== undefined && { ticks })}
      {...(selection !== undefined && { selection })}
      {...(grouping !== undefined && { grouping })}
    />
  );
}

/** The sheet itself, once there is a result to draw. */
function TableSheet({
  result,
  sorts,
  schema,
  onOpenNote,
  onEditCell,
  onToggleSort,
  onNewNote,
  ticks,
  hiddenColumns,
  selection,
  grouping,
}: Omit<TableViewProps, 'result' | 'error' | 'schema' | 'hiddenColumns'> & {
  result: TableResult;
  schema: TableSchema;
  hiddenColumns: readonly string[];
}) {
  // State, not a ref: the rows' virtualiser looks for its scroller in a
  // layout effect, which runs before the sheet's ref is set. With a ref it
  // found none, and drew a guessed screenful that scrolling never moved,
  // until something else happened to draw the table again.
  const [sheet, setSheet] = useState<HTMLDivElement | null>(null);

  const pathAt = result.columns.indexOf('path');
  // The path names a row and the summary is a card's aid; neither is a column.
  const shown = useSteadyValue(
    result.columns.filter(
      (column) => !HIDDEN_COLUMNS.includes(column) && !hiddenColumns.includes(column),
    ),
    sameItems,
  );
  const paths = pathAt === -1 ? [] : result.rows.map((row) => String(row[pathAt] ?? ''));
  // Once per result: the window draws the open table again for whatever else
  // happens in it — every key typed in ⌘K — and a table can hold hundreds (#217).
  const { columns, rows: read } = result;
  const rows = useMemo(() => toBoardRows({ columns, rows: read }), [columns, read]);
  const grouped = grouping !== undefined && grouping.groups.length > 0;
  const lines = useGroupLines(grouped ? grouping : undefined);
  const look = useRowLook({
    shown,
    kinds: useSteadyValue(schema.kinds, sameEntries),
    onOpenNote,
    onEditCell,
    ticks,
    selection,
    // Read on a shift-click only, so the rows are not drawn again for it.
    order: () => (grouped ? rowOrder(lines) : rows.map((row) => row.path)),
  });

  return (
    <div className="table">
      <div className="table__sheet" ref={setSheet}>
        {result.rows.length === 0 ? (
          <p className="table__empty">Nothing matches this view yet.</p>
        ) : (
          <TableGrid
            head={
              <TableHead
                columns={shown}
                sorts={sorts}
                schema={schema}
                onToggleSort={onToggleSort}
                ticked={ticks !== undefined}
                choose={
                  selection === undefined ? null : (
                    <SelectAllBox paths={paths} selection={selection} />
                  )
                }
              />
            }
            rows={rows}
            lines={lines}
            look={look}
            noun={schema.noun}
            scroller={sheet}
            {...(ticks !== undefined && { ticks })}
            {...(selection !== undefined && { selection })}
            {...(grouped && { grouping })}
          />
        )}
      </div>
      <TableFooter
        result={result}
        sorts={sorts}
        schema={schema}
        grouping={grouped ? grouping : undefined}
        {...(onNewNote !== undefined && { onNewNote })}
      />
    </div>
  );
}

/**
 * The 30px footer (Table.dc.html): how many rows, how many in each group,
 * and how the table is arranged — "Grouped by status · sorted by phase".
 */
function TableFooter({
  result,
  sorts,
  schema,
  grouping,
  onNewNote,
}: {
  result: TableResult;
  sorts: readonly QuerySort[];
  schema: TableSchema;
  grouping: TableGrouping | undefined;
  onNewNote?: () => void;
}) {
  const label = (key: string) => columnLabel(key, schema);
  const groupedBy = grouping?.groups[0]?.field;
  const arrangement = tableArrangement({
    groupedBy: groupedBy === undefined ? null : label(groupedBy),
    sortedBy: sorts.map((sort) => ({ label: label(sort.key), direction: sort.direction })),
  });
  return (
    <footer className="table__footer">
      {onNewNote !== undefined && (
        <button type="button" className="table__new" onClick={onNewNote}>
          <Icon name="plus" size={14} />
          {newNoteLabel(schema.noun)}
        </button>
      )}
      <span className="table__count">
        {countLabel({ count: result.rows.length, noun: schema.noun })}
        {result.truncated && ' (more were left out)'}
      </span>
      {grouping !== undefined &&
        groupTotals(grouping.groups).map((total, at) => (
          // By place: two groups can read the same ("Done" and "done").
          <span key={at} className="table__total">
            {total}
          </span>
        ))}
      {arrangement !== null && <span className="table__arrangement">{arrangement}</span>}
    </footer>
  );
}

/** A column's heading: "Name" for the title, else the label its type declares, else its key humanised. */
function columnLabel(column: string, schema: TableSchema): string {
  return column === TITLE ? 'Name' : (schema.labels[column] ?? humanizeKey(column));
}

/**
 * What every row shares, the same object from one render to the next while
 * the columns and what can be done stay the same: the window draws the open
 * table again for every key typed in ⌘K, each time with handlers made anew,
 * and a new look would draw every row again for it (#238).
 */
function useRowLook({
  shown,
  kinds,
  onOpenNote,
  onEditCell,
  ticks,
  selection,
  order,
}: {
  shown: readonly string[];
  kinds: RowLook['kinds'];
  onOpenNote: TableViewProps['onOpenNote'];
  onEditCell: TableViewProps['onEditCell'];
  ticks: DoneTicks | undefined;
  selection: RowSelection | undefined;
  /** The rows' paths in the order the table shows them, for a shift-click's range. */
  order: () => readonly string[];
}): RowLook {
  const open = useSteadyCallback(onOpenNote);
  const edit = useSteadyCallback((args: { path: string; column: string; value: string }) =>
    onEditCell?.(args),
  );
  const tick = useSteadyCallback((args: { path: string; done: boolean }) => ticks?.onToggle(args));
  const choose = useSteadyCallback((path: string, how: { readonly shift: boolean }) => {
    if (how.shift) selection?.onToggle(path, { order: order() });
    else selection?.onToggle(path);
  });
  const editable = onEditCell !== undefined;
  const ticked = ticks !== undefined;
  const choosing = selection !== undefined;
  return useMemo(
    () => ({
      shown,
      kinds,
      onOpenNote: open,
      onEditCell: editable ? edit : undefined,
      onTick: ticked ? tick : undefined,
      onChoose: choosing ? choose : undefined,
    }),
    [shown, kinds, open, edit, tick, choose, editable, ticked, choosing],
  );
}

/**
 * The table: its heading row, then the rows, flat or under their groups'
 * header rows. It says how many rows it has, since only those near the
 * window are in the page.
 */
function TableGrid({
  head,
  rows,
  lines,
  look,
  noun,
  scroller,
  ticks,
  selection,
  grouping,
}: {
  head: ReactNode;
  rows: readonly BoardRow[];
  /** The lines `useGroupLines` worked out, while the table groups. */
  lines: readonly GroupLine[];
  look: RowLook;
  noun: string;
  scroller: HTMLElement | null;
  ticks?: DoneTicks;
  selection?: RowSelection;
  grouping?: TableGrouping;
}) {
  // Each row is told whether it is done and chosen, rather than handed the
  // sets: a tick or a choice then draws the one row it changed.
  const row = (found: BoardRow, place: LinePlace) => (
    <TableRow
      key={found.path}
      path={found.path}
      values={found.values}
      look={look}
      done={ticks?.isDone(found.values) === true}
      chosen={selection?.selected.has(found.path) === true}
      index={place.index}
      measure={place.measure}
    />
  );
  const lead = leadCellCount(look);
  return (
    <table
      className={grouping !== undefined ? 'table__grid table__grid--grouped' : 'table__grid'}
      aria-rowcount={(grouping !== undefined ? lines.length : rows.length) + 1}
    >
      {head}
      {grouping !== undefined ? (
        <GroupedRows
          grouping={grouping}
          lines={lines}
          columns={look.shown.map((key) => ({ key, kind: look.kinds[key] }))}
          lead={lead}
          noun={noun}
          newLabel={newNoteLabel(noun)}
          renderRow={row}
          scroller={scroller}
        />
      ) : (
        <FlatRows
          rows={rows}
          width={lead + look.shown.length}
          renderRow={row}
          scroller={scroller}
        />
      )}
      <tfoot>
        {/* Room under the last row, so it scrolls clear of the floating "+". */}
        <tr className="table__room" aria-hidden="true">
          <td colSpan={lead + look.shown.length} />
        </tr>
      </tfoot>
    </table>
  );
}

function TableHead({
  columns,
  sorts,
  schema,
  onToggleSort,
  ticked,
  choose,
}: {
  columns: readonly string[];
  sorts: readonly QuerySort[];
  schema: TableSchema;
  onToggleSort: (column: string) => void;
  /** Rows lead with a done box, which needs a heading cell of its own. */
  ticked: boolean;
  /** The box that chooses every row, while rows can be chosen. */
  choose: ReactNode;
}) {
  return (
    <thead>
      <tr>
        {choose !== null && <th className="table__choose">{choose}</th>}
        {ticked && (
          <th className="table__done">
            <span className="visually-hidden">Done</span>
          </th>
        )}
        {columns.map((column) => {
          const sort = sorts.find((candidate) => candidate.key === column);
          const label = columnLabel(column, schema);
          // ARIA allows one aria-sort per table: the primary sort's heading carries it.
          const primary = sort !== undefined && sort === sorts[0];
          return (
            <th
              key={column}
              className={column === TITLE ? 'table__name-head' : undefined}
              aria-sort={
                !primary || sort === undefined
                  ? undefined
                  : sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
              }
            >
              <button
                type="button"
                className={
                  sort === undefined ? 'table__heading' : 'table__heading table__heading--sorted'
                }
                onClick={() => onToggleSort(column)}
                title={`Sort by ${label}`}
              >
                {label}
                {sort !== undefined && (
                  <Icon
                    name="up"
                    size={11}
                    className={
                      sort.direction === 'desc' ? 'table__sort table__sort--desc' : 'table__sort'
                    }
                  />
                )}
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}
