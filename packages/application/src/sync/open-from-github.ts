import {
  cloneFolderRefusal,
  emptyRepositoryRefusal,
  hasBranches,
  remoteUrlProblem,
  repositoryNameOf,
} from '@atlas/domain';
import type { VaultLocation, VaultLocationStore } from '../vault/ports.ts';
import { expectOk, SyncError, withPrograms } from './git-steps.ts';
import type { GitFoldersPort } from './ports.ts';

/**
 * Opens a vault kept on GitHub on this Mac (U-29): asks which folder to put
 * it in (in the host's own dialog, which is what lets the host clone there), clones it there into a folder of the repository's name, and opens
 * that. Refused inside another repository's work tree, as setting up sync
 * is; inside the open vault, compared where both are on disk so a link or
 * `/var` cannot hide it; and for an empty repository, which holds no vault
 * to open (issue #8) — each before anything is cloned, so nothing is left
 * to clean up. Resolves to null when the folder picker is dismissed.
 */
export async function openVaultFromGitHub({
  folders,
  store,
  url,
  openVault,
  beforeSwitch,
}: {
  folders: GitFoldersPort;
  store: VaultLocationStore;
  url: string;
  /** The open vault's root; null with none open. */
  openVault: string | null;
  beforeSwitch?: () => Promise<void>;
}): Promise<VaultLocation | null> {
  const problem = remoteUrlProblem(url);
  if (problem !== null) throw new SyncError(problem);
  const parent = await folders.pickCloneFolder();
  if (parent === null) return null;
  const refusal = cloneFolderRefusal({
    picked: await folders.onDisk(parent.absolutePath),
    openVault: openVault === null ? null : await folders.onDisk(openVault),
  });
  if (refusal !== null) throw new SyncError(refusal);
  const name = repositoryNameOf(url);
  await withPrograms(async () => {
    const around = await folders.topLevelOf(parent.absolutePath);
    if (around.code === 0 && around.stdout.trim() !== '') {
      throw new SyncError(
        `${parent.name} is inside another git repository, so Atlas won’t put a vault there. Choose a folder outside it.`,
      );
    }
    const branches = await folders.branchesAt({ url: url.trim(), folder: parent.absolutePath });
    if (!hasBranches(expectOk('ask GitHub what the repository holds', branches))) {
      throw new SyncError(emptyRepositoryRefusal());
    }
    const cloned = await folders.clone({ url: url.trim(), folder: parent.absolutePath, name });
    expectOk('copy the vault from GitHub', cloned);
  });
  const location = { absolutePath: `${parent.absolutePath.replace(/\/+$/, '')}/${name}`, name };
  await beforeSwitch?.();
  await store.write(location);
  return location;
}
