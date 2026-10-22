import {
  joinVaultPath,
  numberedFileName,
  parentVaultPath,
  vaultPathName,
  type VaultPath,
} from '@dfai/domain';
import type { VaultFsPort } from './ports.ts';

/** What placing a file reads of the vault: its folders' names, and making one. */
type FolderListing = Pick<VaultFsPort, 'listDirectory' | 'createFolder'>;

/** How many names are tried when each one is taken between listing and writing. */
const WRITE_ATTEMPTS = 3;

/** A file could not be put in its folder: the folder could not be made, or the write was refused. */
export class FileNotPlacedError extends Error {
  /** Why, in the host's words. */
  readonly reason: string;
  /** False when it was the folder that could not be made. */
  readonly folderMade: boolean;
  constructor({ reason, folderMade }: { reason: string; folderMade: boolean }) {
    super(
      folderMade
        ? `The file could not be saved: ${reason}`
        : `The folder could not be made: ${reason}`,
    );
    this.name = 'FileNotPlacedError';
    this.reason = reason;
    this.folderMade = folderMade;
  }
}

/**
 * Puts a file into `folder` — made if it is not there — under `name`,
 * numbered clear of every file already in it, by `place`, which must refuse
 * rather than overwrite: writing the bytes, or moving a finished upload in
 * from where it was staged. A name taken in between is numbered past and
 * tried again. Throws `FileNotPlacedError` when it cannot be placed.
 */
export async function placeUnderFreeName({
  fs,
  folder,
  name,
  place,
}: {
  fs: FolderListing;
  folder: VaultPath;
  name: string;
  place: (path: VaultPath) => Promise<unknown>;
}): Promise<VaultPath> {
  let taken = await namesIn({ fs, folder });
  for (let attempt = 1; ; attempt += 1) {
    // Picked and reserved in one synchronous step, so another embed awaiting
    // its own listing cannot pick the same name.
    const path = joinVaultPath(
      folder,
      numberedFileName({ name, taken: [...taken, ...namesBeingWritten(folder)] }),
    );
    beingWritten.add(path);
    try {
      await place(path);
      return path;
    } catch (error) {
      const listedAgain = await namesIn({ fs, folder });
      const nameWasTaken =
        joinVaultPath(folder, numberedFileName({ name, taken: listedAgain })) !== path;
      // Refused for some reason other than the name: trying again is pointless.
      if (attempt === WRITE_ATTEMPTS || !nameWasTaken) {
        throw new FileNotPlacedError({ reason: messageOf(error), folderMade: true });
      }
      taken = listedAgain;
    } finally {
      beingWritten.delete(path);
    }
  }
}

/**
 * The paths files being placed in this window are writing right now. Several images
 * dropped or pasted at once (or PDFs added) all list the folder before any is written, so
 * without this each picks the same free name and all but one are refused.
 */
const beingWritten = new Set<VaultPath>();

function namesBeingWritten(folder: VaultPath): string[] {
  return [...beingWritten]
    .filter((path) => parentVaultPath(path) === folder)
    .map((path) => vaultPathName(path));
}

/**
 * The names already in `folder`, making the folder when it is not there.
 *
 * Several images dropped at once each find the folder missing and each try
 * to make it; the ones that lose that race find it made and list it instead.
 * Only a folder that still cannot be listed once making it has failed — a
 * file of that name in the way — is a failure.
 */
async function namesIn({
  fs,
  folder,
}: {
  fs: FolderListing;
  folder: VaultPath;
}): Promise<string[]> {
  const listed = await listNames({ fs, folder });
  if (listed !== null) return listed;
  try {
    await fs.createFolder({ path: folder });
    return [];
  } catch (error) {
    const madeMeanwhile = await listNames({ fs, folder });
    if (madeMeanwhile !== null) return madeMeanwhile;
    throw new FileNotPlacedError({ reason: messageOf(error), folderMade: false });
  }
}

/** The names in `folder`, or null when it cannot be listed — most often, because it is not there. */
async function listNames({
  fs,
  folder,
}: {
  fs: FolderListing;
  folder: VaultPath;
}): Promise<string[] | null> {
  try {
    return (await fs.listDirectory(folder)).map((entry) => entry.name);
  } catch {
    // Not there (yet): the caller makes it, and a real problem surfaces there.
    return null;
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
