import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  endTemporaryFolderPerRun,
  removeFoldersOfEndedRuns,
  startTemporaryFolderPerRun,
} from './temp-folder-per-run.ts';

const ROOT = join(import.meta.dirname, '..');
const VITEST = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');

const TMPDIR = process.env['TMPDIR'];
let scratch: string;

afterEach(() => {
  process.env['TMPDIR'] = TMPDIR;
  rmSync(scratch, { recursive: true, force: true });
});

function makeScratch(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'atlas-temp-guard-')));
}

/** The id of a process that has ended. */
function endedPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  });
  return Number(child.stdout);
}

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
    scratch = makeScratch();

    const run = vitestRun(scratch, 'tools/temp-folder-per-run/inside-the-run.test.ts');

    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(readdirSync(scratch)).toEqual([]);
  }, 90_000);
});

describe('removing the folders of ended runs', () => {
  it('removes a run folder whose process has ended, and keeps the rest', () => {
    scratch = makeScratch();
    const ended = `atlas-test-run-${endedPid()}-kill9d`;
    const live = `atlas-test-run-${process.pid}-runnin`;
    const unnamed = 'atlas-test-run-AbC123';
    for (const name of [ended, live, unnamed])
      mkdirSync(join(scratch, name, 'inside'), { recursive: true });

    removeFoldersOfEndedRuns(scratch);

    expect(readdirSync(scratch).sort()).toEqual([live, unnamed].sort());
  });
});

describe("a run's folder", () => {
  it('starts once per process, and ends with TMPDIR put back and the folder gone', () => {
    scratch = makeScratch();
    process.env['TMPDIR'] = scratch;

    const run = startTemporaryFolderPerRun();

    expect(startTemporaryFolderPerRun()).toBe(run);
    expect(tmpdir()).toBe(run);
    endTemporaryFolderPerRun();
    expect(process.env['TMPDIR']).toBe(scratch);
    expect(readdirSync(scratch)).toEqual([]);
  });

  it('fails the run when a test left a folder of its own in it, and still removes it', () => {
    scratch = makeScratch();
    process.env['TMPDIR'] = scratch;
    const run = startTemporaryFolderPerRun();
    mkdtempSync(join(run, 'atlas-left-'));
    mkdtempSync(join(run, 'dfai-left-'));
    mkdtempSync(join(run, 'some-cache-'));

    expect(() => endTemporaryFolderPerRun()).toThrow(/2 temp folder\(s\).*atlas-left-.*dfai-left-/);
    expect(readdirSync(scratch)).toEqual([]);
  });

  it("reports a folder made in the user's temp folder while it ran, and leaves it there", () => {
    scratch = makeScratch();
    process.env['TMPDIR'] = scratch;
    mkdirSync(join(scratch, 'atlas-before-it'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startTemporaryFolderPerRun();
    mkdirSync(join(scratch, 'atlas-made-outside'));

    endTemporaryFolderPerRun();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/: atlas-made-outside$/);
    expect(readdirSync(scratch).sort()).toEqual(['atlas-before-it', 'atlas-made-outside']);
    warn.mockRestore();
  });
});
