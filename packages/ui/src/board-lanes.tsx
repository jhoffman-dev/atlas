import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { optionLabel, type BoardColumn, type BoardLane, type BoardRow } from '@dfai/domain';
import type { GroupFolds } from './group-folds.ts';
import { Icon } from './icon.tsx';
import { StatusPill } from './status-pill.tsx';

/** A column's key among its siblings; the column with no value has one no value can be. */
export const keyOf = (column: Pick<BoardColumn, 'value'>) => column.value ?? '\u0000none';

/**
 * What a column or lane is called wherever it is named — its heading, its
 * region, its "Add to …" button: an option grouping reads as its option label
 * (`next-action` is "Next Action"); a grouping with no tone, a relation or
 * "No value", keeps its plain label.
 */
export const columnName = (column: Pick<BoardColumn, 'label' | 'tone'>) =>
  column.tone === null ? column.label : optionLabel(column.label);

/** One column's cell in one lane, as the board draws it. */
export interface LaneCell {
  readonly column: BoardColumn;
  readonly lane: BoardLane;
  readonly rows: readonly BoardRow[];
  /** What the cell is called: its column, in its lane. */
  readonly label: string;
}

/** What a cell is called: its column, in its lane, each as its heading reads. */
export function laneCellLabel(column: BoardColumn, lane: BoardColumn): string {
  return `${columnName(column)}, in ${columnName(lane)}`;
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
  // The columns split the width equally, as a board's do; below 180px each
  // the board scrolls sideways instead (board.css).
  const style: CSSProperties = {
    gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(180px, 1fr))`,
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

/**
 * A column's bare status dot and its label — or its plain name alone, for a
 * column that is not a status — and its count. The label is the heading's
 * text, so the dot is decoration beside it.
 */
export function ColumnHeading({ column }: { column: BoardColumn }) {
  const count = column.rows.length;
  const status = column.tone !== null;
  return (
    <>
      {status && (
        <StatusPill
          value={column.label}
          variant="dot"
          decorative
          {...(column.tone !== undefined && { tone: column.tone })}
        />
      )}
      <span className="board__group-label">{columnName(column)}</span>
      <span className="board__count" aria-label={`${count} ${count === 1 ? 'card' : 'cards'}`}>
        {count}
      </span>
    </>
  );
}
