import { useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  useDroppable,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  columnPreview,
  statusTone,
  type BoardColumn,
  type BoardLane,
  type BoardRow,
  type PropertyKind,
} from '@atlas/domain';
import { AddCard, Card, LiftedCard, type CardLook } from './board-card.tsx';
import { BoardLanes, ColumnHeading, keyOf, laneCellLabel } from './board-lanes.tsx';
import type { DoneTicks } from './done-checkbox.tsx';
import type { GroupFolds } from './group-folds.ts';
import { boardWords } from './drag/announcements.ts';
import { dropTargetUnder, snapToDropTarget, useDragSensors } from './drag/dnd.ts';
import { useFocusFollower, type FocusFollower } from './drag/focus.ts';
import { boardStep, laneStep } from './drag/snapping.ts';
import { Icon } from './icon.tsx';

/**
 * A card moved on the board. A key present is a property to write: `value`
 * the column's, `lane` the swimlane's. A move within one column across lanes
 * carries only `lane`, so the column's property is not written for nothing.
 */
export interface CardMove {
  readonly path: string;
  readonly value?: string | null;
  readonly lane?: string | null;
}

/** A card added on the board: the column it goes in, and its lane when the board has them. */
export interface CardAdd {
  readonly value: string | null;
  readonly lane?: string | null;
  readonly name: string;
}

/** Somewhere a card can be dropped: a column, or one column's cell in a lane. */
interface DropTarget {
  readonly id: string;
  /** What a screen reader calls it: "doing", or "doing, in Atlas". */
  readonly label: string;
  readonly column: BoardColumn;
  readonly lane: BoardColumn | null;
}

/**
 * A view drawn as columns of cards — and, when the view sub-groups, as
 * swimlanes across those columns.
 *
 * Dropping a card writes the grouping property into that note's file, so the
 * board is a way of editing notes rather than a place state lives. Dropped
 * into another lane as well, it is given both properties in one write. A
 * column with no cards is still shown: it is where a card goes next.
 *
 * A card is dragged with a pointer from anywhere on it, or from the keyboard:
 * Tab to its title, Space to pick it up, Left and Right to choose a column (Up
 * and Down a lane), Space to drop it there.
 */
