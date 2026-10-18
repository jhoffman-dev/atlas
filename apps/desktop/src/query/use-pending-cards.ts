import { useCallback, useMemo, useRef, useState } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { BoardLane, BoardRow, RowGroup } from '@atlas/domain';
import {
  readAnswers,
  rowsAsPending,
  type PendingCard,
  type PropertyChanges,
  type ReadMoment,
} from '@atlas/application';
import { errorMessage } from './error-message.ts';

/** Writes a note's properties, settling once the write has landed. */
export type WriteProperties = (args: { path: string; values: PropertyChanges }) => Promise<void>;

/**
 * Moves a card: writes `values`, and draws the card meanwhile as `shown`
 * works out from what its row read.
 */
export type MoveProperties = (args: {
  path: string;
  values: PropertyChanges;
  shown: (values: Readonly<Record<string, unknown>>) => Readonly<Record<string, unknown>>;
}) => void;

/** A board's columns and swimlanes. */
export interface BoardShape {
  readonly columns: readonly RowGroup[];
  readonly lanes: readonly BoardLane[];
}

/**
 * The cards being moved on one board, and the read they are laid over. Held
 * in a store only the board subscribes to: a drop draws the board, not the
 * pane, its toolbar and its menus around it (#260).
 */
export interface PendingCards {
  readonly store: StoreApi<{ readonly moving: readonly MovingCard[] }>;
  /** When a move's write landed, or null while it is being written. */
  readonly landedOf: (card: MovingCard) => ReadMoment | null;
  /** The rows as the view's last run read them, and when that run began. */
  readonly rows: readonly BoardRow[];
  readonly read: ReadMoment;
}

/**
 * A board's cards as they are drawn while their moves are written (#260): a
 * card moved is drawn where the move puts it in the same commit as the drop,
 * and stays there until a read of the view stands for its write
 * (`rowsAsPending`). A move whose write fails is let go, so the card is drawn
 * where the index has it, and the board says why.
 */
export function usePendingCards({
  rows,
  read,
  runsBegun,
  indexKey,
  write,
  onChanged,
  onError,
}: {
  /** The rows as the view's last run read them. */
  rows: readonly BoardRow[];
  /** When that run began. */
  read: ReadMoment;
  /** How many runs of the view have begun, now. */
  runsBegun: () => number;
  indexKey: string;
  write: WriteProperties;
  onChanged: () => void;
  onError: (message: string) => void;
}): { pending: PendingCards; move: MoveProperties } {
  const [store] = useState(() =>
    createStore<{ readonly moving: readonly MovingCard[] }>()(() => ({ moving: [] })),
  );
  const setMoving = useCallback(
    (next: (was: readonly MovingCard[]) => readonly MovingCard[]) =>
      store.setState((was) => ({ moving: next(was.moving) })),
    [store],
  );
  // When each move's write landed. Kept out of state on purpose: a write landing
  // changes nothing on screen, only how the next read is judged, and every read
  // that lands draws the board again anyway. A commit for it is work the drag's
  // budget counts (#260).
  const landedAt = useRef(new WeakMap<MovingCard, ReadMoment>());
  // Read when a move begins and when its write lands, not when the board draws.
  const latest = useRef({ rows, read, indexKey });
  latest.current = { rows, read, indexKey };

  const move = useCallback<MoveProperties>(
    ({ path, values, shown }) => {
      const now = latest.current;
      const row = now.rows.find((each) => each.path === path);
      const card: MovingCard = { path, values: shown(row?.values ?? {}) };
      // Cards a read already stands for are let go here, in the drop's own commit.
      setMoving((was) => [
        ...was.filter((each) => !readAnswers(landedAt.current.get(each) ?? null, now.read)),
        card,
      ]);
      write({ path, values }).then(
        () => {
          landedAt.current.set(card, { at: runsBegun(), indexKey: latest.current.indexKey });
          onChanged();
        },
        (cause: unknown) => {
          setMoving((was) => was.filter((each) => each !== card));
          onError(errorMessage(cause));
        },
      );
    },
    [runsBegun, write, onChanged, onError, setMoving],
  );

  const landedOf = useCallback((card: MovingCard) => landedAt.current.get(card) ?? null, []);
  const pending = useMemo(() => ({ store, landedOf, rows, read }), [store, landedOf, rows, read]);
  return { pending, move };
}

/**
 * The board as it is drawn (#260): each card moved and not yet read back
 * where the move puts it (`rowsAsPending`), regrouped by `regroup`; the
 * board as read when nothing is pending. Called by the board alone, so a
 * drop draws only it.
 */
export function useBoardAsPending({
  pending,
  read,
  regroup,
}: {
  pending: PendingCards;
  /** The board as the view's last run read it. */
  read: BoardShape;
  /** The board's columns and lanes for other rows, by the view's own grouping. */
  regroup: (rows: readonly BoardRow[]) => BoardShape;
}): BoardShape {
  const moving = useStore(pending.store, (state) => state.moving);
  return useMemo(() => {
    const cards = moving.map((card) => ({ ...card, landed: pending.landedOf(card) }));
    const shown = rowsAsPending({ rows: pending.rows, pending: cards, read: pending.read });
    return shown === pending.rows ? read : regroup(shown);
  }, [moving, pending, read, regroup]);
}

/** A card moved, and what the move changes, as `cardAsMoved` reads it. */
export type MovingCard = Omit<PendingCard, 'landed'>;
