import { describe, expect, it } from 'vitest';
import { memoryVault } from '../testing/fake-git.ts';
import { ensureFolderOf } from './ensure-folder.ts';

describe('ensureFolderOf', () => {
  it('makes every folder a deep path needs, one level at a time', async () => {
    const { fs } = memoryVault();
    await ensureFolderOf(fs, 'Projects/2026/Ideas.md');
    await expect(fs.listDirectory('' as never)).resolves.toEqual([
      { kind: 'directory', name: 'Projects', path: 'Projects' },
    ]);
    await expect(fs.listDirectory('Projects' as never)).resolves.toEqual([
      { kind: 'directory', name: '2026', path: 'Projects/2026' },
    ]);
  });

  it('does nothing for a path with no folder of its own', async () => {
    const { fs } = memoryVault();
    await ensureFolderOf(fs, 'Ideas.md');
    await expect(fs.listDirectory('' as never)).resolves.toEqual([]);
  });

  it('leaves a folder that is already there as it is', async () => {
    const { fs } = memoryVault();
    await fs.createFolder({ path: 'Projects' as never });
    await expect(ensureFolderOf(fs, 'Projects/Ideas.md')).resolves.toBeUndefined();
    await expect(fs.listDirectory('' as never)).resolves.toEqual([
      { kind: 'directory', name: 'Projects', path: 'Projects' },
    ]);
  });

  it('skips a name the vault’s paths cannot spell, such as one with a backslash', async () => {
    const { fs } = memoryVault();
    await expect(ensureFolderOf(fs, 'a\\b/Ideas.md')).resolves.toBeUndefined();
    await expect(fs.listDirectory('' as never)).resolves.toEqual([]);
  });

  it('never throws when the host refuses every folder it is asked to make', async () => {
    const fs = {
      listDirectory: async () => [],
      createFolder: async () => {
        throw new Error('permission denied');
      },
    };
    await expect(ensureFolderOf(fs, 'Projects/Ideas.md')).resolves.toBeUndefined();
  });

  it('goes on to the next level when a folder was made meanwhile and is refused as taken', async () => {
    const fs = {
      listDirectory: async () => [],
      createFolder: async () => {
        throw new Error('something with that name is already there');
      },
    };
    await expect(ensureFolderOf(fs, 'Projects/2026/Ideas.md')).resolves.toBeUndefined();
  });
});
