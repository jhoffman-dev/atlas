import { appendFile, cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importNotionWorkspace } from './import-notion-workspace.ts';
import type * as recordFile from './record-file.ts';
import { saveRecord } from './record-file.ts';
import { GTD_STATUSES } from '../../packages/domain/src/index.ts';
import { workspaceImported, workspaceReportLines } from './workspace-report.ts';

/* The record failing partway through a run: what was written is reported, and nothing after it is written. */

vi.mock('./record-file.ts', async (original) => ({
  ...(await original<typeof recordFile>()),
  saveRecord: vi.fn(),
}));

const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));
const TASKS = 'Private & Shared/Tasks Tracker a1000000000000000000000000000000';

let root: string;
let exportDir: string;
let vault: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-record-')));
  exportDir = join(root, 'export');
  vault = join(root, 'vault copy');
  await cp(FIXTURE, exportDir, { recursive: true });
  await mkdir(join(vault, '.atlas', 'types'), { recursive: true });
  await writeFile(
    join(vault, '.atlas', 'types', 'task.md'),
    `---\nname: task\nlabel: Task\nproperties:\n  status:\n    kind: select\n    options: [${GTD_STATUSES.join(', ')}]\n    done: archive\n---\n`,
  );
  // Thirty more tasks, so the run saves its record partway through.
  for (let at = 10; at < 40; at += 1) {
    const title = `Chore ${at}`;
    await appendFile(join(exportDir, `${TASKS}_all.csv`), `${title},Inbox,,,,,,,,,\n`);
    await writeFile(
      join(exportDir, TASKS, `${title} a10000000000000000000000000000${at}.md`),
      `# ${title}\n\nStatus: Inbox\n`,
    );
  }
});

afterEach(async () => {
  vi.mocked(saveRecord).mockReset();
  await rm(root, { recursive: true, force: true });
});

const run = () =>
  importNotionWorkspace({
    exportDir,
    vault,
    dryRun: false,
    only: ['tasks'],
    taskStatuses: [],
    today: '2026-10-10',
    timeZone: 'America/Los_Angeles',
  });

describe('a record that cannot be saved partway through', () => {
  it('stops the writes there, reports the notes written, and fails the run', async () => {
    vi.mocked(saveRecord).mockRejectedValueOnce(
      Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }),
    );
    const outcome = await run();
    const written = outcome.pages.filter((page) => page.kind === 'create');
    const refused = outcome.pages.filter((page) => page.kind === 'refused');
    expect(written).toHaveLength(25);
    expect(refused).toHaveLength(12);
    expect(refused[0]).toMatchObject({
      reason: 'not written: the record could not be written (no space left on device)',
    });
    expect(
      (await readdir(join(vault, 'Tasks'))).filter((name) => !name.startsWith('.')),
    ).toHaveLength(25);
    expect(outcome.recordProblem).toBe('the record could not be written (no space left on device)');
    expect(workspaceReportLines(outcome)[0]).toBe(
      'stopped   the record could not be written (no space left on device): the notes listed as written were, and no others',
    );
    expect(workspaceImported(outcome)).toBe(false);
    expect(vi.mocked(saveRecord)).toHaveBeenCalledTimes(1);
  });

  it('fails the run when only the last save fails, every note written', async () => {
    vi.mocked(saveRecord)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('read-only file system'), { code: 'EROFS' }));
    const outcome = await run();
    expect(outcome.pages.filter((page) => page.kind === 'refused')).toEqual([]);
    expect(outcome.recordProblem).toBe('the record could not be written (read-only file system)');
    expect(workspaceImported(outcome)).toBe(false);
  });

  it('saves it every 25 notes and at the end when it can', async () => {
    vi.mocked(saveRecord).mockResolvedValue(undefined);
    const outcome = await run();
    expect(outcome.pages.filter((page) => page.kind === 'create')).toHaveLength(37);
    expect(vi.mocked(saveRecord)).toHaveBeenCalledTimes(2);
    const [, last] = vi.mocked(saveRecord).mock.calls[1] ?? [];
    expect(last?.size).toBe(37);
  });
});
