import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** The run cannot start: the vault or the folder is not one to write into. */
export class ImportSetupError extends Error {
  override readonly name = 'ImportSetupError';
}

/** Where the import writes: the vault, as the disk names it, and the folder in it. */
export interface ImportTarget {
  readonly vault: string;
  readonly folder: string;
}

const isInside = (parent: string, path: string) => {
  const inside = relative(parent, path);
  return (
    inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))
  );
};

/** The vault as the disk names it: it must already be a folder. */
async function vaultFolder(vault: string): Promise<string> {
  const found = await stat(vault).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (found === null || !found.isDirectory()) {
    throw new ImportSetupError(`vault: there is no folder at ${resolve(vault)}`);
  }
  return realpath(vault);
}

/** The deepest part of `path` that exists, as the disk names it, links followed. */
async function existingPart(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    // Not there yet: what is there is the folder it will be made in.
    const parent = dirname(path);
    return parent === path ? path : join(await existingPart(parent), relative(parent, path));
  }
}

/**
 * A folder of Atlas's own in the vault (`.atlas/imports`), as the disk names
 * it: hidden, as Atlas's files are, but like any folder the import writes
 * into, never one whose existing part is linked out of the vault.
 */
export async function ownFolder(vault: string, folder: string): Promise<string> {
  const path = resolve(vault, folder);
  if (!isInside(vault, path) || !isInside(vault, await existingPart(path))) {
    throw new ImportSetupError(`${folder} is not a folder inside the vault`);
  }
  return path;
}

/**
 * The vault and the folder the files go in. The vault must exist; the folder
 * is named relative to it, is not hidden (Atlas would never see a file there,
 * and the next run would not either), and stays inside the vault however its
 * existing part is linked.
 */
export async function importTarget(options: {
  readonly vault: string;
  readonly folder: string;
}): Promise<ImportTarget> {
  const vault = await vaultFolder(options.vault);
  const named = options.folder.trim();
  const refuse = (why: string) =>
    new ImportSetupError(`folder: ${options.folder || '(empty)'} ${why}`);
  if (named === '') throw refuse('is not a folder');
  if (isAbsolute(named)) throw refuse('is not a folder inside the vault');
  const parts = named.split(/[\\/]/);
  if (parts.includes('..')) throw refuse('is not a folder inside the vault');
  if (parts.some((part) => part.startsWith('.'))) {
    throw refuse('is hidden: Atlas, and the next run, would not see the meetings in it');
  }
  const folder = resolve(vault, named);
  if (!isInside(vault, folder) || !isInside(vault, await existingPart(folder))) {
    throw refuse('is not a folder inside the vault');
  }
  return { vault, folder };
}
