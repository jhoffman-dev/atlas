import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultEntry, type VaultPath } from '@dfai/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { linkedPdf } from './open-highlight-place.ts';

/*
 * Verification (#506, PR #522 after 54f53fc3): `[[…pdf]]` walks the vault
 * folder by folder, one host call per folder, on every click.
 */

const directory = (path: string): VaultEntry =>
  ({ kind: 'directory', name: path.split('/').at(-1), path: createVaultPath(path) }) as VaultEntry;
const file = (path: string): VaultEntry =>
  ({ kind: 'file', name: path.split('/').at(-1), path: createVaultPath(path) }) as VaultEntry;

/** A vault of `areas` × 10 × 20 folders, ten notes in each, as a tree of listings. */
function largeVault(areas: number): Map<string, VaultEntry[]> {
  const tree = new Map<string, VaultEntry[]>([['', []]]);
  const add = (parent: string, entry: VaultEntry) => {
    const listed = tree.get(parent) ?? [];
    if (!listed.some((known) => known.path === entry.path)) listed.push(entry);
    tree.set(parent, listed);
    if (entry.kind === 'directory' && !tree.has(entry.path)) tree.set(entry.path, []);
  };
  for (let a = 0; a < areas; a += 1) {
    add('', directory(`Area ${a}`));
    for (let b = 0; b < 10; b += 1) {
      add(`Area ${a}`, directory(`Area ${a}/Topic ${b}`));
      for (let c = 0; c < 20; c += 1) {
        const folder = `Area ${a}/Topic ${b}/Folder ${c}`;
        add(`Area ${a}/Topic ${b}`, directory(folder));
        for (let n = 0; n < 10; n += 1) add(folder, file(`${folder}/Note ${n}.md`));
      }
    }
  }
  add('Area 3/Topic 4/Folder 5', file('Area 3/Topic 4/Folder 5/the-lantern-keepers.pdf'));
  return tree;
}

describe('following [[…pdf]] in a vault of 2,000 folders and 20,000 notes', () => {
  it('does not ask the host to list every folder of the vault on each click', async () => {
    const tree = largeVault(10);
    let calls = 0;
    const fs = fakeVaultFs({
      listDirectory: async (path: VaultPath) => {
        calls += 1;
        return tree.get(path) ?? [];
      },
    });
    expect(await linkedPdf({ fs }, 'the-lantern-keepers.pdf')).toBe(
      'Area 3/Topic 4/Folder 5/the-lantern-keepers.pdf',
    );
    // Measured: 2,111 calls per click, 250–360 ms on disk for this vault
    // (readdir + stat, before IPC); the note walk does it in one `listNotes`.
    expect(calls).toBeLessThanOrEqual(33);
  });
});

describe('following [[…pdf]] when one folder of the vault cannot be listed', () => {
  it('still finds the PDF in the folders that can, as the note walk does', async () => {
    const pdf = createVaultPath('Library/the-lantern-keepers.pdf');
    const fs = fakeVaultFs({
      listDirectory: async (path: VaultPath) => {
        if (path === '') return [directory('Library'), directory('Private')];
        if (path === 'Library') return [file(pdf)];
        // A folder this user may not read, or one a sync removed mid-walk.
        throw new Error(`Permission denied: ${path}`);
      },
    });
    expect(await linkedPdf({ fs }, 'the-lantern-keepers.pdf')).toBe(pdf);
  });
});
