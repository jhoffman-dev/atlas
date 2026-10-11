/**
 * Timeblocking's rules (ADR-0030): how much of each task the calendar has
 * set time aside for.
 *
 * A block is read as written — wall-clock time where the person is, as the
 * calendar draws it — so its length never depends on the zone the machine is
 * in, and a block across midnight runs into the next day. Nothing here reads
 * the clock: a block counts whether it is past or to come.
 */
import { minutesBetween, readEventTime } from '../calendar/calendar-event.ts';

/** A task as the schedule reads it. */
export interface ScheduledTask {
  readonly path: string;
  /** Whole minutes it is expected to take, or null when it does not say. */
  readonly estimate: number | null;
  /** Whether it is finished: nothing of its estimate is left. */
  readonly finished: boolean;
}

/** A block on the calendar and the tasks it links, in the order it lists them. */
export interface TimeBlock {
  readonly path: string;
  /** Its `start` and `end` as written: `2026-10-08T09:00`. */
  readonly start: unknown;
  readonly end: unknown;
  readonly tasks: readonly ScheduledTask[];
}

/** A task's estimate beside what the calendar gives it and what is done of it, in minutes. */
export interface TaskSchedule {
  readonly estimate: number | null;
  readonly scheduled: number;
  /** All of the estimate for a finished task, none for one still open; null with no estimate. */
  readonly done: number | null;
  /** How far the time scheduled runs past the estimate; 0 within it, or with no estimate. */
  readonly overBy: number;
}

/**
 * A block's length in minutes, from its start to its end on the wall clock.
 * A block without both a day and a time at each end, or one ending no later
 * than it starts, gives no time to anything.
 */
export function blockMinutes(block: { readonly start: unknown; readonly end: unknown }): number {
  const start = readEventTime(block.start);
  const end = readEventTime(block.end);
  if (start === null || end === null || start.minutes === null || end.minutes === null) return 0;
  return Math.max(0, minutesBetween(start, end));
}

/** An estimate as whole minutes the rules can share, or null when it is none. */
const wholeEstimate = (estimate: number | null): number | null =>
  estimate !== null && Number.isFinite(estimate) && estimate >= 0 ? Math.round(estimate) : null;

/** What is left to do of a task, or null when nobody said how long it takes. */
const remaining = (task: ScheduledTask): number | null =>
  task.finished ? 0 : wholeEstimate(task.estimate);

/** Each task once, the first time the block lists it. */
function distinctTasks(tasks: readonly ScheduledTask[]): ScheduledTask[] {
  const byPath = new Map<string, ScheduledTask>();
  for (const task of tasks) if (!byPath.has(task.path)) byPath.set(task.path, task);
  return [...byPath.values()];
}

/**
 * `total` whole minutes shared in proportion to whole-minute `weights`, the
 * shares summing to `total` exactly: each gets the whole part of its share,
 * and the minutes left over go to the largest remainders — the earliest
 * listed on a tie — so the same block always shares the same way.
 *
 * Worked in exact integers: a remainder is `total × weight mod sum`, so two
 * equal remainders are equal however the division would have rounded, and an
 * estimate too large for a float's whole numbers still shares exactly.
 */
function apportion(total: number, weights: readonly number[]): number[] {
  const parts = weights.map((weight) => BigInt(weight));
  const sum = parts.reduce((acc, part) => acc + part, 0n);
  if (sum <= 0n) return weights.map(() => 0);
  const whole = BigInt(total);
  const shares = parts.map((part) => (whole * part) / sum);
  const left = Number(whole - shares.reduce((acc, share) => acc + share, 0n));
  const byRemainder = parts
    .map((part, at) => ({ at, remainder: (whole * part) % sum }))
    .sort((a, b) =>
      a.remainder === b.remainder ? a.at - b.at : a.remainder > b.remainder ? -1 : 1,
    );
  const result = shares.map(Number);
  for (const { at } of byRemainder.slice(0, left)) result[at] = (result[at] ?? 0) + 1;
  return result;
}

/**
 * A container block's time, shared by what its tasks have left of their
 * estimates. When they need at least the whole block, each gets its part in
 * proportion to what it has left. When they need less, each gets what it has
 * left, and the rest of the block goes in equal parts to the tasks with no
 * estimate — or stays free, when every task has one.
 */
function containerShares(length: number, tasks: readonly ScheduledTask[]): Map<string, number> {
  const estimated = tasks.flatMap((task) => {
    const left = remaining(task);
    return left === null ? [] : [{ path: task.path, left }];
  });
  const unestimated = tasks.filter((task) => remaining(task) === null);
  const needed = estimated.reduce((acc, task) => acc + task.left, 0);
  if (needed >= length) {
    const shares = apportion(
      length,
      estimated.map((task) => task.left),
    );
    return new Map([
      ...estimated.map((task, at) => [task.path, shares[at] ?? 0] as const),
      ...unestimated.map((task) => [task.path, 0] as const),
    ]);
  }
  const rest = apportion(
    length - needed,
    unestimated.map(() => 1),
  );
  return new Map([
    ...estimated.map((task) => [task.path, task.left] as const),
    ...unestimated.map((task, at) => [task.path, rest[at] ?? 0] as const),
  ]);
}

/**
 * The minutes a block gives each of its tasks. A block holding one task
 * gives it the whole block, whatever its estimate; a block holding several
 * is a container, and shares itself by what each has left to do.
 */
export function blockShares(block: TimeBlock): ReadonlyMap<string, number> {
  const tasks = distinctTasks(block.tasks);
  const length = blockMinutes(block);
  const [only] = tasks;
  if (tasks.length === 1 && only !== undefined) return new Map([[only.path, length]]);
  return containerShares(length, tasks);
}

/**
 * The minutes every task in any of `blocks` is scheduled for, summed over the
 * blocks. Each block counts on its own: a task in two blocks that overlap is
 * given the time of both, and so reads as over-scheduled rather than as
 * scheduled for less than the person set aside.
 */
export function scheduledMinutesByTask(blocks: readonly TimeBlock[]): ReadonlyMap<string, number> {
  const scheduled = new Map<string, number>();
  for (const block of blocks) {
    for (const [path, minutes] of blockShares(block)) {
      scheduled.set(path, (scheduled.get(path) ?? 0) + minutes);
    }
  }
  return scheduled;
}

/** The minutes `blocks` schedule the task at `path` for. */
export function scheduledMinutes(path: string, blocks: readonly TimeBlock[]): number {
  return scheduledMinutesByTask(blocks).get(path) ?? 0;
}

/**
 * A task's estimate, scheduled and done side by side. Done comes from the
 * task's status: a finished task has done all of its estimate.
 */
export function taskSchedule({
  task,
  scheduled,
}: {
  task: ScheduledTask;
  /** From {@link scheduledMinutesByTask}. */
  scheduled: number;
}): TaskSchedule {
  const estimate = wholeEstimate(task.estimate);
  if (estimate === null) return { estimate, scheduled, done: null, overBy: 0 };
  return {
    estimate,
    scheduled,
    done: task.finished ? estimate : 0,
    overBy: Math.max(0, scheduled - estimate),
  };
}
