import {
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
  readonly truncated: boolean;
}

/**
 * Everything waiting in the one Inbox, newest first, read from the index: every
 * note in the `Inbox` folder — of any type or none, at any depth: a captured
 * task, an imported meeting, a note dropped in by hand (P30-01) — and every
 * task whose status is Inbox wherever it lives (#112).
 */
export async function listInbox({
  index,
  limit = INBOX_LIST_LIMIT,
  tasksStartInInbox = false,
}: {
  index: Pick<IndexPort, 'query'>;
  limit?: number;
  /**
   * Whether the vault's tasks start in the Inbox (`tasksStartInInbox` of its
   * types): then a task given another status has left the list (#112).
   */
  tasksStartInInbox?: boolean;
}): Promise<InboxListing> {
  // One more than is shown, so a full page is told apart from a cut-off one.
  const { sql, parameters } = compileInboxQuery({ limit: limit + 1, tasksStartInInbox });
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
  return { items: items.slice(0, limit), truncated: result.truncated || items.length > limit };
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
}: {
  index: Pick<IndexPort, 'query'>;
  fs: VaultFsPort;
  markdown: MarkdownPort;
}): Promise<InboxListing> {
  const types = await loadObjectTypes({ fs, markdown });
  return listInbox({ index, tasksStartInInbox: tasksStartInInbox(types) });
}
