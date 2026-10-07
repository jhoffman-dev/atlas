import { describe, expect, it, vi } from 'vitest';
import {
  createVaultPath,
  HIDDEN_DIRECTORY_NAMES,
  VAULT_WALK_DEPTH,
  VAULT_ROOT,
  type VaultEntry,
} from '@atlas/domain';
import { listVaultDirectory, listVaultNotes, readVaultFile } from './read-vault.ts';
import type { NoteListing, VaultFsPort } from './ports.ts';

const entry = (name: string, kind: VaultEntry['kind'] = 'file'): VaultEntry =>
  ({ kind, name, path: createVaultPath(name) }) as VaultEntry;

const fakeFs = (entries: VaultEntry[], text = ''): VaultFsPort => ({
  listDirectory: async () => entries,
  listNotes: async () => [],
  readNotes: async () => [],
  readBinaryFile: async () => new ArrayBuffer(0),
  createNote: async () => {},
  createFolder: async () => {},
  moveEntry: async () => {},
  trashEntry: async () => {},
  writeBinaryFile: async () => 0,
  readTextFile: async () => ({ text, modified: 1 }),
  writeTextFile: async () => 2,
});

describe('listVaultDirectory', () => {
  it('returns the entries the host reported', async () => {
    const result = await listVaultDirectory({
      fs: fakeFs([entry('a.md'), entry('Notes', 'directory')]),
      path: VAULT_ROOT,
    });
    expect(result.map((item) => item.name)).toEqual(['a.md', 'Notes']);
  });

  it('removes entries the user should never see', async () => {
    const result = await listVaultDirectory({
      fs: fakeFs([entry('.git', 'directory'), entry('a.md'), entry('.DS_Store')]),
      path: VAULT_ROOT,
    });
    expect(result.map((item) => item.name)).toEqual(['a.md']);
  });

  it('propagates a read failure rather than showing an empty directory', async () => {
    const fs: VaultFsPort = {
      listDirectory: () => Promise.reject(new Error('permission denied')),
      listNotes: async () => [],
      readNotes: async () => [],
      readBinaryFile: async () => new ArrayBuffer(0),
      createNote: async () => {},
      createFolder: async () => {},
      moveEntry: async () => {},
      trashEntry: async () => {},
      writeBinaryFile: async () => 0,
      readTextFile: async () => ({ text: '', modified: 1 }),
      writeTextFile: async () => 2,
    };
    await expect(listVaultDirectory({ fs, path: VAULT_ROOT })).rejects.toThrow('permission denied');
  });
});

/**
 * The host walks the disk and hands over everything it finds; these tests give it
 * the kind of list a real vault produces and check that the deciding happens here.
 */
describe('listVaultNotes', () => {
  const listing = (path: string): NoteListing => ({
    name: path.split('/').at(-1) ?? path,
    path: createVaultPath(path),
    modified: 1,
    size: 1,
  });

  const hostReturning = (paths: string[]): VaultFsPort => ({
    ...fakeFs([]),
    listNotes: async () => paths.map(listing),
  });

  it('keeps the notes in user space', async () => {
    await expect(
      listVaultNotes({ fs: hostReturning(['todo.md', 'Notes/today.md']) }),
    ).resolves.toEqual(['todo.md', 'Notes/today.md']);
  });

  it('drops a note the host found inside a hidden directory', async () => {
    await expect(
      listVaultNotes({
        fs: hostReturning(['.git/COMMIT_EDITMSG.md', '.trash/deleted.md', 'keep.md']),
      }),
    ).resolves.toEqual(['keep.md']);
  });

  it('drops a note inside a dotted directory the host was not told about', async () => {
    // The host has no opinion about a dot any more, so this is the only place
    // `.secret` is ruled out.
    await expect(
      listVaultNotes({ fs: hostReturning(['.secret/hidden.md', 'keep.md']) }),
    ).resolves.toEqual(['keep.md']);
  });

  it('keeps .atlas notes, which are ordinary notes you can open', async () => {
    await expect(
      listVaultNotes({
        fs: hostReturning(['.atlas/types/task.md', '.atlas/settings.md']),
      }),
    ).resolves.toEqual(['.atlas/types/task.md', '.atlas/settings.md']);
  });

  it('leaves templates out, so no link, search or picker treats one as a note (ADR-0026)', async () => {
    await expect(
      listVaultNotes({
        fs: hostReturning(['People/Ada.md', '.atlas/templates/Person.md']),
      }),
    ).resolves.toEqual(['People/Ada.md']);
  });

  it('leaves out the .atlas folders a sidebar section already lists', async () => {
    await expect(
      listVaultNotes({
        fs: hostReturning(['.atlas/views/Board.md', '.atlas/dashboards/Home.md', 'keep.md']),
      }),
    ).resolves.toEqual(['keep.md']);
  });

  it('tells the host which folders not to descend into, and how deep to go', async () => {
    const listNotes = vi.fn(async () => []);
    await listVaultNotes({ fs: { ...fakeFs([]), listNotes } });
    // The depth is the domain's, so archiving can refuse what the walk would not read (A20-06).
    expect(listNotes).toHaveBeenCalledWith({
      skipDirectories: HIDDEN_DIRECTORY_NAMES,
      maxDepth: VAULT_WALK_DEPTH,
    });
  });

  it('would drop everything under those folders anyway, if the host sent them', async () => {
    // What makes the host's pruning an optimisation rather than a decision.
    const paths = HIDDEN_DIRECTORY_NAMES.map((name) => `${name}/note.md`);
    await expect(listVaultNotes({ fs: hostReturning([...paths, 'keep.md']) })).resolves.toEqual([
      'keep.md',
    ]);
  });
});

describe('readVaultFile', () => {
  it('returns the file contents unchanged', async () => {
    const text = '---\ntitle: Today\n---\n\n# Today\n';
    await expect(
      readVaultFile({ fs: fakeFs([], text), path: createVaultPath('a.md') }),
    ).resolves.toEqual({ text, modified: 1 });
  });

  it('propagates a read failure', async () => {
    const fs: VaultFsPort = {
      listDirectory: async () => [],
      listNotes: async () => [],
      readNotes: async () => [],
      readBinaryFile: async () => new ArrayBuffer(0),
      createNote: async () => {},
      createFolder: async () => {},
      moveEntry: async () => {},
      trashEntry: async () => {},
      writeBinaryFile: async () => 0,
      readTextFile: () => Promise.reject(new Error('not utf-8')),
      writeTextFile: async () => 2,
    };
    await expect(readVaultFile({ fs, path: createVaultPath('a.png') })).rejects.toThrow(
      'not utf-8',
    );
  });
});
