import { inboxWaiting } from '@dfai/domain';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { listProposals } from '../proposals/list-proposals.ts';
import { countInbox } from './list-inbox.ts';

/**
 * How many things the Inbox's sidebar row counts: the notes waiting to be
 * filed, as the Inbox page lists them, and the proposals still open, which
 * the page answers (#293). One read, kept by the window until the index has
 * news or the proposals folder changes, so the count is right whatever page
 * is open without the page's own reading.
 */
export async function countInboxWaiting({
  index,
  fs,
  markdown,
  tasksStartInInbox,
}: {
  index: Pick<IndexPort, 'query'>;
  fs: VaultFsPort;
  markdown: MarkdownPort;
  /** Whether a task with no status is the Inbox's, as the vault's Task type says. */
  tasksStartInInbox: boolean;
}): Promise<number> {
  const [toFile, proposals] = await Promise.all([
    countInbox(index, tasksStartInInbox),
    listProposals({ fs, markdown }),
  ]);
  return inboxWaiting({ toFile, toAnswer: proposals.open.length }) ?? 0;
}
