import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import type { PagePlan } from './workspace-plan.ts';
import { writePlanned } from './workspace-write.ts';

/* The writes themselves, against a real folder: whole files, and never over a note that moved on. */

const placed = {
  database: 'Tasks Tracker',
  title: 'Plan the offsite',
  id: 'a1000000000000000000000000000005',
  path: createVaultPath('Tasks/Plan the offsite.md'),
  type: 'task',
  notes: [],
  imported: { fields: {}, body: 'nothing' },
};

const create = (content: string): Extract<PagePlan, { kind: 'create' }> => ({
  kind: 'create',
  ...placed,
  content,
});

const update = (before: string, after: string): Extract<PagePlan, { kind: 'update' }> => ({
  kind: 'update',
  ...placed,
  before,
  after,
  changed: ['status'],
  kept: [],
});

let vault: string;

beforeEach(async () => {
  vault = await realpath(await mkdtemp(join(tmpdir(), 'atlas-notion-write-')));
});

afterEach(async () => {
  await chmod(join(vault, 'Tasks'), 0o755).catch(() => undefined);
  await rm(vault, { recursive: true, force: true });
});

const path = () => join(vault, 'Tasks', 'Plan the offsite.md');
const hidden = async () =>
  (await readdir(join(vault, 'Tasks'))).filter((name) => name.startsWith('.'));

describe('writing a new note', () => {
  it('writes it whole, in a folder made for it, leaving nothing hidden behind', async () => {
    expect(await writePlanned(vault, create('new\n'))).toEqual({ ok: true });
    expect(await readFile(path(), 'utf8')).toBe('new\n');
    expect(await hidden()).toEqual([]);
  });

  it('never writes over a file that took its name while the run was planning', async () => {
    await mkdir(join(vault, 'Tasks'));
    await writeFile(path(), 'mine\n');
    expect(await writePlanned(vault, create('new\n'))).toEqual({
      ok: false,
      reason: 'a file took Tasks/Plan the offsite.md while the run was planning: run again',
    });
    expect(await readFile(path(), 'utf8')).toBe('mine\n');
    expect(await hidden()).toEqual([]);
  });

  it('turns a folder it may not write into a refusal of that note', async () => {
    await mkdir(join(vault, 'Tasks'));
    await chmod(join(vault, 'Tasks'), 0o500);
    const written = await writePlanned(vault, create('new\n'));
    expect(written.ok).toBe(false);
    expect(written.ok ? '' : written.reason).toMatch(/^cannot write Tasks\/Plan the offsite\.md: /);
  });
});

describe('bringing a note into step', () => {
  beforeEach(async () => {
    await mkdir(join(vault, 'Tasks'));
    await writeFile(path(), 'before\n');
  });

  it('puts the new text in place of the note it was planned from', async () => {
    expect(await writePlanned(vault, update('before\n', 'after\n'))).toEqual({ ok: true });
    expect(await readFile(path(), 'utf8')).toBe('after\n');
    expect(await hidden()).toEqual([]);
  });

  it('leaves a note that changed while the run was planning as it is now', async () => {
    await writeFile(path(), 'typed during the run\n');
    expect(await writePlanned(vault, update('before\n', 'after\n'))).toEqual({
      ok: false,
      reason: 'Tasks/Plan the offsite.md changed while the run was planning: run again',
    });
    expect(await readFile(path(), 'utf8')).toBe('typed during the run\n');
    expect(await hidden()).toEqual([]);
  });

  it('does not bring back a note deleted, or written in another encoding, during the run', async () => {
    await writeFile(path(), Buffer.from([0x62, 0xe9, 0x0a]));
    expect((await writePlanned(vault, update('before\n', 'after\n'))).ok).toBe(false);
    await rm(path());
    expect((await writePlanned(vault, update('before\n', 'after\n'))).ok).toBe(false);
    expect(await readdir(join(vault, 'Tasks'))).toEqual([]);
  });
});
