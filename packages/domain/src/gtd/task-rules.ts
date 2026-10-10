import {
  FINISHED_TASK_STATUS,
  gtdStatusOf,
  holdsStatus,
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

/** The key a note says what it is by. */
const TASK_TYPE_KEY = 'type';

const isTask = (properties: Properties) =>
  String(properties[TASK_TYPE_KEY] ?? '')
    .trim()
    .toLowerCase() === TASK_TYPE;

/** A task Waiting with nobody to wait on: what the rules never let a change leave. */
const waitsOnNobody = (note: Properties) =>
  isTask(note) &&
  holdsStatus(note[TASK_KEYS.status], WAITING_STATUS) &&
  isBlankValue(note[TASK_KEYS.waitingOn]);

/** A finished task: Archive, on a note that is a task. */
const isFinished = (note: Properties) =>
  isTask(note) && holdsStatus(note[TASK_KEYS.status], FINISHED_TASK_STATUS);

/**
 * The change with a GTD status it sets in another spelling — `waiting `,
 * `[waiting]` — written as the status itself, on a note that is a task: the
 * index, the board and a tick all read the one spelling.
 */
function spelledAsStatus(before: Properties, changes: Properties): Properties {
  const status = TASK_KEYS.status;
  if (!has(changes, status) || !isTask(changed(before, changes))) return changes;
  const canonical = gtdStatusOf(changes[status]);
  return canonical === null || canonical === changes[status]
    ? changes
    : { ...changes, [status]: canonical };
}

/** Whether a change touches what the Waiting rule reads: the type, the status, who it waits on. */
const touchesWaiting = (changes: Properties) =>
  [TASK_TYPE_KEY, TASK_KEYS.status, TASK_KEYS.waitingOn].some((key) => has(changes, key));

/**
 * The GTD rules a change to a task is held to, whoever makes it — a board
 * drag, the properties panel, a tick, a new note, an automation, the API
 * (ADR-0029). They judge the note the change leaves, not the keys it names:
 *
 * - Waiting is waiting on someone: a change that leaves a task Waiting with
 *   nobody in `waiting_on` — by its status, by taking the person away, or by
 *   making a note that already says Waiting into a task — is refused, with
 *   the reason.
 * - Finishing is a day: a task that becomes finished (Archive) is given
 *   `completed:` today, unless the note it leaves says a day; one taken out
 *   of Archive loses its day, unless the change says one, so unticking
 *   leaves nothing stale behind.
 *
 * A status is read as the index reads it — trimmed, a one-item list as its
 * item — so a spelling the Waiting view lists is held to the rule too, and a
 * GTD status set in another spelling is written as the status itself.
 *
 * A note that is not a task passes as it is, and so does a change that
 * touches none of what the Waiting rule reads: a task already Waiting with
 * nobody set can still have its due date moved.
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
  return heldToRules({ before, changes: spelledAsStatus(before, changes), today });
}

function heldToRules({
  before,
  changes,
  today,
}: {
  before: Properties;
  changes: Properties;
  today: string;
}): TaskRuleOutcome {
  const after = changed(before, changes);
  if (waitsOnNobody(after) && touchesWaiting(changes)) return { refused: WAITING_NEEDS_SOMEONE };
  const completed = TASK_KEYS.completed;
  if (isFinished(after) && !isFinished(before) && isBlankValue(after[completed])) {
    return { changes: { ...changes, [completed]: today } };
  }
  const reopened = isFinished(before) && !isFinished(after) && isTask(after);
  if (reopened && !has(changes, completed) && !isBlankValue(before[completed])) {
    return { changes: { ...changes, [completed]: null } };
  }
  return { changes };
}
