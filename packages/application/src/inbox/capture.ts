import { createVaultPath, INBOX_DIRECTORY, type VaultPath } from '@atlas/domain';
import { createNote } from '../notes/create-note.ts';
import { ensureFolder } from '../vault/create-folder.ts';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * Makes a captured note in the Inbox — made first if the vault has none — and
 * says where it landed. Whatever is open, capture lands there: it is the one
 * place everything waits to be processed (P30-01). A name in use is numbered,
 * as a new note's is.
 */
export async function captureToInbox({
  fs,
  name,
  notePaths,
  contents,
}: {
  fs: VaultFsPort;
  name: string;
  notePaths: readonly VaultPath[];
  /** Starting text, when capture makes its note from the task template. */
  contents?: string;
}): Promise<VaultPath> {
  const folder = await ensureFolder({ fs, folder: createVaultPath(INBOX_DIRECTORY) });
  return createNote({
    fs,
    name,
    beside: null,
    folder,
    notePaths,
    ...(contents === undefined ? {} : { contents }),
  });
}
