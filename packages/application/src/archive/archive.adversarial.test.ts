/**
 * Adversarial pass on Phase 23 (A23): ways into the Archive that skip
 * archiving, and an unarchive whose folder the disk spells another way.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createVaultPath,
  parentVaultPath,
  vaultPathName,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { renameEntry } from '../vault/relocate-entry.ts';
import { unarchiveNotes, type ArchivePorts } from './archive-notes.ts';

const path = createVaultPath;

const editors = {
  state: () => 'closed' as const,
  flush: async () => {},
  follow: () => {},
  abandon: () => {},
  reload: () => {},
};

describe('only archiving puts notes in the Archive (A23)', () => {
  it('refuses to rename a folder at the root to “Archive”, which would archive every note in it unstamped', async () => {
    const moveEntry = vi.fn(async () => {});
    const fs = fakeVaultFs({
      listDirectory: async () => [
        { kind: 'directory', name: 'Old', path: path('Old') } as VaultEntry,
      ],
      moveEntry,
    });
    await expect(
      renameEntry({
        ports: { fs, index: fakeIndexPort(), editors },
        entry: { path: path('Old'), kind: 'directory' },
        name: 'Archive',
        notePaths: [path('Old/plan.md')],
      }),
    ).rejects.toThrow();
    expect(moveEntry).not.toHaveBeenCalled();
  });
});

describe('unarchive finds the folder it goes back to however the disk spells it (A23)', () => {
  it('goes back into a folder the disk lists decomposed when the record spells it composed', async () => {
    // APFS: one folder answers to both spellings, and making the other one is refused.
    const same = (left: string, right: string) =>
      left.normalize('NFC').toLowerCase() === right.normalize('NFC').toLowerCase();
    const dirs = new Set<string>(['Café', 'Archive', 'Archive/Café']);
    const files = new Map<string, string>([
      ['Archive/Café/menu.md', '---\narchivedFrom: Café/menu.md\n---\n'],
    ]);
    const entry = (at: string, kind: VaultEntry['kind']) =>
      ({ kind, name: vaultPathName(path(at)), path: path(at) }) as VaultEntry;
    const fs = fakeVaultFs({
      listDirectory: async (parent) => [
        ...[...dirs]
          .filter((at) => same(parentVaultPath(path(at)), parent))
          .map((at) => entry(at, 'directory')),
        ...[...files.keys()]
          .filter((at) => same(parentVaultPath(path(at)), parent))
          .map((at) => entry(at, 'file')),
      ],
      createFolder: async ({ path: at }) => {
        if ([...dirs].some((dir) => same(dir, at)))
          throw new Error('something with that name is already there');
        dirs.add(at);
      },
      moveEntry: async (move) => {
        const text = files.get(move.from);
        if (text === undefined) throw new Error('no such entry');
        files.delete(move.from);
        files.set(move.to, text);
      },
      readTextFile: async (at) => ({ text: files.get(at) ?? '', modified: 1 }),
      writeTextFile: async ({ path: at, contents }) => {
        files.set(at, contents);
        return 2;
      },
    });
    const ports: ArchivePorts = { fs, index: fakeIndexPort(), markdown: fakeMarkdown(), editors };

    const outcome = await unarchiveNotes({
      ports,
      paths: [path('Archive/Café/menu.md')],
      notePaths: [...files.keys()].map((at) => path(at) as VaultPath),
    });

    expect(outcome.failed).toEqual([]);
    expect(outcome.moves).toHaveLength(1);
  });
});
