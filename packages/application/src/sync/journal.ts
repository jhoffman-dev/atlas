import {
  EMPTY_JOURNAL,
  journalText,
  parseJournal,
  withUnreported,
  type ConflictCopy,
  type SettleJournal,
} from '@atlas/domain';
import type { SyncFilesPort } from './ports.ts';

const JOURNAL = 'journal.json';

/** The sync's journal as it stands; an empty one when there is none, or none to trust. */
export async function readJournal(files: SyncFilesPort): Promise<SettleJournal> {
  return parseJournal(await files.read(JOURNAL)) ?? EMPTY_JOURNAL;
}

export async function writeJournal(files: SyncFilesPort, journal: SettleJournal): Promise<void> {
  await files.write(JOURNAL, journalText(journal));
}

/** Notes copies about to be made, before they are, so a sync after a quit still reports them. */
export async function noteCopies(
  files: SyncFilesPort,
  copies: readonly ConflictCopy[],
): Promise<void> {
  if (copies.length === 0) return;
  await writeJournal(files, withUnreported(await readJournal(files), copies));
}

/** Done with: every copy it held has been reported by a sync that finished. */
export async function clearJournal(files: SyncFilesPort): Promise<void> {
  await files.write(JOURNAL, null);
}
