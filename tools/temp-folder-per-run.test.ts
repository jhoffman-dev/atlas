import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

let scratch: string;

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Runs Vitest, with this repo's config, on one test, with `temp` as the user's temp folder. */
function vitestRun(temp: string, test: string) {
  return spawnSync(process.execPath, [VITEST, 'run', test], {
    cwd: ROOT,
    env: { ...process.env, TMPDIR: temp, CI: '' },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/*
 * Issue #486: a day of agent runs left 45 GB in the temp folder after #397's
 * per-run folder was in place. Vitest makes a folder of its own there for the
 * modules it hands its workers before any global set-up runs, and never
 * removes it: about 15 MB a run, named only by a random id.
 */
describe('a Vitest run', () => {
  it('leaves nothing in the temp folder', () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'atlas-temp-guard-')));

    const run = vitestRun(scratch, 'tools/temp-folder-per-run/inside-the-run.test.ts');

    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(readdirSync(scratch)).toEqual([]);
  }, 90_000);
});
