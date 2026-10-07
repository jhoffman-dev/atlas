import { useRef } from 'react';
import {
  withNoteNames,
  type BoardLane,
  type BoardRow,
  type FieldKind,
  type PropertyKind,
  type RowGroup,
  type ViewLayout,
} from '@atlas/domain';
import { BoardLanes, ColumnHeading } from '../board-lanes.tsx';
import { GroupedRows } from '../grouped-rows.tsx';
import { Icon } from '../icon.tsx';
import { useNoteNames } from '../note-names.tsx';
import { StatusPill } from '../status-pill.tsx';

export interface ResultField {
  readonly key: string;
  readonly label: string;
  /** What it holds, so a group header can add up a number column or count ticked boxes. */
  readonly kind?: FieldKind;
}

export interface GroupedResultProps {
  readonly layout: ViewLayout;
  /** The columns after the name, each with its heading. */
  readonly fields: readonly ResultField[];
  readonly rows: readonly BoardRow[];
  /** The groups and their sub-groups; empty when the query does not group. */
  readonly groups: readonly RowGroup[];
  /** A board's swimlanes, when the query groups THEN by a second field. */
  readonly lanes?: readonly BoardLane[];
  /** The groups folded shut, by id. */
  readonly collapsed: ReadonlySet<string>;
  readonly onToggleGroup: (id: string) => void;
  readonly onOpenNote: (path: string) => void;
}

/**
 * A query's rows as a table, a list or a board, in their groups and
 * sub-groups (P24-03), drawn as a saved view's are (issue #6): a table's
 * groups are header rows with their counts and column summaries, a board's
 * groups are its columns and its sub-groups the swimlanes across them.
 */
export function GroupedResult(props: GroupedResultProps) {
  if (props.rows.length === 0)
    return <p className="table__empty">Nothing matches this query yet.</p>;
  if (props.layout === 'board') return <ResultBoard {...props} />;
  if (props.layout === 'list') return <ResultList {...props} />;
  return <ResultTable {...props} />;
}

