import {
  foldedVaultPath,
  joinVaultPath,
  VAULT_ROOT,
  vaultPathSegments,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from './ports.ts';

/**
 * The entry at `path`, found by listing each folder on the way down from the
 * vault's root as the disk spells it — or null when one of them is not there.
 *
 * Only a folder already seen in its parent is listed, so a listing that fails
 * is a failure, passed on: a host that times out is never taken to mean that
 * nothing is there.
 */
export async function findVaultEntry(fs: VaultFsPort, path: VaultPath): Promise<VaultEntry | null> {
  let folder: VaultPath = VAULT_ROOT;
  let found: VaultEntry | null = null;
  for (const name of vaultPathSegments(path)) {
    if (found !== null && found.kind !== 'directory') return null;
    const wanted = foldedVaultPath(joinVaultPath(folder, name));
    const entries = await fs.listDirectory(folder);
    found = entries.find((entry) => foldedVaultPath(entry.path) === wanted) ?? null;
    if (found === null) return null;
    folder = found.path;
  }
  return found;
}
