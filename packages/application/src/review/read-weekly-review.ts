import {
  compileReviewProjectsQuery,
  compileReviewTasksQuery,
  inboxWaiting,
  reviewProject,
  reviewTask,
  weeklyReview,
  type CompiledQuery,
  type WeeklyReview,
} from '@atlas/domain';
import { listInbox } from '../inbox/list-inbox.ts';
import type { IndexPort, QueryResult } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { Clock } from '../ports.ts';
import { listProposals } from '../proposals/list-proposals.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** The weekly review as it is shown: its sections, and what waits in the Inbox. */
export interface WeeklyReviewReport extends WeeklyReview {
  /** The day the review was taken, `YYYY-MM-DD`. */
  readonly today: string;
  /**
   * What waits in the one Inbox, counted as the sidebar counts it: `count` is
   * the notes to file (`toFile`) and the proposals to answer (`toAnswer`);
   * `more` when there are more notes than it counts.
   */
  readonly inbox: {
    readonly count: number;
    readonly toFile: number;
    readonly toAnswer: number;
    readonly more: boolean;
  };
  /** The index held rows back, so a section may be missing items. */
  readonly truncated: boolean;
}

/**
 * Takes the weekly review (P30-07): every open task and every project, read
 * from the index and put through the review's rules on the injected clock,
 * with the Inbox counted as the sidebar counts it: notes to file and
 * proposals to answer.
 */
export async function readWeeklyReview({
  index,
  fs,
  markdown,
  clock,
}: {
  index: Pick<IndexPort, 'query'>;
  /** Where the proposals waiting in the Inbox are read from. */
  fs: VaultFsPort;
  markdown: MarkdownPort;
  clock: Pick<Clock, 'today' | 'now'>;
}): Promise<WeeklyReviewReport> {
  const [tasks, projects, inbox, proposals] = await Promise.all([
    rowsOf(index, compileReviewTasksQuery()),
    rowsOf(index, compileReviewProjectsQuery()),
    listInbox({ index }),
    listProposals({ fs, markdown }),
  ]);
  const toFile = inbox.items.length;
  const toAnswer = proposals.open.length;
  const at = { today: clock.today(), now: clock.now() };
  return {
    ...weeklyReview({
      tasks: tasks.rows.map(reviewTask),
      projects: projects.rows.map(reviewProject),
      at,
    }),
    today: at.today,
    inbox: {
      count: inboxWaiting({ toFile, toAnswer }) ?? 0,
      toFile,
      toAnswer,
      more: inbox.truncated,
    },
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
