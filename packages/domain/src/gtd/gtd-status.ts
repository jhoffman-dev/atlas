/**
 * Tasks in Atlas follow GTD (ADR-0029): exactly these eight statuses, in the
 * order work moves through them. "Done" is not one of them — a finished task
 * is `archive`, with the day it was finished in `completed`.
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

/** Each status as James writes it. */
export const GTD_STATUS_LABELS: Readonly<Record<GtdStatus, string>> = {
  inbox: 'Inbox',
  backlog: 'Backlog',
  'next-action': 'Next Action',
  'in-progress': 'In Progress',
  waiting: 'Waiting',
  someday: 'Someday',
  longterm: 'Longterm',
  archive: 'Archive',
};

/** Where a new task starts: captured, it waits to be processed. */
export const NEW_TASK_STATUS: GtdStatus = 'inbox';

/** What ticking a task sets: finished work leaves every list in one move. */
export const FINISHED_TASK_STATUS: GtdStatus = 'archive';

/**
 * Where a finished task goes back to when nothing remembers where it was —
 * unticked after a restart, or a repeating one rolled on to its next date:
 * it was something to do, so it is something to do next.
 */
export const REOPENED_TASK_STATUS: GtdStatus = 'next-action';

/** The status that needs someone to be waiting on. */
export const WAITING_STATUS: GtdStatus = 'waiting';

/** The type tasks are notes of. */
export const TASK_TYPE = 'task';

/** The keys the GTD task model reads, as they are written in a task's frontmatter. */
export const TASK_KEYS = {
  status: 'status',
  waitingOn: 'waiting_on',
  contexts: 'contexts',
  defer: 'defer',
  due: 'due',
  completed: 'completed',
  estimate: 'estimate',
  source: 'source',
} as const;

const STATUSES: ReadonlySet<string> = new Set(GTD_STATUSES);

/** Whether a value is one of the eight statuses, exactly as written. */
export function isGtdStatus(value: unknown): value is GtdStatus {
  return typeof value === 'string' && STATUSES.has(value);
}

/** Whether a task property says nothing: absent, empty, or an empty list. */
export function isBlankValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}
