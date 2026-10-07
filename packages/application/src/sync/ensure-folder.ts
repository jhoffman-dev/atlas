import {
  createVaultPath,
  joinVaultPath,
  parentVaultPath,
  VAULT_ROOT,
  vaultPathSegments,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';

type Fs = Pick<VaultFsPort, 'listDirectory' | 'createFolder'>;

/**
 * Makes the folder a path is to go in, and any above it that are missing:
 * `git mv` moves a file only into a folder that is there. A folder whose
 * name the vault's paths cannot spell (one with a backslash) is left to the
 * move, which then says it could not.
 */
export async function ensureFolderOf(fs: Fs, path: string): Promise<void> {
  let folder: VaultPath;
  try {
    folder = parentVaultPath(createVaultPath(path));
  } catch {
    // Not a vault path: see above.
    return;
  }
  let at: VaultPath = VAULT_ROOT;
  for (const segment of vaultPathSegments(folder)) {
    const parent = at;
    at = joinVaultPath(parent, segment);
    const entries = await fs.listDirectory(parent).catch(() => []);
    if (entries.some((entry) => entry.path === at && entry.kind === 'directory')) continue;
    // Made meanwhile, it is refused as taken, and is there; one that is truly
    // missing fails the move that follows, which says so.
    await fs.createFolder({ path: at }).catch(() => undefined);
  }
}
