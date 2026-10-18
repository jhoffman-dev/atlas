import { useCallback, useMemo, useRef, useState } from 'react';
import type { BoardRow } from '@atlas/domain';
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
}): { rows: readonly BoardRow[]; move: MoveProperties } {
  const [moving, setMoving] = useState<readonly MovingCard[]>([]);
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
    [runsBegun, write, onChanged, onError],
  );

  const shownRows = useMemo(() => {
    const pending = moving.map((card) => ({ ...card, landed: landedAt.current.get(card) ?? null }));
    return rowsAsPending({ rows, pending, read });
  }, [rows, moving, read]);
  return { rows: shownRows, move };
}

/** A card moved, and what the move changes, as `cardAsMoved` reads it. */
type MovingCard = Omit<PendingCard, 'landed'>;
