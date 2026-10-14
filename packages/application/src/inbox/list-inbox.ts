import {
  compileInboxCountQuery,
  compileInboxQuery,
  createVaultPath,
  inboxItem,
  INBOX_LIST_LIMIT,
  tasksStartInInbox,
  type InboxItem,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { loadObjectTypes } from '../types/load-types.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/** The Inbox's notes, and whether there were more than it lists. */
export interface InboxListing {
  readonly items: readonly InboxItem[];
  /** More wait after these. */
  readonly truncated: boolean;
  /** How many wait in all, listed or not (#167). */
  readonly total: number;
}

/**
 * Everything waiting in the one Inbox, newest first, read from the index: every
 * note in the `Inbox` folder — of any type or none, at any depth: a captured
 * task, an imported meeting, a note dropped in by hand (P30-01) — and every
 * task whose status is Inbox wherever it lives (#112). A page at a time, from
 * `offset`, saying how many wait in all, so a limit never hides work (#167).
 */
export async function listInbox({
  index,
  limit = INBOX_LIST_LIMIT,
  offset = 0,
  tasksStartInInbox = false,
}: {
  index: Pick<IndexPort, 'query'>;
  limit?: number;
  /** How many of the newest to pass over: where the page starts. */
  offset?: number;
  /**
   * Whether the vault's tasks start in the Inbox (`tasksStartInInbox` of its
   * types): then a task given another status has left the list (#112).
   */
  tasksStartInInbox?: boolean;
}): Promise<InboxListing> {
  // One more than is shown, so a full page is told apart from a cut-off one.
  const { sql, parameters } = compileInboxQuery({ limit: limit + 1, offset, tasksStartInInbox });
  const result = await index.query(sql, parameters);
  const cell = (row: readonly unknown[], name: string) => row[result.columns.indexOf(name)];
  const items = result.rows.map((row) =>
    inboxItem({
      path: createVaultPath(String(cell(row, 'path'))),
      title: String(cell(row, 'title') ?? ''),
      type: cell(row, 'type'),
      importStamped: Boolean(cell(row, 'importStamped')),
      importOutcome: cell(row, 'importOutcome'),
      importError: cell(row, 'importError'),
      status: cell(row, 'status'),
      project: cell(row, 'project'),
      waitingOn: cell(row, 'waitingOn'),
      waitingOnNames: cell(row, 'waitingOnNames'),
      defer: cell(row, 'defer'),
      due: cell(row, 'due'),
    }),
  );
  const truncated = result.truncated || items.length > limit;
  const listed = items.slice(0, limit);
  // A first page that holds them all has counted them; any other page asks.
  const total =
    truncated || offset > 0 ? await countInbox(index, tasksStartInInbox) : listed.length;
  return { items: listed, truncated, total };
}

async function countInbox(
  index: Pick<IndexPort, 'query'>,
  tasksStartInInbox: boolean,
): Promise<number> {
  const { sql, parameters } = compileInboxCountQuery({ tasksStartInInbox });
  const result = await index.query(sql, parameters);
  return Number(result.rows[0]?.[result.columns.indexOf('total')] ?? 0);
}

/**
 * {@link listInbox} for a caller that does not hold the vault's types — the
 * weekly review, the API: they are read first, so it lists, and counts, what
 * the Inbox page does.
 */
export async function listVaultInbox({
  index,
  fs,
  markdown,
  page = {},
}: {
  index: Pick<IndexPort, 'query'>;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  /** Which page: how many, from where. The first {@link INBOX_LIST_LIMIT} unless said. */
  page?: { readonly limit?: number; readonly offset?: number };
}): Promise<InboxListing> {
  const types = await loadObjectTypes({ fs, markdown });
  return listInbox({ index, ...page, tasksStartInInbox: tasksStartInInbox(types) });
}
