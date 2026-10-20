import { cellWriteValue, sameCellValue, type StatusProperty } from '@atlas/domain';
import { ChangedSinceError } from '../today/today-actions.ts';
import type { PropertyChanges } from './set-property.ts';
import { doneChange } from './tick-done.ts';

type Values = Readonly<Record<string, unknown>>;

/** One cell committed in a view's table. */
export interface CellCommit {
  readonly column: string;
  /** What the editor typed or picked, typed by the column's kind. */
  readonly value: unknown;
  /**
   * What the cell showed when its edit began. Left out for a change that
   * needs no editor open — a box ticked, a link removed — which is made on
   * what the cell shows at that moment.
   */
  readonly began?: { readonly value: unknown };
}

const STALE_CELL =
  'This cell changed while it was being edited, so the edit was not written. Try again.';

/**
 * What committing a cell writes to its note (#300), refused with
 * {@link ChangedSinceError} — writing nothing — when the row now shows the
 * cell holding something other than it held as the edit began: an edit made
 * meanwhile, in another pane or another app, is not written over unseen.
 * Only the edited cell is judged; a change to another of the note's
 * properties is no reason to refuse this one. Setting a status to its done
 * option finishes the task as a tick does, so a repeating one rolls on.
 */
export function cellEditChanges({
  edit,
  now,
  status,
}: {
  edit: CellCommit;
  /** The row as the view draws it now; null when the view no longer shows it. */
  now: Values | null;
  /** The type's status, whose done option finishes the task. */
  status: StatusProperty | null;
}): PropertyChanges {
  const { column, began } = edit;
  if (began !== undefined && now !== null && !sameCellValue(began.value, now[column])) {
    throw new ChangedSinceError(STALE_CELL);
  }
  const value = cellWriteValue(edit.value);
  if (status !== null && column === status.key && value === status.done) {
    return doneChange({ status, done: true, previous: null });
  }
  return { [column]: value };
}
