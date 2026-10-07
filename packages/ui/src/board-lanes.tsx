import { Fragment, type CSSProperties, type ReactNode } from 'react';
import type { BoardColumn, BoardLane, BoardRow } from '@atlas/domain';
import type { GroupFolds } from './group-folds.ts';
import { Icon } from './icon.tsx';
import { StatusPill } from './status-pill.tsx';

/** A column's key among its siblings; the column with no value has one no value can be. */
export const keyOf = (column: Pick<BoardColumn, 'value'>) => column.value ?? '\u0000none';

/** One column's cell in one lane, as the board draws it. */
export interface LaneCell {
  readonly column: BoardColumn;
  readonly lane: BoardLane;
  readonly rows: readonly BoardRow[];
  /** What the cell is called: its column, in its lane. */
  readonly label: string;
}

/** What a cell is called: its column, in its lane. */
export function laneCellLabel(column: BoardColumn, lane: BoardColumn): string {
  return `${column.label}, in ${lane.label}`;
}

/**
 * A board's columns crossed with its swimlanes: the column headings once
 * across the top, then each lane — a heading that folds it, with its count —
 * holding a cell under every column. What a cell holds is the caller's: a
 * saved view's cells take dropped cards, a query's only show them.
 */
export function BoardLanes({
  columns,
  lanes,
  folds,
  renderCell,
}: {
  columns: readonly BoardColumn[];
  lanes: readonly BoardLane[];
  folds?: GroupFolds | undefined;
  renderCell: (cell: LaneCell) => ReactNode;
}) {
  // Each column as wide as a board's column is, between 196px and 272px.
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(196px, 272px))`,
  };
  return (
    <div className="board board--lanes" style={style}>
      <div className="board__lane-heads">
        {columns.map((column) => (
          <div key={keyOf(column)} className="board__heading board__lane-head">
            <ColumnHeading column={column} />
          </div>
        ))}
      </div>
      {lanes.map((lane) => {
        const shut = folds?.collapsed.has(lane.group.id) ?? false;
        return (
          <section
            key={lane.group.id}
            className="board__lane"
            aria-label={`${lane.group.label} lane`}
          >
            <LaneHeading
              lane={lane}
              shut={shut}
              {...(folds !== undefined && { onToggle: () => folds.onToggle(lane.group.id) })}
            />
            {!shut && (
              <div className="board__lane-cells">
                {lane.cells.map((cell) => (
                  <Fragment key={keyOf(cell.column)}>
                    {renderCell({
                      column: cell.column,
                      lane,
                      rows: cell.rows,
                      label: laneCellLabel(cell.column, lane.group),
                    })}
                  </Fragment>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function LaneHeading({
  lane,
  shut,
  onToggle,
}: {
  lane: BoardLane;
  shut: boolean;
  onToggle?: () => void;
}) {
  const count = lane.group.rows.length;
  return (
    <h3 className="board__lane-heading">
      <button
        type="button"
        className="board__lane-toggle"
        aria-expanded={!shut}
        disabled={onToggle === undefined}
        onClick={onToggle}
      >
        <Icon
          name="chevron"
          size={14}
          className={shut ? 'table__fold table__fold--shut' : 'table__fold'}
        />
        {lane.group.tone === null || lane.group.value === null ? (
          <span className="board__group-label">{lane.group.label}</span>
        ) : (
          <StatusPill value={lane.group.label} tone={lane.group.tone} />
        )}
        <span className="board__count" aria-label={`${count} ${count === 1 ? 'card' : 'cards'}`}>
          {count}
        </span>
      </button>
    </h3>
  );
}

/** A column's pill — or its plain name, for a column that is not a status — and its count. */
export function ColumnHeading({ column }: { column: BoardColumn }) {
  const count = column.rows.length;
  return (
    <>
      {column.tone === null ? (
        <span className="board__group-label">{column.label}</span>
      ) : (
        <StatusPill
          value={column.label}
          {...(column.tone !== undefined && { tone: column.tone })}
        />
      )}
      <span className="board__count" aria-label={`${count} ${count === 1 ? 'card' : 'cards'}`}>
        {count}
      </span>
    </>
  );
}
