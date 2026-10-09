import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/* The command James runs, from plain `node`: what it prints, what it exits with, and where it never writes. */

const CLI = fileURLToPath(new URL('../import-notion-meetings.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('fixtures/export/', import.meta.url));
const CSV_NAME = 'Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54_all.csv';

let home: string;
let csv: string;

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-import-cli-')));
  await cp(FIXTURE, join(home, 'Downloads/export'), { recursive: true });
  await mkdir(join(home, 'Atlas Vault'));
  await mkdir(join(home, 'vault copy'));
  csv = join(home, 'Downloads/export', CSV_NAME);
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

describe('import-notion-meetings', () => {
  it.each([[[]], [['--csv', 'export.csv']], [['--vault', '.']]])(
    'writes nowhere without both --csv and --vault, and says how to use it: %j',
    async (args) => {
      const result = run(...args);

      expect(result.stderr).toMatch(/usage: .*--csv .*--vault/);
      expect(result.status).toBe(2);
      expect(await readdir(join(home, 'Atlas Vault'))).toEqual([]);
    },
  );

  it('imports into the vault it is given, prints every row, and a second run writes nothing', async () => {
    const vault = join(home, 'vault copy');

    const first = run('--csv', csv, '--vault', vault);
    const second = run('--csv', csv, '--vault', vault);

    expect(first.stdout).toMatch(
      /^wrote {5}Inbox\/Meetings\/2026-10-06 Platform weekly sync\.md$/m,
    );
    expect(first.stdout).toMatch(
      /^no id {5}"Notes from the offsite" \(September 30, 2026\): no Source ID/m,
    );
    expect(first.stdout).toMatch(
      /^5 rows: 4 written, 0 already in the vault, 1 without a Source ID, 0 refused$/m,
    );
    expect(first.status).toBe(0);
    expect(second.stdout).toMatch(
      /^5 rows: 0 written, 4 already in the vault, 1 without a Source ID, 0 refused$/m,
    );
    expect(second.status).toBe(0);
    expect(await readdir(join(home, 'Atlas Vault'))).toEqual([]);
  });

  it('exits 1 when a row with a Source ID was not brought in', async () => {
    await writeFile(
      csv,
      'Meeting name,Date,Source,Source ID\r\nRetro,"October 3, 2026 4:00 PM",granola,not_nowhere000001\r\n',
    );

    const result = run('--csv', csv, '--vault', join(home, 'vault copy'));

    expect(result.stdout).toMatch(
      /^refused {3}"Retro" \(October 3, 2026 4:00 PM\): no page in the export/m,
    );
    expect(result.status).toBe(1);
  });

  it('exits 2 with the reason when it cannot start, and no stack trace', () => {
    const result = run('--csv', csv, '--vault', join(home, 'no such vault'));

    expect(result.stderr).toMatch(/^cannot import: vault: there is no folder at /m);
    expect(result.stderr).not.toMatch(/at .*\.ts/);
    expect(result.status).toBe(2);
  });

  it('reads --time-zone none as no zone, refusing a UTC Date rather than guessing its day', () => {
    const result = run('--csv', csv, '--vault', join(home, 'vault copy'), '--time-zone', 'none');

    expect(result.stdout).toMatch(
      /^refused {3}"Larkspur Payroll: renewal, "final" terms" .*is an instant/m,
    );
    expect(result.status).toBe(1);
  });
});
