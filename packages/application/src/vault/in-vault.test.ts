import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { fakeHostVaultFs } from '../testing/fake-ports.ts';
import { inVault, noVaultOpen } from './in-vault.ts';
import type { HostVaultFsPort, VaultFsPort } from './ports.ts';

const notes = createVaultPath('notes.md');

/**
 * The host as it behaves: one open vault, every path resolved against it, and
 * a write naming another vault refused. What lands where is recorded per vault.
 */
function oneOpenVault(open: string) {
  const host = { open, written: [] as { vault: string; path: string; contents: string }[] };
  const refuseOther = (vault: string) => {
    if (vault !== host.open) {
      throw new Error('another vault was opened before this could be written');
    }
  };
  const fs: HostVaultFsPort = fakeHostVaultFs({
    readTextFile: async () => ({ text: `read in ${host.open}`, modified: 7 }),
    writeTextFile: async ({ path, contents, vault }) => {
      refuseOther(vault);
      host.written.push({ vault: host.open, path, contents });
      return 8;
    },
    createNote: async ({ path, contents, vault }) => {
      refuseOther(vault);
      host.written.push({ vault: host.open, path, contents });
    },
    createFolder: async ({ path, vault }) => {
      refuseOther(vault);
      host.written.push({ vault: host.open, path, contents: '(folder)' });
    },
    moveEntry: async ({ from, vault }) => {
      refuseOther(vault);
      host.written.push({ vault: host.open, path: from, contents: '(moved)' });
    },
    trashEntry: async ({ path, vault }) => {
      refuseOther(vault);
      host.written.push({ vault: host.open, path, contents: '(trashed)' });
    },
  });
  return { host, fs };
}

describe('inVault', () => {
  it('writes into the vault it belongs to while that vault is open', async () => {
    const { host, fs } = oneOpenVault('/vaults/a');
    await inVault({ fs, vault: '/vaults/a' }).writeTextFile({
      path: notes,
      contents: 'typed in A',
      expectedModified: 7,
    });
    expect(host.written).toEqual([{ vault: '/vaults/a', path: notes, contents: 'typed in A' }]);
  });

  it('refuses a save that arrives after another vault was opened, and writes nothing', async () => {
    const { host, fs } = oneOpenVault('/vaults/a');
    const inA = inVault({ fs, vault: '/vaults/a' });
    host.open = '/vaults/b';

    await expect(
      inA.writeTextFile({ path: notes, contents: 'typed in A', expectedModified: 7 }),
    ).rejects.toThrow('another vault was opened');
    expect(host.written).toEqual([]);
  });

  it('refuses a late create, move, new folder and delete the same way', async () => {
    const { host, fs } = oneOpenVault('/vaults/a');
    const inA = inVault({ fs, vault: '/vaults/a' });
    host.open = '/vaults/b';

    await expect(inA.createNote({ path: notes, contents: '' })).rejects.toThrow('another vault');
    await expect(inA.moveEntry({ from: notes, to: createVaultPath('renamed.md') })).rejects.toThrow(
      'another vault',
    );
    await expect(inA.createFolder({ path: createVaultPath('Projects') })).rejects.toThrow(
      'another vault',
    );
    await expect(inA.trashEntry({ path: notes })).rejects.toThrow('another vault');
    expect(host.written).toEqual([]);
  });

  it('passes reads through, since a late read changes nothing on disk', async () => {
    const { host, fs } = oneOpenVault('/vaults/a');
    host.open = '/vaults/b';
    await expect(inVault({ fs, vault: '/vaults/a' }).readTextFile(notes)).resolves.toEqual({
      text: 'read in /vaults/b',
      modified: 7,
    });
  });

  it('cannot be skipped: the host itself is not a vault a use-case can write to (R14-04)', () => {
    const { fs } = oneOpenVault('/vaults/a');
    // @ts-expect-error the host's writes need a vault, and only inVault supplies it.
    const unbound: VaultFsPort = fs;
    const bound: VaultFsPort = inVault({ fs, vault: '/vaults/a' });
    expect(bound).not.toBe(unbound);
  });
});

describe('noVaultOpen', () => {
  it('refuses every write, and never asks the host (R14-04)', async () => {
    const { host, fs } = oneOpenVault('/vaults/a');
    const none = noVaultOpen(fs);

    await expect(none.createNote({ path: notes, contents: '' })).rejects.toThrow(
      'no vault is open',
    );
    await expect(
      none.writeTextFile({ path: notes, contents: 'x', expectedModified: null }),
    ).rejects.toThrow('no vault is open');
    await expect(none.createFolder({ path: createVaultPath('Projects') })).rejects.toThrow(
      'no vault is open',
    );
    await expect(none.moveEntry({ from: notes, to: createVaultPath('b.md') })).rejects.toThrow(
      'no vault is open',
    );
    await expect(none.trashEntry({ path: notes })).rejects.toThrow('no vault is open');
    await expect(
      none.writeBinaryFile({ path: notes, bytes: new Uint8Array([1]), offset: 0 }),
    ).rejects.toThrow('no vault is open');
    expect(host.written).toEqual([]);
  });

  it('passes reads through, which the host answers or refuses itself', async () => {
    const { fs } = oneOpenVault('/vaults/a');
    await expect(noVaultOpen(fs).readTextFile(notes)).resolves.toEqual({
      text: 'read in /vaults/a',
      modified: 7,
    });
  });
});
