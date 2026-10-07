import type { VaultPath } from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';

/**
 * The note's modification time as it stands now, or `null` when it cannot be
 * read — it has gone, or the vault has.
 *
 * For recording what the file looked like when work against it was kept, so a
 * later change can be told apart. A failure is an answer rather than an error:
 * a file that is not there has no time, and the work is kept either way.
 */
export async function noteModified({
  fs,
  path,
}: {
  fs: VaultFsPort;
  path: VaultPath;
}): Promise<number | null> {
  try {
    return (await fs.readTextFile(path)).modified;
  } catch {
    return null;
  }
}
