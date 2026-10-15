// `pnpm perf:vault <folder>` — writes the 2,000-note fixture vault (#217) into
// a new or empty folder, to open in `pnpm tauri:dev` and feel the app at size.
//
// It refuses a folder that already holds anything, so it can never write into
// a real vault.
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fixtureVault, noteCount, FIXTURE_SHAPE } from './fixture-vault.ts';

async function isEmptyOrMissing(folder: string): Promise<boolean> {
  try {
    return (await readdir(folder)).length === 0;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw cause;
  }
}

async function main(): Promise<void> {
  const target = process.argv[2];
  if (target === undefined) {
    console.error('Usage: pnpm perf:vault <new-or-empty-folder>');
    process.exit(2);
  }
  const root = resolve(target);
  if (!(await isEmptyOrMissing(root))) {
    console.error(`${root} is not empty; the fixture is only ever written into an empty folder.`);
    process.exit(1);
  }
  for (const file of fixtureVault()) {
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.contents, 'utf8');
  }
  process.stdout.write(`Wrote ${noteCount(FIXTURE_SHAPE)} notes to ${root}\n`);
}

await main();