export function BoardView({
  columns,
  lanes,
  folds,
  groupBy,
  fields,
  kinds = {},
  onOpenNote,
  onMoveCard,
  onAddCard,
  ticks,
}: {
  columns: readonly BoardColumn[];
  /** The swimlanes, when the view sub-groups; each holds a cell per column. */
  lanes?: readonly BoardLane[];
  /** Which lanes are folded shut. */
  folds?: GroupFolds;
  groupBy: string;
  /** Extra properties to show on each card. */
  fields: readonly string[];
  /** The declared kind of each property, so a card's chips can say what they hold. */
  kinds?: Readonly<Record<string, PropertyKind>>;
  onOpenNote: (path: string) => void;
  onMoveCard: (move: CardMove) => void;
  onAddCard: (add: CardAdd) => void;
  /** Given when the type can be ticked done: every card leads with a box. */
  ticks?: DoneTicks;
}) {
  const laned = lanes !== undefined && lanes.length > 0;
  const shut = folds?.collapsed;
  const [held, setHeld] = useState<BoardRow | null>(null);
  // The card last moved stays drawn in its new column, even past "+ N more",
  // so the focus that follows it has somewhere to land.
  const [moved, setMoved] = useState<string | null>(null);
  const lookup = useMemo(
    () => (laned ? laneLookup(lanes, shut) : columnLookup(columns)),
    [laned, lanes, shut, columns],
  );
  const snap = useMemo(
    () =>
      snapToDropTarget({
        next: (current, direction) =>
          laned
            ? laneStep(lookup.grid, current, direction)
            : boardStep(lookup.grid[0] ?? [], current, direction),
        sideways: !laned,
      }),
    [lookup, laned],
  );
  const sensors = useDragSensors(snap);
  const announcements = useMemo(() => boardAnnouncements(lookup), [lookup]);

  const focus = useFocusFollower();
  // Every lane is by one property; a card in a lane does not repeat it.
  const laneBy = laned ? lanes[0]?.group.field : undefined;
  const lookOf = (column: BoardColumn | undefined): CardLook => ({
    fields,
    groupBy,
    ...(laneBy !== undefined && { laneBy }),
    kinds,
    done: column !== undefined && isDoneColumn(column),
    ...(ticks !== undefined && { ticks }),
  });
  const heldHome = held === null ? undefined : lookup.homeOf.get(held.path);

  const drop = (event: DragEndEvent) => {
    setHeld(null);
    const { active, over } = event;
    const path = String(active.id);
    const target = over === null ? undefined : lookup.targetById.get(String(over.id));
    const home = lookup.targetById.get(lookup.homeOf.get(path) ?? '');
    // Back where it was is not a move; writing the same value would only
    // touch the file for nothing.
    if (target === undefined || home === undefined || target.id === home.id) return;
    focus.follow(event);
    setMoved(path);
    onMoveCard(moveBetween(path, home, target));
  };

  const shared = {
    onOpenNote,
    claimFocus: focus.claim,
    keep: moved,
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropTargetUnder}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: laned ? boardWords.laneInstructions : boardWords.instructions,
        },
      }}
      onDragStart={({ active }) => setHeld(lookup.rowByPath.get(String(active.id)) ?? null)}
      onDragEnd={drop}
      onDragCancel={() => setHeld(null)}
    >
      {laned ? (
        <BoardLanes
          columns={columns}
          lanes={lanes}
          folds={folds}
          renderCell={({ column, lane, rows, label }) => (
            <CellView
              id={cellId(column, lane.group)}
              label={label}
              rows={rows}
              look={lookOf(column)}
              onAdd={(name) => onAddCard({ value: column.value, lane: lane.group.value, name })}
              {...shared}
            />
          )}
        />
      ) : (
        <div className="board">
          {columns.map((column) => (
            <ColumnView
              key={keyOf(column)}
              column={column}
              look={lookOf(column)}
              onAddCard={(name) => onAddCard({ value: column.value, name })}
              {...shared}
            />
          ))}
        </div>
      )}

      {/* The card under the pointer is drawn above the board, because a column
          scrolls and would clip it. It is a picture of the card, so it is hidden
          from assistive technology: the announcements say where it is. */}
      <DragOverlay dropAnimation={null}>
        {held === null ? null : (
          <LiftedCard row={held} look={lookOf(lookup.targetById.get(heldHome ?? '')?.column)} />
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** What a move writes: each property whose group the card left. */
function moveBetween(path: string, home: DropTarget, target: DropTarget): CardMove {
  const columnMoved = keyOf(home.column) !== keyOf(target.column);
  const laneMoved =
    home.lane !== null && target.lane !== null && keyOf(home.lane) !== keyOf(target.lane);
  return {
    path,
    ...(columnMoved && { value: target.column.value }),
    ...(laneMoved && { lane: target.lane?.value ?? null }),
  };
}

/** A cell's drop id: its column and its lane, which no value can run together. */
function cellId(column: BoardColumn, lane: BoardColumn): string {
  return JSON.stringify([keyOf(column), keyOf(lane)]);
}

/** Whether a column holds finished work, whose cards wear the done tick. */
const isDoneColumn = (column: BoardColumn) =>
  column.value !== null && statusTone(column.value) === 'done';

/**
 * One column: its status pill and count, then its cards — the first few, with
 * the rest behind "+ N more" — or a dashed box saying there is nothing here.
 */
function ColumnView({
  column,
  look,
  onOpenNote,
  onAddCard,
  claimFocus,
  keep,
}: {
  column: BoardColumn;
  look: CardLook;
  onOpenNote: (path: string) => void;
  onAddCard: (name: string) => void;
  claimFocus: FocusFollower['claim'];
  /** A card drawn even when it falls past the preview. */
  keep: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const count = column.rows.length;

  return (
    <Droppable id={keyOf(column)} label={column.label} className="board__column">
      <header className="board__heading">
        <ColumnHeading column={column} />
        {/* In the header, where a full column cannot push it out of sight. */}
        <button
          type="button"
          className="icon-button board__add-top"
          aria-label={`Add to ${column.label}`}
          title={`Add to ${column.label}`}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={15} />
        </button>
      </header>

      {adding && (
        <AddCard label={column.label} onAdd={onAddCard} onClose={() => setAdding(false)} />
      )}

      {count === 0 && !adding ? (
        <p className="board__empty">Nothing here yet</p>
      ) : (
        <PreviewedCards
          rows={column.rows}
          look={look}
          onOpenNote={onOpenNote}
          claimFocus={claimFocus}
          keep={keep}
        />
      )}
    </Droppable>
  );
}

/**
 * A column's or a cell's cards: the first few, with the rest behind
 * "+ N more", and "Show fewer" once they are all out.
 */
function PreviewedCards({
  rows,
  look,
  onOpenNote,
  claimFocus,
  keep,
}: {
  rows: readonly BoardRow[];
  look: CardLook;
  onOpenNote: (path: string) => void;
  claimFocus: FocusFollower['claim'];
  /** A card drawn even when it falls past the preview. */
  keep: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = rows.length;
  const { shown } = columnPreview({ count, expanded });
  const visible = rows.filter((row, at) => at < shown || row.path === keep);
  const hidden = count - visible.length;
  const collapsible = expanded && columnPreview({ count, expanded: false }).hidden > 0;

  return (
    <ul className="board__cards">
      {visible.map((row) => (
        <li key={row.path}>
          <Card row={row} look={look} onOpen={onOpenNote} claimFocus={claimFocus} />
        </li>
      ))}
      {hidden > 0 && (
        <li>
          <button type="button" className="board__more" onClick={() => setExpanded(true)}>
            + {hidden} more
          </button>
        </li>
      )}
      {collapsible && (
        <li>
          <button type="button" className="board__more" onClick={() => setExpanded(false)}>
            Show fewer
          </button>
        </li>
      )}
    </ul>
  );
}

/**
 * One column's cell in a lane: its cards — capped behind "+ N more" as a
 * column's are — and a quiet "+" that adds one with both values.
 */
function CellView({
  id,
  label,
  rows,
  look,
  onOpenNote,
  onAdd,
  claimFocus,
  keep,
}: {
  id: string;
  label: string;
  rows: readonly BoardRow[];
  look: CardLook;
  onOpenNote: (path: string) => void;
  onAdd: (name: string) => void;
  claimFocus: FocusFollower['claim'];
  /** A card drawn even when it falls past the preview. */
  keep: string | null;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <Droppable id={id} label={label} className="board__cell">
      {rows.length > 0 && (
        <PreviewedCards
          rows={rows}
          look={look}
          onOpenNote={onOpenNote}
          claimFocus={claimFocus}
          keep={keep}
        />
      )}
      {adding ? (
        <AddCard label={label} onAdd={onAdd} onClose={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          className="board__cell-add"
          aria-label={`Add to ${label}`}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={14} />
          New
        </button>
      )}
    </Droppable>
  );
}

interface BoardLookup {
  /** Drop targets' ids, a row per lane (one row without lanes): the order the arrow keys walk. */
  readonly grid: readonly (readonly string[])[];
  readonly targetById: ReadonlyMap<string, DropTarget>;
  readonly rowByPath: ReadonlyMap<string, BoardRow>;
  /** The id of the target each card is in now. */
  readonly homeOf: ReadonlyMap<string, string>;
}

function lookupOf(targets: readonly (readonly (DropTarget & { rows: readonly BoardRow[] })[])[]) {
  const targetById = new Map<string, DropTarget>();
  const rowByPath = new Map<string, BoardRow>();
  const homeOf = new Map<string, string>();
  for (const target of targets.flat()) {
    targetById.set(target.id, target);
    for (const row of target.rows) {
      rowByPath.set(row.path, row);
      homeOf.set(row.path, target.id);
    }
  }
  return {
    grid: targets.map((row) => row.map((target) => target.id)),
    targetById,
    rowByPath,
    homeOf,
  };
}

function columnLookup(columns: readonly BoardColumn[]): BoardLookup {
  return lookupOf([
    columns.map((column) => ({
      id: keyOf(column),
      label: column.label,
      column,
      lane: null,
      rows: column.rows,
    })),
  ]);
}

/**
 * Only the open lanes: a lane folded shut draws no cells and no cards, so
 * there is nothing in it to drop into or pick up, and the arrow keys pass
 * over it.
 */
function laneLookup(
  lanes: readonly BoardLane[],
  collapsed: ReadonlySet<string> | undefined,
): BoardLookup {
  const open = lanes.filter((lane) => collapsed?.has(lane.group.id) !== true);
  const targets = open.map((lane) =>
    lane.cells.map((cell) => ({
      id: cellId(cell.column, lane.group),
      label: laneCellLabel(cell.column, lane.group),
      column: cell.column,
      lane: lane.group,
      rows: cell.rows,
    })),
  );
  return lookupOf(targets);
}

/** dnd-kit hands over ids; the sentences want the card's name and the column's. */
function boardAnnouncements({ targetById, rowByPath, homeOf }: BoardLookup): Announcements {
  const card = (id: UniqueIdentifier) => rowByPath.get(String(id))?.title ?? String(id);
  const label = (key: UniqueIdentifier | undefined) =>
    key === undefined ? null : (targetById.get(String(key))?.label ?? null);
  const home = (id: UniqueIdentifier) => label(homeOf.get(String(id))) ?? '';
  return {
    onDragStart: ({ active }) => boardWords.start(card(active.id), home(active.id)),
    onDragOver: ({ active, over }) => boardWords.over(card(active.id), label(over?.id)),
    onDragEnd: ({ active, over }) =>
      boardWords.end(card(active.id), home(active.id), label(over?.id)),
    onDragCancel: ({ active }) => boardWords.cancel(card(active.id), home(active.id)),
  };
}

/** A column or a cell is a drop target, lit while a card is over it. */
function Droppable({
  id,
  label,
  className,
  children,
}: {
  id: string;
  label: string;
  className: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={isOver ? `${className} ${className}--over` : className}
      aria-label={label}
    >
      {children}
    </section>
  );
}
