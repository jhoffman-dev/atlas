import { cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importNotionWorkspace } from './import-notion-workspace.ts';
import { GTD_STATUSES } from '../../packages/domain/src/index.ts';
import type * as workspaceWrite from './workspace-write.ts';

/* A new note that could not be written, then the run cut off: the write-ahead log must not count it as made. */

const script = { calls: 0, refuseFirst: false, dieOnSecond: false };

vi.mock('./workspace-write.ts', async (original) => {
  const real = await original<typeof workspaceWrite>();
  return {
    ...real,
    writePlanned: vi.fn(async (...args: Parameters<typeof real.writePlanned>) => {
      script.calls += 1;
      if (script.refuseFirst && script.calls === 1)
        return { ok: false, reason: 'the disk said no' };
      if (script.dieOnSecond && script.calls === 2) throw new Error('the power went');
      return real.writePlanned(...args);
    }),
  };
});

const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));

let root: string;
let exportDir: string;
let vault: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-pending-run-')));
  exportDir = join(root, 'export');
  vault = join(root, 'vault copy');
  await cp(FIXTURE, exportDir, { recursive: true });
  await mkdir(join(vault, '.atlas', 'types'), { recursive: true });
  await writeFile(
    join(vault, '.atlas', 'types', 'task.md'),
    `---\nname: task\nlabel: Task\nproperties:\n  status:\n    kind: select\n    options: [${GTD_STATUSES.join(', ')}]\n    done: archive\n---\n`,
  );
});

afterEach(async () => {
  Object.assign(script, { calls: 0, refuseFirst: false, dieOnSecond: false });
  await rm(root, { recursive: true, force: true });
});

const run = () =>
  importNotionWorkspace({
    exportDir,
    vault,
    dryRun: false,
    only: ['people'],
    taskStatuses: [],
    today: '2026-10-10',
    timeZone: 'America/Los_Angeles',
  });

describe('a new note the disk refused, then a run cut off', () => {
  it('is made by the next run, not taken for one deleted in Atlas', async () => {
    Object.assign(script, { refuseFirst: true, dieOnSecond: true });
    await expect(run()).rejects.toThrow('the power went');
    Object.assign(script, { calls: 0, refuseFirst: false, dieOnSecond: false });
    const outcome = await run();
    expect(outcome.pages.find((page) => page.title === 'Mara Quill')?.kind).toBe('create');
    expect(await readdir(join(vault, 'People'))).toContain('Mara Quill.md');
  });
});
