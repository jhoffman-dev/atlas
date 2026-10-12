import { stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** `Tasks a1000000…` as Notion names a database's files: its name and its id. */
const NAMED_WITH_ID = /^(.*?)\s+[0-9a-f]{32}$/i;

/** A database CSV's name without `.csv`, or the `_all` of the one with every column: `Tasks a1000000…`. */
export const csvBase = (csvPath: string) => basename(csvPath, '.csv').replace(/_all$/, '');

/** The database's name, without the id Notion adds to its files. */
export function databaseName(csvPath: string): string {
  const base = csvBase(csvPath);
  return NAMED_WITH_ID.exec(base)?.[1] ?? base;
}

async function isFolder(path: string): Promise<boolean> {
  const found = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  return found !== null && found.isDirectory();
}

/**
 * The folder Notion put a database's pages in, beside its CSV: named as the
 * CSV is, id and all (`Tasks a1000000…/`, as older exports name it), or by
 * the database's name alone (`Tasks/`, as current ones do). The one with the
 * id is the database's for certain, so it wins when both are there; null
 * when neither is. Only the CSV's own folder is looked in: a database of the
 * same name elsewhere in the export has its pages beside its own CSV.
 */
export async function pagesFolder(csvPath: string): Promise<string | null> {
  for (const name of [csvBase(csvPath), databaseName(csvPath)]) {
    const folder = join(dirname(csvPath), name);
    if (await isFolder(folder)) return folder;
  }
  return null;
}
