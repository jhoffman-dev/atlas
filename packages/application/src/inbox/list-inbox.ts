import {
  compileInboxQuery,
  createVaultPath,
  inboxItem,
  INBOX_LIST_LIMIT,
  type InboxItem,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

/** The Inbox's notes, and whether there were more than it lists. */
export interface InboxListing {
  readonly items: readonly InboxItem[];
  readonly truncated: boolean;
}

/**
 * Every note waiting in the Inbox, newest first, read from the index — of any
 * type or none, at any depth: a captured task, an imported meeting, a note
 * dropped in by hand (P30-01).
 */
export async function listInbox({
  index,
  limit = INBOX_LIST_LIMIT,
}: {
  index: Pick<IndexPort, 'query'>;
  limit?: number;
}): Promise<InboxListing> {
  // One more than is shown, so a full page is told apart from a cut-off one.
  const { sql, parameters } = compileInboxQuery({ limit: limit + 1 });
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
    }),
  );
  return { items: items.slice(0, limit), truncated: result.truncated || items.length > limit };
}
