import { randomUUID } from 'node:crypto';
import { link, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * A file's whole content written beside where it goes, under a hidden name
 * (Atlas, and the import's own look over the vault, pass hidden files by),
 * and flushed to the disk. It is then linked to its names one at a time:
 * a name is taken only by the whole file, never by part of one.
 */
export interface StagedFile {
  /** Gives the file `path`, unless something already has that name: true when it took it. */
  readonly linkTo: (path: string) => Promise<boolean>;
  /** Takes the staged copy away; the names it was linked to keep the file. */
  readonly discard: () => Promise<void>;
}

/** Writes `content` into `folder` under a hidden name and flushes it; a write that fails leaves nothing behind. */
export async function stageFile(folder: string, content: string): Promise<StagedFile> {
  const staged = join(folder, `.atlas-import-${randomUUID()}.tmp`);
  const discard = () => rm(staged, { force: true });
  try {
    await writeFile(staged, content, { flag: 'wx' });
    const handle = await open(staged, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await discard();
    throw error;
  }
  return {
    // link() fails with EEXIST rather than replace a file that has the name: no other run's file is written over.
    linkTo: async (path) => {
      try {
        await link(staged, path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      }
    },
    discard,
  };
}
