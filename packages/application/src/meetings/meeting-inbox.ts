import {
  isMeetingInboxPath,
  MEETING_INBOX,
  VAULT_ROOT,
  VAULT_WALK_DEPTH,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';

const MARKDOWN = /\.(md|markdown)$/i;

/**
 * Every note where meeting files land, at any depth the vault is read to:
 * what the import looks over when it starts, whatever the change feed did or
 * did not report. A vault with no such folder has none.
 */
export async function meetingInboxNotes(fs: VaultFsPort): Promise<VaultPath[]> {
  let folder: VaultPath = VAULT_ROOT;
  for (const name of MEETING_INBOX.split('/')) {
    const found = (await fs.listDirectory(folder)).find(
      (entry) => entry.kind === 'directory' && entry.name.toLowerCase() === name.toLowerCase(),
    );
    if (found === undefined) return [];
    folder = found.path;
  }
  return notesUnder(fs, folder, MEETING_INBOX.split('/').length);
}

async function notesUnder(fs: VaultFsPort, folder: VaultPath, depth: number): Promise<VaultPath[]> {
  const entries: readonly VaultEntry[] = await fs.listDirectory(folder);
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