function GroupHeading({
  group,
  level,
  collapsed,
  onToggle,
}: {
  group: RowGroup;
  level: 1 | 2;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const count = group.rows.length;
  return (
    <button
      type="button"
      className={`qresult__heading qresult__heading--level-${level}`}
      aria-expanded={!collapsed}
      onClick={onToggle}
    >
      <Icon
        name="chevron"
        size={14}
        className={collapsed ? 'qresult__fold qresult__fold--shut' : 'qresult__fold'}
      />
      {group.tone === null || group.value === null ? (
        <span className="qresult__label">{group.label}</span>
      ) : (
        <StatusPill value={group.value} tone={group.tone} />
      )}
      <span className="qresult__count" aria-label={`${count} ${count === 1 ? 'note' : 'notes'}`}>
        {count}
      </span>
    </button>
  );
}

/** The groups under one heading, or the rows when there are no more levels. */
function Levels({
  groups,
  level,
  shared,
  rows,
}: {
  groups: readonly RowGroup[];
  level: 1 | 2;
  shared: GroupedResultProps;
  rows: (rows: readonly BoardRow[]) => React.ReactNode;
}) {
  return groups.map((group) => {
    const shut = shared.collapsed.has(group.id);
    return (
      <div
        key={group.id}
        className={`qresult__group qresult__group--level-${level}`}
        role="group"
        aria-label={group.label}
      >
        <GroupHeading
          group={group}
          level={level}
          collapsed={shut}
          onToggle={() => shared.onToggleGroup(group.id)}
        />
        {!shut &&
          (group.subgroups.length === 0 ? (
            rows(group.rows)
          ) : (
            <Levels groups={group.subgroups} level={2} shared={shared} rows={rows} />
          ))}
      </div>
    );
  });
}

function ResultTable(props: GroupedResultProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const names = useNoteNames();
  const row = (found: BoardRow) => (
    <tr key={found.path}>
      <td>
        <button
          type="button"
          className="qresult__title"
          onClick={() => props.onOpenNote(found.path)}
        >
          {found.title}
        </button>
      </td>
      {props.fields.map((field) => (
        <td key={field.key} className="qresult__cell">
          {withNoteNames(found.values[field.key], names)}
        </td>
      ))}
    </tr>
  );
  return (
    <div className="table__sheet qresult__sheet" ref={sheet}>
      <table className="table__grid qresult__table">
        <thead>
          <tr>
            <th scope="col">
              <span className="table__heading">Name</span>
            </th>
            {props.fields.map((field) => (
              <th scope="col" key={field.key}>
                <span className="table__heading">{field.label}</span>
              </th>
            ))}
          </tr>
        </thead>
        {props.groups.length === 0 ? (
          <tbody>{props.rows.map(row)}</tbody>
        ) : (
          <GroupedRows
            grouping={{
              groups: props.groups,
              collapsed: props.collapsed,
              onToggle: props.onToggleGroup,
            }}
            columns={[
              { key: 'title' },
              ...props.fields.map((field) => ({
                key: field.key,
                kind: propertyKindOf(field.kind),
              })),
            ]}
            lead={0}
            noun="note"
            newLabel=""
            renderRow={row}
            scroller={sheet}
          />
        )}
      </table>
    </div>
  );
}

/** A field's kind as a property's, for the summaries a header shows; a built-in adds nothing up. */
function propertyKindOf(kind: FieldKind | undefined): PropertyKind | undefined {
  return kind === 'number' || kind === 'checkbox' ? kind : undefined;
}

function ResultList(props: GroupedResultProps) {
  const list = (rows: readonly BoardRow[]) => <RowsList rows={rows} shared={props} />;
  if (props.groups.length === 0) return list(props.rows);
  return (
    <div className="qresult qresult--list">
      <Levels groups={props.groups} level={1} shared={props} rows={list} />
    </div>
  );
}

/** A row's other values, joined, for a list or a card to show under its name. */
function useMeta(fields: readonly ResultField[]) {
  const names = useNoteNames();
  return (row: BoardRow) =>
    fields
      .map((field) => withNoteNames(row.values[field.key], names))
      .filter((value) => value !== '')
      .join(' · ');
}

function RowsList({ rows, shared }: { rows: readonly BoardRow[]; shared: GroupedResultProps }) {
  const meta = useMeta(shared.fields);
  return (
    <ul className="list-view qresult__list" aria-label="Notes">
      {rows.map((row) => (
        <li key={row.path} className="list-view__row">
          <button
            type="button"
            className="list-view__title"
            onClick={() => shared.onOpenNote(row.path)}
          >
            {row.title}
          </button>
          <span className="list-view__summary">{meta(row)}</span>
        </li>
      ))}
    </ul>
  );
}

function ResultBoard(props: GroupedResultProps) {
  if (props.lanes !== undefined && props.lanes.length > 0) {
    return (
      <BoardLanes
        columns={props.groups}
        lanes={props.lanes}
        folds={{ collapsed: props.collapsed, onToggle: props.onToggleGroup }}
        renderCell={({ rows, label }) => (
          <section className="board__cell" aria-label={label}>
            <Cards rows={rows} shared={props} quiet />
          </section>
        )}
      />
    );
  }
  const columns: readonly RowGroup[] =
    props.groups.length > 0
      ? props.groups
      : [
          {
            id: '/all',
            field: '',
            kind: 'text',
            label: 'All notes',
            value: null,
            tone: null,
            rows: props.rows,
            subgroups: [],
          },
        ];
  return (
    <div className="board qresult__board">
      {columns.map((column) => (
        <section key={column.id} className="board__column" aria-label={column.label}>
          <header className="board__heading">
            <ColumnHeading column={column} />
          </header>
          <Cards rows={column.rows} shared={props} />
        </section>
      ))}
    </div>
  );
}

function Cards({
  rows,
  shared,
  quiet = false,
}: {
  rows: readonly BoardRow[];
  shared: GroupedResultProps;
  /** An empty lane cell says nothing: a row of "Nothing here yet" is noise. */
  quiet?: boolean;
}) {
  const meta = useMeta(shared.fields);
  if (rows.length === 0) return quiet ? null : <p className="board__empty">Nothing here yet</p>;
  return (
    <ul className="board__cards qresult__cards">
      {rows.map((row) => (
        <li key={row.path}>
          <button
            type="button"
            className="qresult__card"
            onClick={() => shared.onOpenNote(row.path)}
          >
            <span className="qresult__card-title">{row.title}</span>
            <span className="qresult__card-meta">{meta(row)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
