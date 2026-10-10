import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GTD_STATUSES } from './task-status.ts';

/* The command James runs, from plain `node`: what it prints, what it exits with, and where it never writes. */

const CLI = fileURLToPath(new URL('../import-notion-workspace.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('fixtures/workspace/', import.meta.url));

let home: string;
let exportDir: string;
let copy: string;

const taskType = (options: readonly string[], done: string) =>
  `---\nname: task\nlabel: Task\nproperties:\n  status:\n    kind: select\n    options: [${options.join(', ')}]\n    done: ${done}\n---\n`;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-workspace-cli-')));
  exportDir = join(home, 'Downloads/Export-1');
  copy = join(home, 'vault copy');
  await cp(FIXTURE, exportDir, { recursive: true });
  await mkdir(join(home, 'Atlas Vault'));
  await mkdir(join(copy, '.atlas', 'types'), { recursive: true });
  await writeFile(join(copy, '.atlas', 'types', 'task.md'), taskType(GTD_STATUSES, 'archive'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** The command run in the real vault's folder, with HOME the test's, so a default would land there. */
const run = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    cwd: join(home, 'Atlas Vault'),
    env: { ...process.env, HOME: home },
    encoding: 'utf8',
    timeout: 60_000,
  });

// Each test starts `node`, which transpiles the domain and the adapters as it loads them: slow under load.
describe('import-notion-workspace', { timeout: 120_000 }, () => {
  it.each([[[]], [['--export', 'x']], [['--vault', '.']], [['--export', ' ', '--vault', '.']]])(
    'names no default: %j prints the usage, exits 2 and writes nothing',
    async (args) => {
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('usage: node tools/import-notion-workspace.mjs --export');
      expect(await readdir(join(home, 'Atlas Vault'))).toEqual([]);
    },
  );

  it.each([
    [['--only', 'tasks,calendar'], '--only: name databases from tasks, notes'],
    [['--gemini-dates', 'utc'], '--gemini-dates: "utc" is not one of arrival-local'],
  ])('refuses %j before it reads anything', (args, message) => {
    const result = run('--export', exportDir, '--vault', copy, ...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
  });

  it('refuses a status that is not one of the eight, and a vault not on GTD, writing nothing', async () => {
    const status = run('--export', exportDir, '--vault', copy, '--task-status', 'Later=done');
    expect(status.status).toBe(2);
    expect(status.stderr).toContain('cannot import: --task-status: "done" is not one of inbox');
    await writeFile(
      join(copy, '.atlas', 'types', 'task.md'),
      taskType(['backlog', 'done'], 'done'),
    );
    const gtd = run('--export', exportDir, '--vault', copy);
    expect(gtd.status).toBe(2);
    expect(gtd.stderr).toContain('run the GTD move first');
    expect((await readdir(copy)).sort()).toEqual(['.atlas']);
  });

  it('dry-runs, then imports, then finds nothing to do, exiting 0 each time', async () => {
    const dry = run(
      '--export',
      exportDir,
      '--vault',
      copy,
      '--dry-run',
      '--gemini-dates',
      'arrival-local',
    );
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain('dry run: nothing was written');
    expect((await readdir(copy)).sort()).toEqual(['.atlas']);

    const real = run('--export', exportDir, '--vault', copy, '--gemini-dates', 'arrival-local');
    expect(real.status, real.stderr).toBe(0);
    expect(real.stdout).toContain('created   Tasks/Renew the Larkspur contract.md');
    expect(real.stdout).toMatch(/18 pages: 18 created, 0 updated, 0 unchanged, 0 refused/);

    const again = run('--export', exportDir, '--vault', copy, '--gemini-dates', 'arrival-local');
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toMatch(/18 pages: 0 created, 0 updated, 18 unchanged, 0 refused/);
    expect(await readdir(join(home, 'Atlas Vault'))).toEqual([]);
  });

  it('exits 1 while a meeting is held for its dates, and runs only the databases named', () => {
    const result = run('--export', exportDir, '--vault', copy, '--only', 'meetings, people');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('held      "1:1"');
    expect(result.stdout).toContain('created   People/Mara Quill.md');
    expect(result.stdout).not.toContain('Tasks/');
  });
});
