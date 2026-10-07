import { nextOccurrence, parseRecurrence } from './recurrence.ts';

/** The frontmatter keys a repeating task is described with. */
export const RECURRENCE_KEY = 'recurrence';
export const DUE_KEY = 'due';
export const LAST_COMPLETED_KEY = 'lastCompleted';

/**
 * What to write when a repeating task is marked finished.
 *
 * A series is one note, not one note per occurrence: finishing it moves the due
 * date on and puts the task back in play. Keeping a file per occurrence would
 * fill the vault with notes nobody asked for, and lose the note's own history.
 *
 * Returns null when the task does not repeat, which is the ordinary case — the
 * caller then just writes what it was going to write.
 */
export function repeatingTaskUpdate({
  properties,
  statusKey,
  resetStatus,
}: {
  properties: Readonly<Record<string, unknown>>;
  statusKey: string;
  /** What the task goes back to, usually the first option of its status. */
  resetStatus: string;
}): Record<string, unknown> | null {
  const recurrence = parseRecurrence(properties[RECURRENCE_KEY]);
  if (recurrence === null) return null;

  const due = properties[DUE_KEY];
  const from = due === null || due === undefined ? '' : String(due);
  const next = nextOccurrence(from, recurrence);
  if (next === null) return null;

  return {
    [DUE_KEY]: next,
    [statusKey]: resetStatus,
    // Kept so it is possible to tell a rolled-over task from one never done.
    [LAST_COMPLETED_KEY]: from.slice(0, 10),
  };
}
