import {
  FINISHED_TASK_STATUS,
  isBlankValue,
  TASK_KEYS,
  TASK_TYPE,
  WAITING_STATUS,
} from './gtd-status.ts';

type Properties = Readonly<Record<string, unknown>>;

/** Why a task cannot be Waiting yet, in the words the app shows. */
export const WAITING_NEEDS_SOMEONE =
  'A waiting task needs someone to wait on: set Waiting on first, then move it to Waiting.';

/** What a change to a task comes to under its rules: the changes to write, or why not. */
export type TaskRuleOutcome = { readonly changes: Properties } | { readonly refused: string };

const has = (properties: Properties, key: string) => Object.hasOwn(properties, key);

/** The note as the change leaves it: a null in the changes takes the key out. */
function changed(before: Properties, changes: Properties): Properties {
  const after: Record<string, unknown> = { ...before };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === undefined) delete after[key];
    else after[key] = value;
  }
  return after;
}

const isTask = (properties: Properties) =>
  String(properties['type'] ?? '')
    .trim()
    .toLowerCase() === TASK_TYPE;

/**
 * The GTD rules a change to a task is held to, whoever makes it — a board
 * drag, the properties panel, a tick, the API (ADR-0029):
 *
 * - Waiting is waiting on someone: a change that leaves a task Waiting with
 *   nobody in `waiting_on` is refused, with the reason.
 * - Finishing is a day: a task that becomes Archive is given `completed:`
 *   today, unless the change says a day itself; one taken out of Archive
 *   loses it, so unticking leaves no stale day behind.
 *
 * A note that is not a task, and a change that touches neither its status
 * nor who it waits on, passes as it is: a task already Waiting with nobody
 * set can still have its due date moved.
 */
export function taskRuleChanges({
  before,
  changes,
  today,
}: {
  before: Properties;
  changes: Properties;
  /** `YYYY-MM-DD`, from the injected clock. */
  today: string;
}): TaskRuleOutcome {
  const after = changed(before, changes);
  if (!isTask(after)) return { changes };
  const status = TASK_KEYS.status;
  const statusMoved = has(changes, status) && after[status] !== before[status];
  const waitingTouched = statusMoved || has(changes, TASK_KEYS.waitingOn);
  if (
    waitingTouched &&
    after[status] === WAITING_STATUS &&
    isBlankValue(after[TASK_KEYS.waitingOn])
  ) {
    return { refused: WAITING_NEEDS_SOMEONE };
  }
  if (!statusMoved || has(changes, TASK_KEYS.completed)) return { changes };
  if (after[status] === FINISHED_TASK_STATUS && isBlankValue(after[TASK_KEYS.completed])) {
    return { changes: { ...changes, [TASK_KEYS.completed]: today } };
  }
  if (before[status] === FINISHED_TASK_STATUS && !isBlankValue(before[TASK_KEYS.completed])) {
    return { changes: { ...changes, [TASK_KEYS.completed]: null } };
  }
  return { changes };
}
