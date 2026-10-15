import type { VaultPath } from '@atlas/domain';
import type { InboxListing } from '@atlas/application';

/**
 * Where a read of the Inbox stands among the page's own writes (#217): the
 * moment it began, on the page's one clock of reads and writes, and the
 * index's key when it did.
 */
export interface ReadMoment {
  readonly at: number;
  readonly indexKey: string;
}

/**
 * A row taken off the page the moment it was clarified, before the index has
 * caught up with the write. Null `settled` while it is still being written;
 * once written, the moment it was, so a read begun since — against an index
 * that has moved on — is what says whether it is still waiting.
 */
export interface LeavingRow {
  readonly path: VaultPath;
  readonly settled: ReadMoment | null;
}

/** Whether a read of the index already answers for a row's write, so the row is the index's to show again. */
function answeredBy(row: LeavingRow, read: ReadMoment): boolean {
  return row.settled !== null && read.at > row.settled.at && read.indexKey !== row.settled.indexKey;
}

/**
 * The listing as the page shows it: without the rows that have left it and
 * the index has not yet caught up with, and counting them out of the total.
 */
export function withoutLeaving(
  listing: InboxListing,
  leaving: readonly LeavingRow[],
  read: ReadMoment,
): InboxListing {
  const gone = new Set(
    leaving.filter((row) => !answeredBy(row, read)).map((row) => row.path as string),
  );
  if (gone.size === 0) return listing;
  const items = listing.items.filter((item) => !gone.has(item.path));
  return { ...listing, items, total: listing.total - (listing.items.length - items.length) };
}
