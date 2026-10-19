import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Global set-up for the Vitest and Playwright runs: points this run's temp folder
 * at a fresh folder of its own, and removes that folder when the run ends.
 *
 * Issue #397: helpers that forgot to clean up left 80 GB in the temp folder over
 * a night of agent runs. Each helper now removes what it makes; this is the net
 * under them, for whatever one still leaves or a worker killed mid-test.
 *
 * `TMPDIR` is set before the workers start, so they inherit it and every
 * `os.tmpdir()` in a test lands inside the run's folder. The teardown removes
 * only that folder, so a run never touches another's, even running in parallel.
 */
export default function temporaryFolderPerRun(): () => void {
  const run = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-test-run-')));
  const previous = process.env['TMPDIR'];
  process.env['TMPDIR'] = run;
  return () => {
    if (previous === undefined) delete process.env['TMPDIR'];
    else process.env['TMPDIR'] = previous;
    rmSync(run, { recursive: true, force: true });
  };
}
