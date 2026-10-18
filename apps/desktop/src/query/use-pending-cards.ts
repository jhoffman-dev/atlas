import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 * works out from what its row shows.
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

/** A card moved, and what the move changes, as `cardAsMoved` reads it. */
export type MovingCard = Omit<PendingCard, 'landed'>;

/** What a board holds while its moves are written: the cards, and why the last that failed did. */
interface MovesState {
  readonly moving: readonly MovingCard[];
  /** Said on the board until the next move, never wiped by a run of the view. */
  readonly failure: string | null;
}

/**
 * The cards being moved on one board, and the read they are laid over. Held
 * in a store only the board subscribes to: a drop draws the board, not the
 * pane, its toolbar and its menus around it (#260).
 */
export interface PendingCards {
  readonly store: StoreApi<MovesState>;
  /** When a move's write landed, or null while it is being written. */
  readonly landedOf: (card: MovingCard) => ReadMoment | null;
  /** The rows as the view's last run read them, and when that run began. */
  readonly rows: readonly BoardRow[];
  readonly read: ReadMoment;
}

const NOTHING_MOVING: MovesState = { moving: [], failure: null };

/**
 * A board's cards as they are drawn while their moves are written (#260): a
 * card moved is drawn where the move puts it in the same commit as the drop,
 * and stays there until a read of the view stands for its write
 * (`rowsAsPending`). A card's moves are written one after another, each from
 * what the last left, so the last place it was put wins. A move whose write
 * fails is let go — the card is drawn where the index has it, every other
 * move stays — and the board says why until the next move.
 */
export function usePendingCards({
  rows,
  read,
  runsBegun,
  indexKey,
  scope,
  write,
  onChanged,
}: {
  /** The rows as the view's last run read them. */
  rows: readonly BoardRow[];
  /** When that run began. */
  read: ReadMoment;
  /** How many runs of the view have begun, now. */
  runsBegun: () => number;
  indexKey: string;
  /** The index and the view the cards are of: when either changes, no card carries over. */
  scope: readonly unknown[];
  write: WriteProperties;
  onChanged: () => void;
}): { pending: PendingCards; move: MoveProperties } {
  const [store] = useState(() => createStore<MovesState>()(() => NOTHING_MOVING));
  // When each move's write landed. Kept out of state on purpose: a write landing
  // changes nothing on screen, only how the next read is judged, and every read
  // that lands draws the board again anyway. A commit for it is work the drag's
  // budget counts (#260).
  const landedAt = useRef(new WeakMap<MovingCard, ReadMoment>());
  const landedOf = useCallback((card: MovingCard) => landedAt.current.get(card) ?? null, []);
  // Read when a move begins, not when the board draws.
  const latest = useRef({ rows, read, indexKey });
  latest.current = { rows, read, indexKey };
  const [first, second] = scope;
  useEffect(() => () => store.setState(NOTHING_MOVING), [store, first, second]);
  const inTurn = useCardTurns();

  const move = useCallback<MoveProperties>(
    ({ path, values, shown }) => {
      const now = latest.current;
      const { moving } = store.getState();
      const card: MovingCard = {
        path,
        values: shown(valuesShown({ ...now, moving, landedOf, path })),
      };
      // Cards a read already stands for are let go here, in the drop's own commit.
      store.setState({
        moving: [...moving.filter((each) => !readAnswers(landedOf(each), now.read)), card],
        failure: null,
      });
      // As the drop is asked, like Today's rows: only a read of the index since moves on from here.
      const askedAt = now.indexKey;
      inTurn(path, () => write({ path, values })).then(
        () => {
          landedAt.current.set(card, { at: runsBegun(), indexKey: askedAt });
          onChanged();
        },
        (cause: unknown) =>
          store.setState((was) => ({
            moving: was.moving.filter((each) => each !== card),
            failure: errorMessage(cause),
          })),
      );
    },
    [store, landedOf, inTurn, runsBegun, write, onChanged],
  );

  const pending = useMemo(() => ({ store, landedOf, rows, read }), [store, landedOf, rows, read]);
  return { pending, move };
}

/**
 * Writes one card's moves one after another: each reads the file the last
 * left, so the second is not refused as written over by the first. Other
 * cards' moves do not wait.
 */
function useCardTurns(): (path: string, work: () => Promise<void>) => Promise<void> {
  const turns = useRef(new Map<string, Promise<void>>());
  return useCallback((path, work) => {
    const before = turns.current.get(path) ?? Promise.resolve();
    const turn = before.then(work);
    // The next waits for this one to end, not to succeed.
    const ended = turn.catch(() => undefined);
    turns.current.set(path, ended);
    void ended.then(() => {
      if (turns.current.get(path) === ended) turns.current.delete(path);
    });
    return turn;
  }, []);
}

/** A card's values as the board draws it now: as read, with the moves still pending laid over. */
function valuesShown({
  rows,
  read,
  moving,
  landedOf,
  path,
}: {
  rows: readonly BoardRow[];
  read: ReadMoment;
  moving: readonly MovingCard[];
  landedOf: (card: MovingCard) => ReadMoment | null;
  path: string;
}): Readonly<Record<string, unknown>> {
  const row = rows.find((each) => each.path === path);
  if (row === undefined) return {};
  const pending = moving
    .filter((card) => card.path === path)
    .map((card) => ({ ...card, landed: landedOf(card) }));
  return rowsAsPending({ rows: [row], pending, read })[0]?.values ?? row.values;
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
}): BoardShape & { readonly failure: string | null } {
  const moving = useStore(pending.store, (state) => state.moving);
  const failure = useStore(pending.store, (state) => state.failure);
  const board = useMemo(() => {
    const cards = moving.map((card) => ({ ...card, landed: pending.landedOf(card) }));
    const shown = rowsAsPending({ rows: pending.rows, pending: cards, read: pending.read });
    return shown === pending.rows ? read : regroup(shown);
  }, [moving, pending, read, regroup]);
  return useMemo(() => ({ ...board, failure }), [board, failure]);
}
