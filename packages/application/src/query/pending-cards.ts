import { DUE_KEY, repeatingTaskUpdate, type BoardRow } from '@dfai/domain';
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
 * index from before it, never puts the card back for a beat. A card moved
 * again is drawn with each move laid over the one before: what the second
 * move changes wins, and what only the first changed stays. Every other row is the object it was; the rows themselves
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
  const moved = pendingValues(pending, read);
  if (!rows.some((row) => moved.has(row.path))) return rows;
  return rows.map((row) => {
    const values = moved.get(row.path);
    return values === undefined ? row : { ...row, values: { ...row.values, ...values } };
  });
}

/** Each pending note's values, laid over one another in the order they were changed. */
function pendingValues(pending: readonly PendingCard[], read: ReadMoment): Map<string, Values> {
  const moved = new Map<string, Values>();
  for (const card of pending) {
    if (!readAnswers(card.landed, read))
      moved.set(card.path, { ...moved.get(card.path), ...card.values });
  }
  return moved;
}

/** A query's answer as a table draws it: its columns, and a row of cells for each note. */
export interface TableRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

/**
 * A table's rows as they are drawn while their cells' writes land (#300):
 * the rule `rowsAsPending` holds for a board's cards, for the table's rows —
 * a cell committed is drawn as committed until a read stands for its write.
 * A row with nothing pending is the array it was, so only an edited row draws
 * again; the result itself when nothing is pending.
 */
export function resultAsPending<Result extends TableRows>({
  result,
  pending,
  read,
}: {
  result: Result;
  pending: readonly PendingCard[];
  read: ReadMoment;
}): Result {
  const moved = pendingValues(pending, read);
  const pathAt = result.columns.indexOf('path');
  if (moved.size === 0 || pathAt === -1) return result;
  let changed = false;
  const rows = result.rows.map((row) => {
    const values = moved.get(String(row[pathAt]));
    if (values === undefined) return row;
    const cells = row.map((cell, at) => {
      const column = result.columns[at] ?? '';
      return Object.hasOwn(values, column) ? values[column] : cell;
    });
    if (cells.every((cell, at) => cell === row[at])) return row;
    changed = true;
    return cells;
  });
  return changed ? { ...result, rows } : result;
}
