import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Fs from 'node:fs/promises';

/*
 * Adversarial cases for the Notion import's writes (issue #13, P28-07): a write
 * that fails partway, and a second run writing the same file between this
 * run's look and its write. The file system is made to do each, for one
 * meeting; every name is made up.
 */

const SYNC = 'Inbox/Meetings/2026-10-06 Platform weekly sync.md';
const fault = { kind: 'none' as 'none' | 'torn' | 'raced' };

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof Fs>();
  const writeFile = async (...args: Parameters<typeof original.writeFile>) => {
    const [path, content, flags] = args;
    const ours = String(path).endsWith('Platform weekly sync.md');
    if (ours && fault.kind === 'torn') {
      // A full disk: the file is created and part of it written, then the write fails.
      await original.writeFile(path, String(content).slice(0, 600), flags);
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    }
    if (ours && fault.kind === 'raced') {
      // Another run of the import writes the same meeting first.
      await original.writeFile(path, content);
    }
    return original.writeFile(...args);
  };
  return { ...original, writeFile, default: { ...original, writeFile } };
});

const { importNotionMeetings } = await import('./import-notion-meetings.ts');

const FIXTURE = fileURLToPath(new URL('fixtures/export/', import.meta.url));
const CSV_NAME = 'Meeting Notes 5d0c9e2a7b1f4c3e8a6d2b9f0e1c7a54_all.csv';
let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-import-write-')));
  await cp(FIXTURE, join(root, 'export'), { recursive: true });
  await mkdir(join(root, 'vault'));
  await mkdir(join(root, 'clean vault'));
  fault.kind = 'none';
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const into = (vault: string) => ({
  csv: join(root, 'export', CSV_NAME),
  vault: join(root, vault),
  folder: 'Inbox/Meetings',
  timeZone: 'America/Los_Angeles',
  groupAddresses: [],
});

it('leaves no torn meeting behind a failed write, so a run after it brings the whole meeting in', async () => {
  await importNotionMeetings(into('clean vault'));
  const whole = await readFile(join(root, 'clean vault', SYNC), 'utf8');

  fault.kind = 'torn';
  await importNotionMeetings(into('vault'));
  fault.kind = 'none';
  await importNotionMeetings(into('vault'));

  expect(await readFile(join(root, 'vault', SYNC), 'utf8')).toBe(whole);
});

it('counts a meeting another run wrote between its look and its write as in the vault, not refused', async () => {
  fault.kind = 'raced';

  const [outcome] = await importNotionMeetings(into('vault'));

  expect(outcome).toMatchObject({ kind: 'in-vault', path: SYNC });
});
