import { useRef, type ReactNode, type RefObject } from 'react';
import {
  columnIcon,
  countLabel,
  humanizeKey,
  newNoteLabel,
  toBoardRows,
  type PropertyKind,
  type QuerySort,
} from '@atlas/domain';
import type { DoneTicks } from './done-checkbox.tsx';
import { GroupedRows, type LinePlace, type TableGrouping } from './grouped-rows.tsx';
import { Icon, propertyGlyph } from './icon.tsx';
import { SelectAllBox, type RowSelection } from './row-selection.tsx';
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
  const sheet = useRef<HTMLDivElement>(null);

  const pathAt = result.columns.indexOf('path');
  // The path names a row and the summary is a card's aid; neither is a column.
  const shown = result.columns.filter(
    (column) => !HIDDEN_COLUMNS.includes(column) && !hiddenColumns.includes(column),
  );
  const paths = pathAt === -1 ? [] : result.rows.map((row) => String(row[pathAt] ?? ''));
  const look: RowLook = { shown, kinds: schema.kinds, onOpenNote, onEditCell, ticks, selection };

  return (
    <div className="table">
      <div className="table__sheet" ref={sheet}>
        {result.rows.length === 0 ? (
          <p className="table__empty">Nothing matches this view yet.</p>
        ) : (
          <table className="table__grid">
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
            <TableBody
              result={result}
              look={look}
              noun={schema.noun}
              scroller={sheet}
              {...(grouping !== undefined && { grouping })}
            />
          </table>
        )}
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
        </footer>
      </div>
    </div>
  );
}

/** The rows, flat or under their groups' header rows. */
function TableBody({
  result,
  look,
  noun,
  scroller,
  grouping,
}: {
  result: TableResult;
  look: RowLook;
  noun: string;
  scroller: RefObject<HTMLDivElement | null>;
  grouping?: TableGrouping;
}) {
  const rows = toBoardRows({ columns: result.columns, rows: result.rows });
  const row = (found: (typeof rows)[number], place?: LinePlace) => (
    <TableRow
      key={found.path}
      path={found.path}
      values={found.values}
      look={look}
      {...(place !== undefined && { index: place.index, measure: place.measure })}
    />
  );
  if (grouping === undefined || grouping.groups.length === 0) {
    return <tbody>{rows.map((found) => row(found))}</tbody>;
  }
  return (
    <GroupedRows
      grouping={grouping}
      columns={look.shown.map((key) => ({ key, kind: look.kinds[key] }))}
      lead={leadCellCount(look)}
      noun={noun}
      newLabel={newNoteLabel(noun)}
      renderRow={row}
      scroller={scroller}
    />
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
          const kind = schema.kinds[column];
          const label = column === TITLE ? 'Name' : (schema.labels[column] ?? humanizeKey(column));
          return (
            <th
              key={column}
              aria-sort={
                sort === undefined
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
                <Icon
                  name={propertyGlyph(
                    columnIcon(kind === undefined ? { key: column } : { key: column, kind }),
                  )}
                  size={14}
                />
                {label}
                {sort !== undefined && (
                  <Icon
                    name="up"
                    size={12}
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
