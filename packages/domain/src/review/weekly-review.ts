import { FINISHED_TASK_STATUS, TASK_KEYS, type GtdStatus } from '../gtd/gtd-status.ts';
import { addDays } from '../timeline/timeline.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** A task as the weekly review reads it. */
export interface ReviewTask {
  readonly path: VaultPath;
  readonly title: string;
  /** Its GTD status as the index reads it, or null when it holds none of the eight. */
  readonly status: GtdStatus | null;
  /** `YYYY-MM-DD`, or null when it has none. */
  readonly due: string | null;
  /** `YYYY-MM-DD`: the day it comes back into play; null when it is not deferred. */
  readonly defer: string | null;
  /** Who it waits on, as its `waiting_on` names them; '' for nobody. */
  readonly waitingOn: string;
  /** The note its `project` links, or null when it links none that exists. */
  readonly project: VaultPath | null;
  /** When its file last changed, in milliseconds since the epoch. */
  readonly modified: number;
}

/** A project as the weekly review reads it. */
export interface ReviewProject {
  readonly path: VaultPath;
  readonly title: string;
  /** Its `status:` as written, trimmed; null when it has none. */
  readonly status: string | null;
}

/** What the weekly review puts in front of you, a section per question GTD asks of the week. */
export interface WeeklyReview {
  /** Waiting on someone, and not looked at for more than {@link STALE_WAITING_DAYS} days. */
  readonly staleWaiting: readonly ReviewTask[];
  /** Active, with nothing filed under it to do next. */
  readonly projectsWithoutNextAction: readonly ReviewProject[];
  /** Due before today and still open. */
  readonly overdue: readonly ReviewTask[];
  /** Someday or Longterm, and not looked at for more than {@link UNTOUCHED_SOMEDAY_DAYS} days. */
  readonly untouchedSomeday: readonly ReviewTask[];
}

/** How long a Waiting task goes unlooked-at before the review asks about it. */
export const STALE_WAITING_DAYS = 7;

/** How long a Someday or Longterm task goes unlooked-at before the review asks about it. */
export const UNTOUCHED_SOMEDAY_DAYS = 30;

/** The project status that says work on it is under way. */
export const ACTIVE_PROJECT_STATUS = 'active';

/** How far the review's Defer puts a task off. */
export const REVIEW_DEFER_DAYS = 7;

const DAY_MS = 86_400_000;

/** Work still open: an overdue task in one of these is late. Someday and Longterm promise no day. */
const COMMITTED: ReadonlySet<GtdStatus> = new Set([
  'inbox',
  'backlog',
  'next-action',
  'in-progress',
  'waiting',
]);

/** What a project counts as moving: something to do next, or something under way. */
const MOVING: ReadonlySet<GtdStatus> = new Set(['next-action', 'in-progress']);

const SOMEDAY: ReadonlySet<GtdStatus> = new Set(['someday', 'longterm']);

/** The moment the review is taken: today where the person is, and now. */
export interface ReviewMoment {
  /** `YYYY-MM-DD`, from the injected clock. */
  readonly today: string;
  /** Milliseconds since the epoch, from the injected clock. */
  readonly now: number;
}

/**
 * The weekly review (P30-07): GTD's questions of the week, answered from the
 * tasks and projects the vault holds.
 *
 * A task's file last changing is when it was last looked at — Atlas keeps no
 * "waiting since" key (ADR-0029 turned down keys nobody asked for), so any
 * edit, including the review's own, counts as a look. A task deferred to a
 * later day is out of every section until that day, as it is out of Next
 * actions: that is what Defer is for.
 */
export function weeklyReview({
  tasks,
  projects,
  at,
}: {
  tasks: readonly ReviewTask[];
  projects: readonly ReviewProject[];
  at: ReviewMoment;
}): WeeklyReview {
  const inPlay = tasks.filter((task) => !isDeferred(task, at.today));
  return {
    staleWaiting: oldestFirst(
      inPlay.filter(
        (task) => task.status === 'waiting' && untouchedFor(task, STALE_WAITING_DAYS, at),
      ),
    ),
    projectsWithoutNextAction: projectsWithoutNextAction(projects, tasks),
    overdue: inPlay.filter((task) => isOverdue(task, at.today)).sort(byDueThenTitle),
    untouchedSomeday: oldestFirst(
      inPlay.filter(
        (task) =>
          task.status !== null &&
          SOMEDAY.has(task.status) &&
          untouchedFor(task, UNTOUCHED_SOMEDAY_DAYS, at),
      ),
    ),
  };
}

function isDeferred(task: ReviewTask, today: string): boolean {
  return task.defer !== null && task.defer > today;
}

/** More than `days` whole days since the file last changed. */
function untouchedFor(task: ReviewTask, days: number, at: ReviewMoment): boolean {
  return at.now - task.modified > days * DAY_MS;
}

function isOverdue(task: ReviewTask, today: string): boolean {
  return (
    task.due !== null && task.due < today && task.status !== null && COMMITTED.has(task.status)
  );
}

/**
 * Active projects with no task filed under them that is Next Action or In
 * Progress. A deferred next action still counts: the project knows what
 * comes next, just not yet.
 */
function projectsWithoutNextAction(
  projects: readonly ReviewProject[],
  tasks: readonly ReviewTask[],
): ReviewProject[] {
  const moving = new Set(
    tasks.flatMap((task) =>
      task.project !== null && task.status !== null && MOVING.has(task.status)
        ? [task.project]
        : [],
    ),
  );
  return projects
    .filter((project) => project.status === ACTIVE_PROJECT_STATUS && !moving.has(project.path))
    .sort(byTitle);
}

/** Longest untouched first: what has waited longest is asked about first. */
function oldestFirst(tasks: ReviewTask[]): ReviewTask[] {
  return tasks.sort((left, right) => left.modified - right.modified || byTitle(left, right));
}

function byDueThenTitle(left: ReviewTask, right: ReviewTask): number {
  return (left.due ?? '').localeCompare(right.due ?? '') || byTitle(left, right);
}

function byTitle(left: { title: string; path: string }, right: { title: string; path: string }) {
  return left.title.localeCompare(right.title) || left.path.localeCompare(right.path);
}

/** What the review's Defer writes into a task: back in play {@link REVIEW_DEFER_DAYS} days from today. */
export function reviewDeferral(today: string): Readonly<Record<string, string>> | null {
  const day = addDays(today, REVIEW_DEFER_DAYS);
  return day === null ? null : { [TASK_KEYS.defer]: day };
}

/** What the review's Archive writes into a task: finished, which the task rules date. */
export const REVIEW_ARCHIVE: Readonly<Record<string, string>> = {
  [TASK_KEYS.status]: FINISHED_TASK_STATUS,
};
