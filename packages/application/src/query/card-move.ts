import {
  movedValue,
  repeatingTaskUpdate,
  type FieldKind,
  type StatusProperty,
} from '@atlas/domain';
import type { CompletionRule, PropertyChanges } from './set-property.ts';

/** A property a card was dropped into a new group of, and the group's value. */
export interface CardPlacement {
  readonly key: string;
  readonly value: string | null;
  /** The property's kind, which the value is written as (`movedValue`); absent, as text. */
  readonly kind?: FieldKind | undefined;
}

/** What decides a card's move: where it goes, and the type's rule for finishing work. */
interface CardMove {
  column: CardPlacement | null;
  lane: CardPlacement | null;
  /** The type's status, or null when nothing in the type means finished. */
  status: StatusProperty | null;
  /** The values the column's property declares, in workflow order. */
  columnOptions: readonly string[];
}

/**
 * What one card dropped on a board writes: the column's property and the
 * lane's — each only when the card left its group — as one change, so the
 * note is one write and one undo step, never briefly half-moved.
 *
 * Which property finishes the task is decided here and only here. A type
 * with a status is finished by that status alone, whether it is the board's
 * columns or its lanes; a column by any other property is just a column, so
 * its last option never counts as done. A type with no status keeps the
 * plain board's reading: its columns' `done`, else their last option, since
 * a workflow is written in the order work moves through it. Finishing a
 * repeating task rolls it forward exactly once, and the other property the
 * card was dropped into is kept.
 */
export function cardMoveChanges(move: CardMove): PropertyChanges {
  const values: Record<string, unknown> = {};
  for (const placement of [move.column, move.lane]) {
    if (placement !== null) values[placement.key] = movedValue(placement.kind, placement.value);
  }
  const rule = finishingRule(move);
  if (rule === null) return values;
  return (properties) => ({
    ...values,
    ...repeatingTaskUpdate({
      properties,
      statusKey: rule.statusKey,
      resetStatus: rule.resetStatus,
    }),
  });
}

/**
 * Whether the move finishes the task — puts it in its done group — and so,
 * for a repeating one, rolls it forward. A retry of such a move is not
 * harmless, which is why the API asks for `ifModified` with one.
 */
export function movesToDone(move: CardMove): boolean {
  return finishingRule(move) !== null;
}

/** The rule the move finishes the task by, or null when it finishes nothing. */
function finishingRule(move: CardMove): CompletionRule | null {
  const rule = completionRule(move);
  if (rule === null) return null;
  const placed = [move.column, move.lane].find((placement) => placement?.key === rule.statusKey);
  return placed?.value === rule.doneValue ? rule : null;
}

function completionRule({
  column,
  status,
  columnOptions,
}: {
  column: CardPlacement | null;
  status: StatusProperty | null;
  columnOptions: readonly string[];
}): CompletionRule | null {
  if (status !== null) {
    return {
      statusKey: status.key,
      doneValue: status.done,
      resetStatus: status.options[0] ?? status.done,
    };
  }
  if (column === null || columnOptions.length === 0) return null;
  const doneValue = columnOptions.includes('done') ? 'done' : (columnOptions.at(-1) ?? 'done');
  return { statusKey: column.key, doneValue, resetStatus: columnOptions[0] ?? doneValue };
}
