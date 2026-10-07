import { joinVaultPath, VAULT_ROOT, vaultSpellingOf, type VaultPath } from '@atlas/domain';
import { VaultAccessError, type VaultFsPort } from '../vault/ports.ts';

/**
 * A path from a request, spelled as the vault spells it (R15-01).
 *
 * APFS finds `tasks/call sam.md` at `Tasks/Call Sam.md`, but the panes, the
 * index and every answer know an entry by one spelling. This finds it a folder
 * at a time — one directory listing per segment, rather than a walk of the
 * whole vault on every request — matching each segment as `vaultSpellingOf`
 * matches a note. A path that nothing matches, that matches ambiguously, or
 * whose spelling the caller could not have named (`accepts` says no) is
 * answered as asked, to be refused or found as the disk finds it.
 */
export async function spelledAsVault({
  fs,
  asked,
  accepts,
}: {
  fs: VaultFsPort;
  asked: VaultPath;
  accepts: (path: VaultPath) => boolean;
}): Promise<VaultPath> {
  let resolved: VaultPath = VAULT_ROOT;
  for (const segment of asked.split('/')) {
    const found = vaultSpellingOf(joinVaultPath(resolved, segment), await childrenOf(fs, resolved));
    if (found === null) return asked;
    resolved = found;
  }
  return accepts(resolved) ? resolved : asked;
}

async function childrenOf(fs: VaultFsPort, folder: VaultPath): Promise<VaultPath[]> {
  try {
    return (await fs.listDirectory(folder)).map((entry) => entry.path);
  } catch (error) {
    // No such folder: nothing in it can match, and the path is left as asked.
    if (error instanceof VaultAccessError) return [];
    throw error;
  }
}
