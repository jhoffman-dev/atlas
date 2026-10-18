import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { createOwnWrites } from '../vault/own-writes.ts';
import { createNoteChanges } from './note-changes.ts';
import type { IndexEntry } from './ports.ts';
import { createIndexSyncer } from './sync-index.ts';

const VAULT = '/vaults/Larkspur';

/** Notes on a disk, some of which the host cannot read, over an index that keeps what it is given. */
function aVault(notes: readonly string[]) {
  const disk = new Map(notes.map((path) => [path, { text: `# ${path}\n`, modified: 1 }]));
  const unreadable = new Set<string>();
  const held = new Map<string, IndexEntry>();
  const ownWrites = createOwnWrites({ clock: { now: () => 0 } });
  const syncer = createIndexSyncer({
    fs: fakeVaultFs({
      listNotes: async () =>
        [...disk].map(([path, file]) => ({
          name: path,
          path: createVaultPath(path),
          modified: file.modified,
          size: file.text.length,
        })),
      // The host leaves out a note it could not read, as `read_notes_at` does.
      readNotes: async (paths) =>
        paths.flatMap((path) => {
          const file = disk.get(path);
          if (file === undefined || unreadable.has(path)) return [];
          return [{ path, ...file, size: file.text.length }];
        }),
    }),
    index: fakeIndexPort({
      manifest: async () => [...held.values()],
      put: async (indexed) => {
        for (const { path, modified, size, digest, type } of indexed) {
          held.set(path, { path, modified, size, digest, type });
        }
      },
    }),
    markdown: fakeMarkdown(),
    activity: recordingActivity(),
    changes: createNoteChanges({ onError: () => {} }),
    openVault: () => VAULT,
    ownWrites,
  });
  /** The app saves a note: on disk, and kept as its own. */
  const save = (path: string, text: string, modified: number) => {
    disk.set(path, { text, modified });
    ownWrites.record({ vault: VAULT, path, left: { kind: 'text', text, modified } });
  };
  const isHeld = (path: string) => ownWrites.refreshedAt({ vault: VAULT, path }) !== null;
  return { syncer, save, unreadable, ownWrites, isHeld };
}

describe('createIndexSyncer: which of the app’s own writes a sync took in (#254)', () => {
  it('holds the writes made before a sync it finished, and none it did not read', async () => {
    const vault = aVault(['Plan.md', 'Other.md']);
    await vault.syncer.sync({ vault: VAULT, fromScratch: false });
    vault.save('Plan.md', '# Plan, saved\n', 2);
    vault.save('Other.md', '# Other, saved\n', 2);
    vault.unreadable.add('Other.md');
    await vault.syncer.sync({ vault: VAULT, fromScratch: false });
    expect(vault.isHeld('Plan.md')).toBe(true);
    expect(vault.isHeld('Other.md')).toBe(false);

    // Read by the next sync, it is held then.
    vault.unreadable.clear();
    await vault.syncer.sync({ vault: VAULT, fromScratch: false });
    expect(vault.isHeld('Other.md')).toBe(true);
  });

  it('holds nothing for a sync of a vault no longer open', async () => {
    const vault = aVault(['Plan.md']);
    vault.save('Plan.md', '# Plan, saved\n', 2);
    await vault.syncer.sync({ vault: '/vaults/Quill', fromScratch: false });
    expect(vault.isHeld('Plan.md')).toBe(false);
  });
});
