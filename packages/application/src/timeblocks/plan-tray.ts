import {
  NEXT_ACTIONS_QUERY,
  taskTypeOf,
  trayOrder,
  type ObjectType,
  type TrayTask,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { runAtlasQuery } from '../query/run-atlas-query.ts';
import { readTaskSchedules } from './task-schedules.ts';

/**
 * The tasks the planning tray offers (P31-02): the next actions, as the Next
 * actions view lists them — a task deferred to a later day stays out until
 * that day — each with what its blocks give it, the ones with no time yet
 * first. Throws what the query or the schedule throws, for the tray to say.
 */
export async function readPlanTray({
  index,
  types,
  notePaths,
}: {
  index: IndexPort;
  types: readonly ObjectType[];
  notePaths: readonly string[];
}): Promise<TrayTask[]> {
  const { result } = await runAtlasQuery({ index, text: NEXT_ACTIONS_QUERY, types, notePaths });
  const column = (name: string) => result.columns.indexOf(name);
  const listed = result.rows.map((row) => ({
    path: String(row[column('path')]),
    title: String(row[column('title')]),
  }));
  const schedules = await readTaskSchedules({
    index,
    paths: listed.map((task) => task.path),
    taskType: taskTypeOf(types),
  });
  return trayOrder(listed.map((task) => ({ ...task, schedule: schedules.get(task.path) ?? null })));
}
