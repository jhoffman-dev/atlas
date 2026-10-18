import { DUE_KEY, repeatingTaskUpdate, type BoardRow } from '@atlas/domain';
import { readAnswers, type ReadMoment } from '../pending/read-moment.ts';
import { finishingRule, type CardMove } from './card-move.ts';

type Values = Readonly<Record<string, unknown>>;

/**
 * How a card reads once it is moved, before its write lands (#260): the
 * values of the column and the lane it was dropped in, spelled as the board
 * holds them so it is grouped into exactly that column — and, when the move
 * finishes a repeating task, where the roll puts it instead: back in play,
 * due next time, as `cardMoveChanges` writes it. Only what the move changes.
 */
export function cardAsMoved({ values, move }: { values: Values; move: CardMove }): Values {
  const moved: Record<string, unknown> = {};
  for (const placement of [move.column, move.lane]) {
    if (placement !== null) moved[placement.key] = placement.value;
  }
  const rule = finishingRule(move);
  const roll =
    rule === null
      ? null
      : repeatingTaskUpdate({
          properties: values,
          statusKey: rule.statusKey,
          resetStatus: rule.resetStatus,
        });
  if (rule === null || roll === null) return moved;
  return { ...moved, [rule.statusKey]: roll[rule.statusKey], [DUE_KEY]: roll[DUE_KEY] };
}

/** A card moved on the board whose move the index has not read back yet. */
export interface PendingCard {
  readonly path: string;
  /** What the move changes, as `cardAsMoved` reads it. */
  readonly values: Values;
  /** When its write landed, as the board's reads count; null while it is being written. */
  readonly landed: ReadMoment | null;
}

/**
 * The board's rows as they are drawn (#260): each card moved and not yet
 * read back drawn as moved, until a read that stands for its write
 * (`readAnswers`) — so a read begun before the write landed, or of the
 * index from before it, never puts the card back for a beat. The latest move
 * of a card wins. Every other row is the object it was; the rows themselves
 * when nothing is pending.
 */
export function rowsAsPending({
  rows,
  pending,
  read,
}: {
  rows: readonly BoardRow[];
  pending: readonly PendingCard[];
  /** The read the rows came from. */
  read: ReadMoment;
}): readonly BoardRow[] {
  const moved = new Map<string, Values>();
  for (const card of pending) {
    if (!readAnswers(card.landed, read)) moved.set(card.path, card.values);
  }
  if (!rows.some((row) => moved.has(row.path))) return rows;
  return rows.map((row) => {
    const values = moved.get(row.path);
    return values === undefined ? row : { ...row, values: { ...row.values, ...values } };
  });
}
