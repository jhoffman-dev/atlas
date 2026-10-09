/**
 * What the schedule reads from the index: the tasks asked about, and every
 * block that links any of them with all the tasks it links — a container's
 * time is shared among them all, so none can be left out.
 */
import { TASK_KEYS, TASK_TYPE } from '../gtd/gtd-status.ts';
import { outsideAtlasSql, type CompiledQuery } from '../query/view-query.ts';
import { BLOCK_KEYS, BLOCK_TYPE } from './block-type.ts';
import { estimateMinutes } from './duration.ts';
import type { ScheduledTask, TimeBlock } from './scheduling.ts';

/** Marks both questions, so a stand-in for the host can tell them from others. */
export const TASK_SCHEDULE_QUERY_MARK = '/* task schedule */';

/** How many tasks one question carries, well inside SQLite's limit on bound values. */
export const SCHEDULE_PATHS_PER_QUERY = 200;

/** The status that means a task is finished: what ticking it writes, under its key. */
export interface FinishedStatus {
  readonly key: string;
  readonly value: string;
}

/** A row of {@link compileScheduledTasksQuery}. */
export interface ScheduledTaskRow {
  readonly path: unknown;
  readonly estimate: unknown;
  readonly finished: unknown;
}

/** A row of {@link compileTimeblocksQuery}: one task a block links. */
export interface TimeblockRow extends ScheduledTaskRow {
  readonly block: unknown;
  readonly start: unknown;
  readonly end: unknown;
}

/** A property's value when the note holds exactly one, else null: a list is no single time. */
const singleText = (path: string, key: string) =>
  `(SELECT CASE WHEN count(*) = 1 THEN min(v.value_text) END FROM props AS v WHERE v.path = ${path} AND v.key = '${key}')`;

const isOfType = (path: string) =>
  `EXISTS (SELECT 1 FROM props AS k WHERE k.path = ${path} AND k.key = 'type' AND lower(trim(k.value_text)) = ?)`;

/** 1 when the task holds the finished status, else 0; always 0 when nothing means finished. */
function finishedSql(path: string, finished: FinishedStatus | null): CompiledQuery {
  if (finished === null) return { sql: '0', parameters: [] };
  return {
    sql: `EXISTS (SELECT 1 FROM props AS s WHERE s.path = ${path} AND s.key = ? AND s.value_text = ?)`,
    parameters: [finished.key, finished.value],
  };
}

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(', ');

/**
 * Each task among `paths` with its estimate and whether it is finished.
 * Columns: path, estimate, finished. A path that is not a task is left out.
 */
export function compileScheduledTasksQuery({
  paths,
  finished,
}: {
  paths: readonly string[];
  finished: FinishedStatus | null;
}): CompiledQuery {
  const done = finishedSql('t.path', finished);
  return {
    sql: [
      `${TASK_SCHEDULE_QUERY_MARK} SELECT t.path AS "path", ${singleText('t.path', TASK_KEYS.estimate)} AS "estimate",`,
      `  ${done.sql} AS "finished"`,
      `FROM files AS t`,
      `WHERE t.path IN (${placeholders(paths.length)}) AND ${isOfType('t.path')}`,
      `ORDER BY t.path`,
    ].join('\n'),
    parameters: [...done.parameters, ...paths, TASK_TYPE],
  };
}

/**
 * Every block outside `.atlas` that links any task among `paths`, one row per
 * task it links — those and its others — in the order it lists them.
 * Columns: block, start, end, path, estimate, finished. A link that resolves
 * to no note, or to a note that is not a task, is no task of the block's.
 */
export function compileTimeblocksQuery({
  paths,
  finished,
}: {
  paths: readonly string[];
  finished: FinishedStatus | null;
}): CompiledQuery {
  const done = finishedSql('r.dst', finished);
  return {
    sql: [
      `${TASK_SCHEDULE_QUERY_MARK} SELECT b.path AS "block", ${singleText('b.path', BLOCK_KEYS.start)} AS "start",`,
      `  ${singleText('b.path', BLOCK_KEYS.end)} AS "end", r.dst AS "path",`,
      `  ${singleText('r.dst', TASK_KEYS.estimate)} AS "estimate", ${done.sql} AS "finished"`,
      `FROM files AS b`,
      `JOIN relations AS r ON r.src = b.path AND r.key = '${BLOCK_KEYS.tasks}'`,
      `WHERE ${outsideAtlasSql('b.path')} AND ${isOfType('b.path')} AND ${isOfType('r.dst')}`,
      `  AND b.path IN (SELECT l.src FROM relations AS l WHERE l.key = '${BLOCK_KEYS.tasks}'`,
      `    AND l.dst IN (${placeholders(paths.length)}))`,
      `ORDER BY b.path, r.idx, r.dst`,
    ].join('\n'),
    parameters: [...done.parameters, BLOCK_TYPE, TASK_TYPE, ...paths],
  };
}

/** A task as the schedule reads it, from its row. */
export function scheduledTaskOf(row: ScheduledTaskRow): ScheduledTask {
  return {
    path: String(row.path),
    estimate: estimateMinutes(row.estimate),
    finished: Number(row.finished) === 1,
  };
}

/** The blocks the rows describe, each with its tasks in the order the rows give them. */
export function timeBlocksOf(rows: readonly TimeblockRow[]): TimeBlock[] {
  const blocks = new Map<string, { start: unknown; end: unknown; tasks: ScheduledTask[] }>();
  for (const row of rows) {
    const path = String(row.block);
    const block = blocks.get(path) ?? { start: row.start, end: row.end, tasks: [] };
    block.tasks.push(scheduledTaskOf(row));
    blocks.set(path, block);
  }
  return [...blocks].map(([path, block]) => ({ path, ...block }));
}
