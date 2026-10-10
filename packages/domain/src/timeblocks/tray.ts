import type { TaskSchedule } from './scheduling.ts';

/** A task the planning tray offers to the calendar, with what its blocks give it so far. */
export interface TrayTask {
  readonly path: string;
  readonly title: string;
  /** Null when its schedule could not be read. */
  readonly schedule: TaskSchedule | null;
}

/** Whether no block gives the task any time yet. */
export const isUnscheduled = (task: TrayTask): boolean => (task.schedule?.scheduled ?? 0) === 0;

/**
 * The tray's tasks in the order it lists them (P31-02): the next actions with
 * no time set aside yet first, then those that have some, each part in the
 * order Next actions lists them — so what still needs planning is at the top.
 */
export function trayOrder(tasks: readonly TrayTask[]): TrayTask[] {
  return [...tasks.filter(isUnscheduled), ...tasks.filter((task) => !isUnscheduled(task))];
}
