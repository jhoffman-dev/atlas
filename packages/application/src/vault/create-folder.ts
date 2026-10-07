import {
  foldedVaultPath,
  compareNames,
  DEFAULT_FOLDER_NAME,
  isVisibleEntry,
  newFolderRefusal,
  nextAvailableFolderPath,
  joinVaultPath,
  vaultPathSegments,
  VAULT_ROOT,
  type VaultPath,
} from '@atlas/domain';
import { MoveRefusedError } from './relocate-entry.ts';
import type { VaultFsPort } from './ports.ts';

/**
 * Makes a folder in `parent` and reports where it landed.
 *
 * Called `New folder` until it is named, and numbered past whatever is already
 * there — a note of the same name included, since the disk refuses both. Only
 * Atlas keeps folders in `.atlas`.
 */
export async function createFolder({
  fs,
  parent,
  name = DEFAULT_FOLDER_NAME,
}: {
  fs: VaultFsPort;
  parent: VaultPath;
  name?: string;
}): Promise<VaultPath> {
  const refusal = newFolderRefusal(parent);
  if (refusal !== null) throw new MoveRefusedError(refusal);
  const siblings = await fs.listDirectory(parent);
  const path = nextAvailableFolderPath({
    parent,
    name,
    taken: new Set<string>(siblings.map((sibling) => sibling.path)),
  });
  await fs.createFolder({ path });
  return path;
}

/**
 * Makes sure `folder` exists, making each missing folder on the way down to
 * it, and answers it as the disk spells it: a folder already there in another
 * case or composition is the one used, as the disk would, and is named as it
 * is. A note in the way is the disk's refusal, passed on.
 */
export async function ensureFolder({
  fs,
  folder,
}: {
  fs: VaultFsPort;
  folder: VaultPath;
}): Promise<VaultPath> {
  let spelled = VAULT_ROOT;
  for (const name of vaultPathSegments(folder)) {
    const path = joinVaultPath(spelled, name);
    const siblings = await fs.listDirectory(spelled);
    const there = siblings.find((entry) => foldedVaultPath(entry.path) === foldedVaultPath(path));
    if (there?.kind === 'directory') {
      spelled = there.path;
      continue;
    }
    await fs.createFolder({ path });
    spelled = path;
  }
  return spelled;
}

/** How deep the folder walk goes; a symlink loop is otherwise endless. */
const MAX_DEPTH = 32;

/**
 * Every folder in user space, top level first then each folder's own, for
 * choosing where to move something. Hidden folders are left out by the same
 * rule the tree uses, so the picker offers exactly what the sidebar shows.
 */
export async function listVaultFolders({ fs }: { fs: VaultFsPort }): Promise<VaultPath[]> {
  const found: VaultPath[] = [];
  let level: VaultPath[] = [VAULT_ROOT];

  for (let depth = 0; depth < MAX_DEPTH && level.length > 0; depth += 1) {
    const listings = await Promise.all(level.map((folder) => fs.listDirectory(folder)));
    level = listings
      .flat()
      .filter((entry) => entry.kind === 'directory' && isVisibleEntry(entry))
      .map((entry) => entry.path);
    found.push(...level);
  }
  return found.sort((left, right) => compareNames(left, right));
}
