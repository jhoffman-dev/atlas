import { messageWithoutPaths, TASK_TYPE } from '@atlas/domain';
import { readTaskSchedules, taskTypeOf } from '../timeblocks/task-schedules.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import { ApiError } from './api-error.ts';
import type { ApiRows } from './contract.ts';
import type { VaultRequest } from './vault-request.ts';

/** The column a query of tasks gains when it asks for each task's schedule. */
export const SCHEDULE_COLUMN = 'schedule';

/**
 * Refuses `schedule` on a query it cannot answer: one of another type, which
 * has no estimate to schedule, or one already naming a `schedule` column,
 * which the answer would hide.
 */
export function checkScheduleAsked({
  type,
  columns,
}: {
  type: string;
  columns: readonly string[];
}): void {
  if (type.trim().toLowerCase() !== TASK_TYPE) {
    throw new ApiError('invalid', `schedule is for a query of tasks, not ${type}`);
  }
  if (columns.includes(SCHEDULE_COLUMN)) {
    throw new ApiError(
      'invalid',
      `columns names "${SCHEDULE_COLUMN}", which schedule would answer instead: leave one out`,
    );
  }
}

/**
 * The rows with each task's schedule as a last column (P31-01): its estimate,
 * the minutes its blocks set aside, what is done, and how far it is over —
 * `{ estimate, scheduled, done, overBy }`, as the task's page shows them.
 * A schedule the index could not read whole is `query_failed`, never a short
 * answer.
 */
export async function withSchedules(request: VaultRequest, rows: ApiRows): Promise<ApiRows> {
  const at = rows.columns.indexOf('path');
  const paths = rows.rows.map((row) => String(row[at]));
  try {
    const types = await loadObjectTypes({ fs: request.fs, markdown: request.markdown });
    const schedules = await readTaskSchedules({
      index: request.index,
      paths,
      taskType: taskTypeOf(types),
    });
    return {
      ...rows,
      columns: [...rows.columns, SCHEDULE_COLUMN],
      rows: rows.rows.map((row, index) => [...row, schedules.get(paths[index] ?? '') ?? null]),
    };
  } catch (error) {
    throw new ApiError('query_failed', messageWithoutPaths(error));
  }
}
