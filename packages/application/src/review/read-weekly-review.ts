import {
  compileReviewProjectsQuery,
  compileReviewTasksQuery,
  reviewProject,
  reviewTask,
  weeklyReview,
  type CompiledQuery,
  type WeeklyReview,
} from '@atlas/domain';
import { listInbox } from '../inbox/list-inbox.ts';
import type { IndexPort, QueryResult } from '../index/ports.ts';
import type { Clock } from '../ports.ts';

/** The weekly review as it is shown: its sections, and what waits in the Inbox. */
export interface WeeklyReviewReport extends WeeklyReview {
  /** The day the review was taken, `YYYY-MM-DD`. */
  readonly today: string;
  /** How many notes wait in the Inbox; `more` when there are more than it counts. */
  readonly inbox: { readonly count: number; readonly more: boolean };
  /** The index held rows back, so a section may be missing items. */
  readonly truncated: boolean;
}

/**
 * Takes the weekly review (P30-07): every open task and every project, read
 * from the index and put through the review's rules on the injected clock,
 * with the Inbox counted the way its page counts it.
 */
export async function readWeeklyReview({
  index,
  clock,
}: {
  index: Pick<IndexPort, 'query'>;
  clock: Pick<Clock, 'today' | 'now'>;
}): Promise<WeeklyReviewReport> {
  const [tasks, projects, inbox] = await Promise.all([
    rowsOf(index, compileReviewTasksQuery()),
    rowsOf(index, compileReviewProjectsQuery()),
    listInbox({ index }),
  ]);
  const at = { today: clock.today(), now: clock.now() };
  return {
    ...weeklyReview({
      tasks: tasks.rows.map(reviewTask),
      projects: projects.rows.map(reviewProject),
      at,
    }),
    today: at.today,
    inbox: { count: inbox.items.length, more: inbox.truncated },
    truncated: tasks.truncated || projects.truncated,
  };
}

/** A statement's rows, each keyed by its columns. */
async function rowsOf(
  index: Pick<IndexPort, 'query'>,
  { sql, parameters }: CompiledQuery,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
  const result: QueryResult = await index.query(sql, parameters);
  const rows = result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column, at) => [column, row[at]])),
  );
  return { rows, truncated: result.truncated };
}
