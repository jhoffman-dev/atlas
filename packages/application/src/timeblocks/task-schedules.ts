import {
  compileScheduledTasksQuery,
  compileTimeblocksQuery,
  SCHEDULE_PATHS_PER_QUERY,
  scheduledMinutesByTask,
  scheduledTaskOf,
  statusOf,
  taskSchedule,
  TASK_TYPE,
  timeBlocksOf,
  type CompiledQuery,
  type FinishedStatus,
  type ObjectType,
  type ScheduledTaskRow,
  type TaskSchedule,
  type TimeblockRow,
} from '@atlas/domain';
import type { IndexPort, QueryResult } from '../index/ports.ts';

/** A row of a result, read by column name. */
type Cell = (column: string) => unknown;

/** Why a schedule could not be read whole, rather than read short and believed. */
export class ScheduleIncompleteError extends Error {
  constructor() {
    super(
      'These tasks are linked from more blocks than the index returns at once, so their schedule cannot be read.',
    );
    this.name = 'ScheduleIncompleteError';
  }
}

/** The vault's Task type among its types, or null when it has none. */
export function taskTypeOf(types: readonly ObjectType[]): ObjectType | null {
  return types.find((type) => type.name.trim().toLowerCase() === TASK_TYPE) ?? null;
}

/** What ticking a task writes, under its key: the status a finished task holds. */
function finishedStatusOf(taskType: ObjectType | null): FinishedStatus | null {
  const status = statusOf(taskType);
  return status === null ? null : { key: status.key, value: status.done };
}

/**
 * Each task among `paths` with its estimate, scheduled and done (P31-01),
 * read from the index: the tasks, and every block linking any of them with
 * all the tasks it links, since a container's time is shared among them all.
 * A path that is not a task has no schedule. A finished task is one holding
 * the status ticking writes — Archive, for GTD's Task type.
 *
 * Throws {@link ScheduleIncompleteError} when the index cannot return every
 * block at once: a schedule read from some of them would be wrong.
 */
export async function readTaskSchedules({
  index,
  paths,
  taskType,
}: {
  index: Pick<IndexPort, 'query'>;
  paths: readonly string[];
  taskType: ObjectType | null;
}): Promise<ReadonlyMap<string, TaskSchedule>> {
  const finished = finishedStatusOf(taskType);
  const schedules = new Map<string, TaskSchedule>();
  for (let at = 0; at < paths.length; at += SCHEDULE_PATHS_PER_QUERY) {
    const asked = paths.slice(at, at + SCHEDULE_PATHS_PER_QUERY);
    const tasks = await rowsOf(index, compileScheduledTasksQuery({ paths: asked, finished }));
    const blocks = await rowsOf(index, compileTimeblocksQuery({ paths: asked, finished }));
    const scheduled = scheduledMinutesByTask(timeBlocksOf(blocks.map(timeblockRow)));
    for (const task of tasks.map(taskRow).map(scheduledTaskOf)) {
      schedules.set(task.path, taskSchedule({ task, scheduled: scheduled.get(task.path) ?? 0 }));
    }
  }
  return schedules;
}

/** The query's rows, each read by column name; refused when the row cap cut them short. */
async function rowsOf(index: Pick<IndexPort, 'query'>, query: CompiledQuery): Promise<Cell[]> {
  const result: QueryResult = await index.query(query.sql, query.parameters);
  if (result.truncated) throw new ScheduleIncompleteError();
  return result.rows.map((row) => (column) => row[result.columns.indexOf(column)]);
}

const taskRow = (cell: Cell): ScheduledTaskRow => ({
  path: cell('path'),
  estimate: cell('estimate'),
  finished: cell('finished'),
});

const timeblockRow = (cell: Cell): TimeblockRow => ({
  ...taskRow(cell),
  block: cell('block'),
  start: cell('start'),
  end: cell('end'),
});
