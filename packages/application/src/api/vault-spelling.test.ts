import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultEntry } from '@atlas/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { VaultAccessError } from '../vault/ports.ts';
import { spelledAsVault } from './vault-spelling.ts';

const entry = (path: string, kind: 'file' | 'directory'): VaultEntry =>
  ({ kind, name: path.split('/').at(-1) ?? path, path: createVaultPath(path) }) as VaultEntry;

/** A vault holding `Tasks/Call Sam.md`, listed a folder at a time. */
const fs = fakeVaultFs({
  listDirectory: async (folder) => {
    if (folder === '') return [entry('Tasks', 'directory')];
    if (folder === 'Tasks') return [entry('Tasks/Call Sam.md', 'file')];
    throw new VaultAccessError(`no such folder: ${folder}`);
  },
});

const spell = (asked: string, accepts: (path: string) => boolean = () => true) =>
  spelledAsVault({ fs, asked: createVaultPath(asked), accepts });

describe('spelledAsVault', () => {
  it('answers a path in the spelling the vault uses, segment by segment', async () => {
    expect(await spell('tasks/call sam.md')).toBe('Tasks/Call Sam.md');
  });

  it('leaves a path nothing matches as it was asked', async () => {
    expect(await spell('tasks/nobody.md')).toBe('tasks/nobody.md');
  });

  it('leaves a path under a folder that is not there as asked, rather than failing', async () => {
    expect(await spell('Tasks/Call Sam.md/deeper.md')).toBe('Tasks/Call Sam.md/deeper.md');
  });

  it('leaves a spelling the caller could not have named as asked', async () => {
    expect(await spell('tasks/call sam.md', () => false)).toBe('tasks/call sam.md');
  });

  it('passes on a failure that is not a missing folder', async () => {
    const broken = fakeVaultFs({
      listDirectory: () => Promise.reject(new Error('the disk went away')),
    });

    await expect(
      spelledAsVault({ fs: broken, asked: createVaultPath('a.md'), accepts: () => true }),
    ).rejects.toThrow('the disk went away');
  });
});
