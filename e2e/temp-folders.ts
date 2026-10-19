import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The folders this worker's helpers made in the temp folder, removed after each
 * test by the `test` in fixtures.ts (issue #397: a night of runs once left
 * 100,000 behind). A worker runs one test at a time, so they are that test's.
 */
const made = new Set<string>();

/** A fresh folder in the temp folder, removed once the current test has finished. */
export async function makeTempFolder(prefix: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  made.add(folder);
  return folder;
}

/** Removes every folder `makeTempFolder` made, and nothing else. */
export async function removeTempFolders(): Promise<void> {
  const folders = [...made];
  made.clear();
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
}
