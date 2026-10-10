import {
  compileScheduledTasksQuery,
  compileTimeblocksQuery,
  SCHEDULE_PATHS_PER_QUERY,
  scheduledMinutesByTask,
  scheduledTaskOf,
  statusOf,
  taskSchedule,
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
      'A block links more tasks than the index returns at once, so the schedule cannot be read.',
    );
    this.name = 'ScheduleIncompleteError';
  }
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
 * The blocks are read a page at a time, each going on from the last block
 * the row cap left whole, so any number of blocks can be read. Throws
 * {@link ScheduleIncompleteError} only when one block alone links more tasks
 * than the cap returns: a schedule read from part of it would be wrong.
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
    const blocks = await readBlocks({ index, paths: asked, finished });
    const scheduled = scheduledMinutesByTask(timeBlocksOf(blocks));
    for (const task of tasks.map(taskRow).map(scheduledTaskOf)) {
      schedules.set(task.path, taskSchedule({ task, scheduled: scheduled.get(task.path) ?? 0 }));
    }
  }
  return schedules;
}

/**
 * Every block linking any of `paths`, with all its tasks. A page the row cap
 * cut short may end partway through its last block, so that block is read
 * again from the start of the next page.
 */
async function readBlocks({
  index,
  paths,
  finished,
}: {
  index: Pick<IndexPort, 'query'>;
  paths: readonly string[];
  finished: FinishedStatus | null;
}): Promise<TimeblockRow[]> {
  const read: TimeblockRow[] = [];
  for (let after = ''; ;) {
    const query = compileTimeblocksQuery({ paths, finished, after });
    const page = await index.query(query.sql, query.parameters);
    const rows = cellsOf(page).map(timeblockRow);
    if (!page.truncated) return [...read, ...rows];
    const cut = rows.at(-1)?.block;
    const whole = rows.filter((row) => row.block !== cut);
    const last = whole.at(-1);
    if (last === undefined) throw new ScheduleIncompleteError();
    read.push(...whole);
    after = String(last.block);
  }
}

/** The query's rows, each read by column name; refused when the row cap cut them short. */
async function rowsOf(index: Pick<IndexPort, 'query'>, query: CompiledQuery): Promise<Cell[]> {
  const result = await index.query(query.sql, query.parameters);
  if (result.truncated) throw new ScheduleIncompleteError();
  return cellsOf(result);
}

const cellsOf = (result: QueryResult): Cell[] =>
  result.rows.map((row) => (column) => row[result.columns.indexOf(column)]);

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
