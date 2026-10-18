import {
  taskAsRead,
  todayLists,
  TASK_KEYS,
  type TodayLists,
  type TodayTask,
  type VaultPath,
} from '@atlas/domain';
import type { PropertyChanges } from '../query/set-property.ts';
import type { TodayReport } from './read-today.ts';

/**
 * The Today page as it is drawn while the page's own changes are being
 * written (#260): each task a change is pending for, put where the change
 * leaves it — off the page once ticked done or deferred, in the section of
 * its new status once moved — by the page's own rules, before the write
 * lands and the index reads it back. Every other task is the object the read
 * made, so its row is not drawn again; the read itself when nothing changes.
 *
 * A change is worked out against the task as its row read it. One that
 * cannot be (a rule that refuses) leaves the task as read: the write will
 * refuse it too, and the row stays where it is.
 */
export function todayAsPending({
  report,
  pending,
}: {
  report: TodayReport;
  /** What is being written to each task, by its path. */
  pending: ReadonlyMap<VaultPath, PropertyChanges>;
}): TodayReport {
  const tasks = report.sections.flatMap((section) =>
    section.groups.flatMap((group) => group.tasks),
  );
  if (!tasks.some((task) => pending.has(task.path))) return report;
  const newest = tasks.reduce((latest, task) => Math.max(latest, task.modified), 0);
  const changed = new Map(
    tasks.flatMap((task) => {
      const values = pending.get(task.path);
      return values === undefined ? [] : [[task.path, asChanged(task, values, newest)] as const];
    }),
  );
  // Placed by the page's own rules; each task is then given back as the object
  // it is here, so the waiting days the read counted are kept as they were.
  const lists = todayLists({
    tasks: tasks.map((task) => changed.get(task.path) ?? task),
    projects: [],
    at: { today: report.today, now: newest },
  });
  const read = new Map(tasks.map((task) => [task.path, task]));
  return {
    ...report,
    sections: withTasks(lists, (task) => changed.get(task.path) ?? read.get(task.path) ?? task),
  };
}

/**
 * A task as a change leaves it. Written, its file changes now, so it is the
 * newest of the page's tasks and a Waiting task has waited no days yet.
 */
function asChanged(task: TodayTask, values: PropertyChanges, newest: number): TodayTask {
  const properties = {
    [TASK_KEYS.status]: task.status,
    [TASK_KEYS.due]: task.due,
    [TASK_KEYS.defer]: task.defer,
  };
  let changes: Readonly<Record<string, unknown>>;
  try {
    changes = typeof values === 'function' ? values(properties) : values;
  } catch {
    // Refused against the row as read: the write refuses it as well, and says why.
    return task;
  }
  const after = taskAsRead({ ...properties, ...changes });
  return {
    ...task,
    ...after,
    modified: newest,
    waitingDays: after.status === 'waiting' ? 0 : null,
  };
}

/** The sections, each task as `kept` gives it back. */
function withTasks(
  lists: TodayLists,
  kept: (task: TodayTask) => TodayTask,
): TodayReport['sections'] {
  return lists.sections.map((section) => ({
    ...section,
    groups: section.groups.map((group) => ({ ...group, tasks: group.tasks.map(kept) })),
  }));
}
