import {
  compileReviewProjectsQuery,
  compileReviewTasksQuery,
  inboxWaiting,
  reviewProject,
  reviewTask,
  type CompiledQuery,
  type ReviewProject,
  type ReviewTask,
} from '@atlas/domain';
import { listInbox } from '../inbox/list-inbox.ts';
import type { IndexPort, QueryResult } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { listProposals } from '../proposals/list-proposals.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** What the weekly review and the Today page read with: the index, and the vault for proposals. */
export interface ReviewReadPorts {
  index: Pick<IndexPort, 'query'>;
  /** Where the proposals waiting in the Inbox are read from. */
  fs: VaultFsPort;
  markdown: MarkdownPort;
}

/**
 * What waits in the one Inbox, counted as the sidebar counts it: `count` is
 * the notes to file (`toFile`) and the proposals to answer (`toAnswer`);
 * `more` when there are more notes than it counts.
 */
export interface InboxCount {
  readonly count: number;
  readonly toFile: number;
  readonly toAnswer: number;
  readonly more: boolean;
}

/**
 * Everything the weekly review and the Today page are worked out from, read
 * together: every open task (one statement, whatever the sections), every
 * project, and the Inbox's count.
 */
export async function readReviewSources({ index, fs, markdown }: ReviewReadPorts): Promise<{
  tasks: ReviewTask[];
  projects: ReviewProject[];
  inbox: InboxCount;
  /** The index held tasks or projects back, so a section may be missing items. */
  truncated: boolean;
}> {
  const [tasks, projects, inbox, proposals] = await Promise.all([
    rowsOf(index, compileReviewTasksQuery()),
    rowsOf(index, compileReviewProjectsQuery()),
    listInbox({ index }),
    listProposals({ fs, markdown }),
  ]);
  const toFile = inbox.items.length;
  const toAnswer = proposals.open.length;
  return {
    tasks: tasks.rows.map(reviewTask),
    projects: projects.rows.map(reviewProject),
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
