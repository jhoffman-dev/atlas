import { cp, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Fs from 'node:fs/promises';

/*
 * What a failed write leaves behind: the file system is made to fail while
 * one meeting's whole content is written under its hidden name. Every name
 * here is made up.
 */

const failing = { on: false };

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof Fs>();
  const writeFile = async (...args: Parameters<typeof original.writeFile>) => {
    const [path, content, flags] = args;
    if (failing.on && String(content).includes("external_id: 'not_Fx81kQz0aB12cd'")) {
      await original.writeFile(path, String(content).slice(0, 200), flags);
      throw Object.assign(new Error(`ENOSPC: no space left on device, write '${String(path)}'`), {
        code: 'ENOSPC',
      });
    }
    return original.writeFile(...args);
  };
  return { ...original, writeFile, default: { ...original, writeFile } };
});

const { importNotionMeetings } = await import('./import-notion-meetings.ts');

const FIXTURE = fileURLToPath(new URL('fixtures/export/', import.meta.url));
let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-import-write-')));
  await cp(FIXTURE, join(root, 'export'), { recursive: true });
  await mkdir(join(root, 'vault'));
  failing.on = true;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const run = () =>
  importNotionMeetings({
    csv: join(root, 'export/Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54_all.csv'),
    vault: join(root, 'vault'),
    folder: 'Inbox/Meetings',
    timeZone: 'America/Los_Angeles',
    groupAddresses: [],
    providers: ['granola'],
  });

it('says why a write failed without saying where the vault is on this machine', async () => {
  const outcomes = await run();

  expect(outcomes[1]).toMatchObject({
    kind: 'refused',
    reason: expect.stringMatching(/^cannot write into Inbox\/Meetings: ENOSPC: /),
  });
  expect(JSON.stringify(outcomes)).not.toContain(root);
});

it('leaves nothing behind a failed write, not even its hidden copy', async () => {
  await run();

  expect(await readdir(join(root, 'vault/Inbox/Meetings'))).toEqual([]);
});
