import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A temp folder of the run's own for the Vitest and Playwright runs, removed
 * when the run ends.
 *
 * Issue #397: helpers that forgot to clean up left 80 GB in the temp folder over
 * a night of agent runs. Each helper now removes what it makes; this is the net
 * under them, for whatever one still leaves or a worker killed mid-test.
 *
 * Issue #486: 45 GB more in a day. Vitest makes a folder of its own in the temp
 * folder (named by a random id, about 15 MB a run) as it starts, before any
 * global set-up runs, and never removes it; and a run that is killed (an agent's
 * timeout) never reaches its teardown. So vitest.config.ts starts the run's
 * folder as the config loads, and each run removes the folders of runs whose
 * process has ended.
 *
 * `TMPDIR` is set before the workers start, so they inherit it and every
 * `os.tmpdir()` in a test lands inside the run's folder. A run removes only its
 * own folder and those of ended runs, never a live run's, even in parallel.
 */

const RUN_PREFIX = 'atlas-test-run-';
/** A run's folder, named by the process that made it: `atlas-test-run-<pid>-<random>`. */
const RUN_FOLDER = /^atlas-test-run-(\d+)-/;
/** What a test helper makes, under the app's name now and the one it is changing to (#482). */
const TEST_FOLDER = /^(atlas|dfai)-/;

type Run = {
  folder: string;
  /** The user's temp folder the run's is made in, and what it held as the run started. */
  base: string;
  before: ReadonlySet<string>;
  previous: string | undefined;
};

// On globalThis, not in this module: Vitest loads the config and the global
// set-up as separate copies of this module, in the same process.
const RUN = Symbol.for('atlas.temp-folder-per-run');
const shared = globalThis as { [RUN]?: Run };

/**
 * Points `TMPDIR` at a fresh folder for this run, once per process, and returns
 * it. Removes the folders of earlier runs whose process has ended first.
 */
export function startTemporaryFolderPerRun(): string {
  const started = shared[RUN];
  if (started) return started.folder;
  const base = tmpdir();
  removeFoldersOfEndedRuns(base);
  const folder = realpathSync(mkdtempSync(join(base, `${RUN_PREFIX}${process.pid}-`)));
  shared[RUN] = { folder, base, before: testFoldersIn(base), previous: process.env['TMPDIR'] };
  process.env['TMPDIR'] = folder;
  // A process that exits without its teardown (a command that loads the config
  // but runs no tests, or one stopped by a signal it exits on) still removes it.
  process.once('exit', () => {
    if (shared[RUN]?.folder === folder) rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

/**
 * Removes the run folders in `base` whose process is no longer running: a run
 * killed before its teardown. A folder named without a process id is left alone.
 */
export function removeFoldersOfEndedRuns(base: string): void {
  for (const name of readdirSync(base)) {
    const pid = RUN_FOLDER.exec(name)?.[1];
    if (pid !== undefined && !isRunning(Number(pid))) {
      rmSync(join(base, name), { recursive: true, force: true });
    }
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as someone else. Only ESRCH says there is no such process.
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

function testFoldersIn(folder: string): Set<string> {
  return new Set(readdirSync(folder).filter((name) => TEST_FOLDER.test(name)));
}

/**
 * Ends the run: puts `TMPDIR` back and removes the run's folder. Fails if a
 * test left a folder of its own in it, which the run's folder hid (the guard
 * for #486), and reports any made in the user's temp folder while it ran.
 */
export function endTemporaryFolderPerRun(): void {
  const run = shared[RUN];
  if (!run) return;
  delete shared[RUN];
  if (run.previous === undefined) delete process.env['TMPDIR'];
  else process.env['TMPDIR'] = run.previous;
  const leftInRun = [...testFoldersIn(run.folder)];
  rmSync(run.folder, { recursive: true, force: true });
  reportMadeOutside(run);
  if (leftInRun.length > 0) {
    throw new Error(
      `Tests left ${leftInRun.length} temp folder(s) behind, removed with the run's: ` +
        `${leftInRun.join(', ')}. Remove what a test makes when it ends (issue #486).`,
    );
  }
}

/**
 * Folders made in the user's temp folder while the run ran, outside the run's
 * own. Another run in parallel makes them too, so this only reports.
 */
function reportMadeOutside(run: Run): void {
  const made = [...testFoldersIn(run.base)].filter(
    (name) => !run.before.has(name) && !name.startsWith(RUN_PREFIX),
  );
  if (made.length > 0) {
    console.warn(
      `Temp folders made outside the run's own while it ran (this run's, or another's): ${made.join(', ')}`,
    );
  }
}

/** Global set-up for Vitest and Playwright: the run's temp folder, removed at teardown. */
export default function temporaryFolderPerRun(): () => void {
  startTemporaryFolderPerRun();
  return endTemporaryFolderPerRun;
}
