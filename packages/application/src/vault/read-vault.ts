import {
  HIDDEN_DIRECTORY_NAMES,
  VAULT_WALK_DEPTH,
  isVisibleEntry,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import type { NoteContents, NoteListing, VaultFsPort } from './ports.ts';

/**
 * Children of one directory, with the entries the user should never see removed
 * here rather than in the UI, so every caller gets the same view of the vault.
 */
export async function listVaultDirectory({
  fs,
  path,
}: {
  fs: VaultFsPort;
  path: VaultPath;
}): Promise<readonly VaultEntry[]> {
  const entries = await fs.listDirectory(path);
  return entries.filter(isVisibleEntry);
}

/**
 * Every note in user space, with the file facts the index needs.
 *
 * The host returns what is on disk and this decides what counts, so link
 * resolution, autocomplete and the index all see the same vault (ADR-0014). The
 * host is handed the folders it may stop at purely so a vault containing
 * `node_modules` does not push tens of thousands of paths across IPC for this
 * line to discard; the judgement itself is `isVisibleEntry` and nowhere else.
 */
export async function listVaultNoteFiles({
  fs,
}: {
  fs: VaultFsPort;
}): Promise<readonly NoteListing[]> {
  const notes = await fs.listNotes({
    skipDirectories: HIDDEN_DIRECTORY_NAMES,
    maxDepth: VAULT_WALK_DEPTH,
  });
  return notes.filter((note) => isVisibleEntry({ kind: 'file', name: note.name, path: note.path }));
}

/** Every note in the vault, hidden ones removed, as paths for link resolution. */
export async function listVaultNotes({ fs }: { fs: VaultFsPort }): Promise<readonly VaultPath[]> {
  return (await listVaultNoteFiles({ fs })).map((note) => note.path);
}

export async function readVaultFile({
  fs,
  path,
}: {
  fs: VaultFsPort;
  path: VaultPath;
}): Promise<NoteContents> {
  return fs.readTextFile(path);
}
