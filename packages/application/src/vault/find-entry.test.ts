/**
 * Finding an entry by listing the way down to it: a folder that is not there
 * is "nothing there"; a folder that is there but fails to list is a failure.
 */
import { describe, expect, it } from 'vitest';
import { MIGRATION_RECORD_PATH, type VaultPath } from '@dfai/domain';
import { readMigrationRecord } from '../gtd/migration-record-file.ts';
import { memoryVault } from '../testing/fake-git.ts';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { findVaultEntry } from './find-entry.ts';
import type { VaultFsPort } from './ports.ts';

const RECORD = MIGRATION_RECORD_PATH;

/** A vault whose host times out listing `failing`, though the folder is there. */
function vault(files: Record<string, string>, failing: string | null = null): VaultFsPort {
  const { fs } = memoryVault(files);
  return fakeVaultFs({
    ...fs,
    listDirectory: async (path: VaultPath) => {
      if (path === failing) throw new Error('Operation timed out');
      return fs.listDirectory(path);
    },
  });
}

describe('findVaultEntry', () => {
  it('finds a file by its path, in the spelling the disk lists it in', async () => {
    const fs = vault({ '.atlas/Migrations/task-statuses.md': 'x' });
    expect(await findVaultEntry(fs, RECORD)).toMatchObject({
      kind: 'file',
      path: '.atlas/Migrations/task-statuses.md',
    });
  });

  it('is null when a folder on the way, or the file, is not there', async () => {
    expect(await findVaultEntry(vault({ 'notes/a.md': 'x' }), RECORD)).toBeNull();
    expect(await findVaultEntry(vault({ '.atlas/migrations/other.md': 'x' }), RECORD)).toBeNull();
  });

  it('is null when a file stands where a folder on the way should be', async () => {
    expect(await findVaultEntry(vault({ '.atlas/migrations': 'x' }), RECORD)).toBeNull();
  });

  it('passes on a listing that fails, rather than taking it for nothing there', async () => {
    const fs = vault({ '.atlas/migrations/task-statuses.md': 'x' }, '.atlas/migrations');
    await expect(findVaultEntry(fs, RECORD)).rejects.toThrow('Operation timed out');
  });
});

describe('readMigrationRecord, when its folder cannot be listed', () => {
  it('fails, so the move to GTD is stopped rather than run as if it never had', async () => {
    const fs = vault({ '.atlas/migrations/task-statuses.md': 'x' }, '.atlas/migrations');
    await expect(readMigrationRecord(fs)).rejects.toThrow('Operation timed out');
  });

  it('is null in a vault with no migrations folder', async () => {
    expect(await readMigrationRecord(vault({ 'notes/a.md': 'x' }))).toBeNull();
  });
});
