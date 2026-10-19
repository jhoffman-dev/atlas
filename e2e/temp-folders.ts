import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The folders this worker's helpers made in the temp folder, removed by the
 * `test` in fixtures.ts (issue #397: a night of runs once left 100,000 behind).
 * A worker runs one test at a time, so what a test adds is that test's; what a
 * `beforeAll` adds is shared by the tests after it and lasts until the worker ends.
 */
const made = new Set<string>();

/** A fresh folder in the temp folder, removed by the `test` in fixtures.ts. */
export async function makeTempFolder(prefix: string): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  made.add(folder);
  return folder;
}

/** The folders made so far, to tell a test's own from those made before it. */
export function tempFoldersMade(): ReadonlySet<string> {
  return new Set(made);
}

/** Removes the folders `makeTempFolder` made, except those in `kept`, and nothing else. */
export async function removeTempFolders(kept: ReadonlySet<string> = new Set()): Promise<void> {
  const folders = [...made].filter((folder) => !kept.has(folder));
  for (const folder of folders) made.delete(folder);
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
}
