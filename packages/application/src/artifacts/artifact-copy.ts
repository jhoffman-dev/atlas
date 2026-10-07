import {
  artifactCopyPlan,
  copyFolderFor,
  joinVaultPath,
  parentVaultPath,
  vaultPathName,
  type ArtifactFileInput,
  type SavedCopyProperties,
  type VaultPath,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';

/** A file that was picked but cannot be in a copy, and why. */
export interface SkippedFile {
  readonly name: string;
  readonly reason: string;
}

/** Saving was refused for a reason the person can act on; the message says what. */
export class ArtifactRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactRefusedError';
  }
}

/**
 * Writes a copy's files into `folder`, which must not exist yet, and reports
 * what the note should record about it.
 *
 * Folders inside the copy are made as its files need them. Every file is
 * created, never overwritten. The cover is left to the thumbnail, made
 * once the copy is on disk (`generateArtifactThumbnail`).
 */
export async function writeArtifactCopy({
  fs,
  folder,
  files,
  today,
}: {
  fs: VaultFsPort;
  folder: VaultPath;
  files: readonly ArtifactFileInput[];
  today: string;
}): Promise<SavedCopyProperties> {
  await fs.createFolder({ path: folder });
  const made = new Set<string>([folder]);
  for (const file of files) {
    const path = joinVaultPath(folder, file.name);
    await makeFolders({ fs, folder: parentVaultPath(path), made });
    await fs.writeBinaryFile({ path, bytes: file.bytes, offset: 0 });
  }
  return { saved: folder, savedAt: today };
}

/** Makes `folder` and whatever above it has not been made yet, stopping at one already made. */
async function makeFolders({
  fs,
  folder,
  made,
}: {
  fs: VaultFsPort;
  folder: VaultPath;
  made: Set<string>;
}): Promise<void> {
  if (made.has(folder)) return;
  await makeFolders({ fs, folder: parentVaultPath(folder), made });
  await fs.createFolder({ path: folder });
  made.add(folder);
}

/**
 * Adds a copy to an artifact that has only its link, from files dropped on it.
 *
 * The copy goes in the folder named for the note, beside it — the one saving
 * would have chosen. When something already has that name the person is told,
 * rather than the copy going somewhere the note's name does not lead to.
 * Resolves to what the note should record; setting it is the caller's, since
 * the note is open in a pane that owns its writes.
 */
export async function addArtifactCopy({
  fs,
  notePath,
  files,
  today,
}: {
  fs: VaultFsPort;
  notePath: VaultPath;
  files: readonly ArtifactFileInput[];
  today: string;
}): Promise<{ copy: SavedCopyProperties; skipped: readonly SkippedFile[] }> {
  const plan = artifactCopyPlan(files);
  if (plan === null) {
    throw new ArtifactRefusedError(
      'There is no page to open: drop one .html file, or name the page index.html',
    );
  }
  const folder = copyFolderFor(notePath);
  const siblings = await fs.listDirectory(parentVaultPath(notePath));
  if (siblings.some((entry) => entry.path.toLowerCase() === folder.toLowerCase())) {
    throw new ArtifactRefusedError(
      `Something called ${vaultPathName(folder)} is already beside this note; move it, then try again`,
    );
  }
  const copy = await writeArtifactCopy({ fs, folder, files: plan.files, today });
  return { copy, skipped: plan.skipped };
}
