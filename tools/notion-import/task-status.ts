import {
  FINISHED_TASK_STATUS,
  GTD_STATUSES,
  isGtdStatus,
  NEW_TASK_STATUS,
  WAITING_STATUS,
  type GtdStatus,
} from '../../packages/domain/src/index.ts';

/*
 * The GTD statuses and rules are the domain's (ADR-0029); this maps Notion's
 * statuses onto them. Whether the vault's Task type follows GTD is the
 * domain's `followsGtd`, which the import checks before it writes a task.
 */
const FINISHED = FINISHED_TASK_STATUS;
const WAITING = WAITING_STATUS;
const CAPTURED = NEW_TASK_STATUS;

/** A status as written in Notion, compared without case or extra spaces. */
const spelled = (status: string) => status.trim().replace(/\s+/g, ' ').toLowerCase();

/** Each Notion status, as compared, and the GTD status it becomes (issue #79). */
export const DEFAULT_TASK_STATUSES: ReadonlyMap<string, GtdStatus> = new Map([
  ['inbox', 'inbox'],
  ['ready', 'next-action'],
  ['next action', 'next-action'],
  ['later', 'someday'],
  ['in progress', 'in-progress'],
  ['waiting', 'waiting'],
  ['done', 'archive'],
]);

/** A `--task-status` the import cannot use. */
export class TaskStatusError extends Error {
  override readonly name = 'TaskStatusError';
}

/** The default mapping with each `Notion status=gtd-status` given put over it. */
export function taskStatuses(overrides: readonly string[]): ReadonlyMap<string, GtdStatus> {
  const statuses = new Map(DEFAULT_TASK_STATUSES);
  for (const override of overrides) {
    const at = override.lastIndexOf('=');
    const [notion, gtd] = [override.slice(0, at), override.slice(at + 1).trim()];
    if (at < 0 || spelled(notion) === '') {
      throw new TaskStatusError(`--task-status: "${override}" is not <Notion status>=<status>`);
    }
    if (!isGtdStatus(gtd)) {
      throw new TaskStatusError(`--task-status: "${gtd}" is not one of ${GTD_STATUSES.join(', ')}`);
    }
    statuses.set(spelled(notion), gtd);
  }
  return statuses;
}

/** What a Notion task says about where it stands. */
export interface NotionTaskState {
  readonly notionStatus: string;
  /** The link to the first person in People, or null when there is nobody. */
  readonly firstPerson: string | null;
  /** The Due date, `YYYY-MM-DD`, or null. */
  readonly due: string | null;
  /** The day of the run, `YYYY-MM-DD`. */
  readonly today: string;
}

/** The task's GTD fields, and anything about them the report should say. */
export interface TaskState {
  readonly status: GtdStatus;
  readonly waitingOn: string | null;
  /** Set only where the task has none: the day it was found finished. */
  readonly completed: string | null;
  /** Set only where the task has none: a Due date still to come. */
  readonly scheduled: string | null;
  readonly note: string | null;
}

/** Where a status the mapping does not know, or a Waiting task with nobody to wait on, goes: the Inbox. */
function held(state: NotionTaskState, statuses: ReadonlyMap<string, GtdStatus>) {
  const status = statuses.get(spelled(state.notionStatus));
  if (status === undefined) {
    const note =
      spelled(state.notionStatus) === ''
        ? null
        : `status "${state.notionStatus}" is not one this import maps: put in the Inbox`;
    return { status: CAPTURED, note };
  }
  if (status === WAITING && state.firstPerson === null) {
    return { status: CAPTURED, note: 'Waiting with nobody in People: held in the Inbox' };
  }
  return { status, note: null };
}

/**
 * A Notion task's status as one of the GTD eight. A Waiting task waits on
 * the first person in People, and is held in the Inbox when there is nobody;
 * a finished one is Archive, completed on the day it was found finished; a
 * Due date still to come is also when it is scheduled.
 */
export function taskState(
  state: NotionTaskState,
  statuses: ReadonlyMap<string, GtdStatus>,
): TaskState {
  const { status, note } = held(state, statuses);
  return {
    status,
    waitingOn: status === WAITING ? state.firstPerson : null,
    completed: status === FINISHED ? state.today : null,
    scheduled:
      status !== FINISHED && state.due !== null && state.due > state.today ? state.due : null,
    note,
  };
}
