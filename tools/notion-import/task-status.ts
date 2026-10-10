import type { ObjectType } from '../../packages/domain/src/index.ts';

/**
 * The eight GTD statuses (ADR-0029), in order. The domain holds them once the
 * GTD move (#21) is merged; this import is built beside it, so it reads the
 * vault's Task type for them and refuses to guess when they are not there.
 */
export const GTD_STATUSES = [
  'inbox',
  'backlog',
  'next-action',
  'in-progress',
  'waiting',
  'someday',
  'longterm',
  'archive',
] as const;

export type GtdStatus = (typeof GTD_STATUSES)[number];

const isGtdStatus = (value: string): value is GtdStatus =>
  (GTD_STATUSES as readonly string[]).includes(value);

/** What ticking a task sets, and so what a finished Notion task becomes. */
const FINISHED: GtdStatus = 'archive';
const WAITING: GtdStatus = 'waiting';
const CAPTURED: GtdStatus = 'inbox';

/**
 * Whether the vault's Task type follows GTD: its `status` is a choice of
 * exactly the eight, in order, finished by Archive — what the GTD move
 * leaves it as. Until then, a task's status would be a value its type does
 * not offer.
 */
export function isGtdTaskType(type: ObjectType | null): boolean {
  const status = type?.properties.find((property) => property.key === 'status');
  return (
    status !== undefined &&
    status.kind === 'select' &&
    status.done === FINISHED &&
    status.options.length === GTD_STATUSES.length &&
    status.options.every((option, at) => option === GTD_STATUSES[at])
  );
}

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
