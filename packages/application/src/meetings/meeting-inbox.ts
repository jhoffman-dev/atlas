import {
  isMeetingInboxPath,
  isVisibleEntry,
  MEETING_INBOX,
  MEETINGS_HOME,
  VAULT_ROOT,
  VAULT_WALK_DEPTH,
  type VaultEntry,
  type VaultPath,
} from '@dfai/domain';
import type { VaultFsPort } from '../vault/ports.ts';

const MARKDOWN = /\.(md|markdown)$/i;

/**
 * Every note where meeting files land — the month folders under `Meetings`
 * and the older `Inbox/Meetings` (#214) — at any depth the vault is read to:
 * what the import looks over when it starts, whatever the change feed did or
 * did not report. Which of them are the import's is its own to judge, file
 * by file. A vault with neither folder has none.
 */
export async function meetingInboxNotes(fs: VaultFsPort): Promise<VaultPath[]> {
  const found = await Promise.all([MEETINGS_HOME, MEETING_INBOX].map((root) => notesIn(fs, root)));
  return found.flat();
}

/** The notes under the folder `root` names, found however the disk spells each name on the way. */
async function notesIn(fs: VaultFsPort, root: string): Promise<VaultPath[]> {
  let folder: VaultPath = VAULT_ROOT;
  for (const name of root.split('/')) {
    const found = (await fs.listDirectory(folder)).find(
      (entry) => entry.kind === 'directory' && entry.name.toLowerCase() === name.toLowerCase(),
    );
    if (found === undefined) return [];
    folder = found.path;
  }
  return notesUnder(fs, folder, root.split('/').length);
}

/** The notes under a folder, as the rest of DFAI sees them: hidden files and folders left out (ADR-0014). */
async function notesUnder(fs: VaultFsPort, folder: VaultPath, depth: number): Promise<VaultPath[]> {
  const entries: readonly VaultEntry[] = (await fs.listDirectory(folder)).filter(isVisibleEntry);
  const notes = entries
    .filter((entry) => entry.kind === 'file' && MARKDOWN.test(entry.name))
    .map((entry) => entry.path)
    .filter(isMeetingInboxPath);
  if (depth >= VAULT_WALK_DEPTH) return notes;
  const deeper = await Promise.all(
    entries
      .filter((entry) => entry.kind === 'directory')
      .map((entry) => notesUnder(fs, entry.path, depth + 1)),
  );
  return [...notes, ...deeper.flat()];
}
