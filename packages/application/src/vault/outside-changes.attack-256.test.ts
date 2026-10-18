import { describe, expect, it } from 'vitest';
import { createVaultPath, parentVaultPath, vaultPathName, type VaultEntry } from '@atlas/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { createOwnWrites, OWN_WRITE_KEPT_MS, OWN_WRITES_KEPT } from './own-writes.ts';
import { outsideChanges } from './outside-changes.ts';
import { recordingOwnWrites } from './recording-own-writes.ts';
import type { VaultFsPort } from './ports.ts';

/**
 * Attacks on PR #256 (#254): an outside change must never be dropped as the
 * echo of the app's own write. The disk here is case-insensitive when asked,
 * as APFS is by default, and counts every host call.
 */

const VAULT = '/vaults/larkspur';
const path = createVaultPath;

type OnDisk = { readonly text: string; readonly modified: number } | 'folder';

function aDisk({ caseInsensitive = false } = {}) {
  const files = new Map<string, OnDisk>();
  const calls = { readNotes: 0, listDirectory: 0, pathsRead: 0 };
  const disk = { mtime: 1_000 };
  let now = 50_000;
  const fold = (each: string) => (caseInsensitive ? each.toLowerCase() : each);
  const find = (at: string) => [...files.keys()].find((each) => fold(each) === fold(at));
  const host: VaultFsPort = fakeVaultFs({
    readNotes: async (paths) => {
      calls.readNotes += 1;
      calls.pathsRead += paths.length;
      return paths.flatMap((each) => {
        const stored = find(each);
        const file = stored === undefined ? undefined : files.get(stored);
        if (file === undefined || file === 'folder') return [];
        return [{ path: each, text: file.text, modified: file.modified, size: file.text.length }];
      });
    },
    listDirectory: async (folder) => {
      calls.listDirectory += 1;
      return [...files]
        .filter(([each]) => parentVaultPath(path(each)) === folder)
        .map(([each, file]): VaultEntry => ({
          kind: file === 'folder' ? 'directory' : 'file',
          name: vaultPathName(path(each)),
          path: path(each),
        }));
    },
    writeTextFile: async ({ path: at, contents }) => {
      files.delete(find(at) ?? at);
      files.set(at, { text: contents, modified: disk.mtime });
      return disk.mtime;
    },
    createFolder: async ({ path: at }) => void files.set(at, 'folder'),
    moveEntry: async ({ from, to }) => {
      const moving = files.get(from);
      if (moving === undefined) throw new Error('nothing to move');
      files.delete(from);
      files.set(to, moving);
    },
    trashEntry: async ({ path: at }) => void files.delete(at),
  });
  const ownWrites = createOwnWrites({ clock: { now: () => now } });
  const fs = recordingOwnWrites({ fs: host, ownWrites, vault: VAULT });
  const outside = {
    write: (at: string, text: string) => {
      files.delete(find(at) ?? at);
      files.set(at, { text, modified: disk.mtime });
    },
    folder: (at: string) => files.set(at, 'folder'),
    removeTree: (at: string) => {
      for (const each of [...files.keys()])
        if (each === at || each.startsWith(`${at}/`)) files.delete(each);
    },
    rename: (from: string, to: string) => {
      const moving = files.get(from);
      files.delete(from);
      if (moving !== undefined) files.set(to, moving);
    },
  };
  const refreshedThroughNow = () =>
    ownWrites.refreshed({ vault: VAULT, through: ownWrites.lastWrite() });
  const reported = (paths: readonly string[]) =>
    outsideChanges({ fs: host, ownWrites, vault: VAULT, paths });
  return {
    fs,
    disk,
    calls,
    outside,
    ownWrites,
    refreshedThroughNow,
    reported,
    wait: (ms: number) => void (now += ms),
  };
}

const save = (fs: VaultFsPort, at: string, contents: string) =>
  fs.writeTextFile({ path: path(at), contents, expectedModified: null });

describe('attack #256: a folder the app made, replaced from outside', () => {
  // Finder's "Replace", a sync client landing a downloaded folder, `mv` from
  // elsewhere: the folder arrives whole, by one rename, and the watcher
  // reports the folder's path and nothing inside it.
  it('keeps the report of a folder of notes moved in where the app had just made an empty one', async () => {
    const disk = aDisk();
    await disk.fs.createFolder({ path: path('Projects/Larkspur') });
    disk.refreshedThroughNow();

    disk.outside.removeTree('Projects/Larkspur');
    disk.outside.folder('Projects/Larkspur');
    disk.outside.write('Projects/Larkspur/Plan.md', '# Plan\n\nWritten elsewhere.\n');

    expect(await disk.reported(['Projects/Larkspur'])).toEqual(['Projects/Larkspur']);
  });
});

describe('attack #256: the cost of telling an echo, for a burst', () => {
  it('lists no more than a couple of folders for a burst of trashes across many folders', async () => {
    const disk = aDisk();
    const notes = Array.from({ length: OWN_WRITES_KEPT }, (_, at) => `Area ${at}/Old.md`);
    for (const note of notes) {
      disk.outside.folder(note.split('/')[0] ?? '');
      disk.outside.write(note, '# Old\n');
      await disk.fs.trashEntry({ path: path(note) });
    }
    disk.refreshedThroughNow();

    expect(await disk.reported(notes)).toEqual([]);
    // The refresh this saves is one walk of the vault; telling the echo must not cost hundreds.
    expect(disk.calls.listDirectory + disk.calls.readNotes).toBeLessThanOrEqual(2);
  });

  it('reads once, and no more notes than it keeps, for a burst of 1,000 saves', async () => {
    const disk = aDisk();
    const notes = Array.from({ length: 1_000 }, (_, at) => `Tasks/Task ${at}.md`);
    for (const note of notes) {
      disk.disk.mtime += 1;
      await save(disk.fs, note, `# ${note}\n`);
    }
    disk.refreshedThroughNow();
    const left = await disk.reported(notes);

    // The oldest past the capacity are refreshed for, as any change is.
    expect(left).toEqual(notes.slice(0, 1_000 - OWN_WRITES_KEPT));
    expect(disk.calls).toEqual({ readNotes: 1, listDirectory: 0, pathsRead: OWN_WRITES_KEPT });
  });
});

describe('attack #256: outside writes racing the app’s', () => {
  it('keeps another program’s write that landed while the refresh after the app’s was running', async () => {
    const disk = aDisk();
    await save(disk.fs, 'Notes/Plan.md', '# Plan\n');
    const began = disk.ownWrites.lastWrite();
    disk.outside.write('Notes/Plan.md', '# Plan, from the phone\n');
    disk.ownWrites.refreshed({ vault: VAULT, through: began });
    expect(await disk.reported(['Notes/Plan.md'])).toEqual(['Notes/Plan.md']);
  });

  it('keeps a note another program wrote between two of the app’s saves, until the second is refreshed for', async () => {
    const disk = aDisk();
    await save(disk.fs, 'Notes/Plan.md', '# Plan 1\n');
    disk.refreshedThroughNow();
    disk.outside.write('Notes/Plan.md', '# Plan, theirs\n');
    disk.disk.mtime += 1;
    await save(disk.fs, 'Notes/Plan.md', '# Plan 2\n');
    expect(await disk.reported(['Notes/Plan.md'])).toEqual(['Notes/Plan.md']);
  });

  it('keeps another program’s write of different bytes with the time the app’s save left', async () => {
    const disk = aDisk();
    await save(disk.fs, 'Notes/Plan.md', '# Plan A\n');
    disk.refreshedThroughNow();
    disk.outside.write('Notes/Plan.md', '# Plan B\n');
    expect(await disk.reported(['.Plan.md.atlas-tmp', 'Notes/Plan.md'])).toEqual([
      '.Plan.md.atlas-tmp',
      'Notes/Plan.md',
    ]);
  });
});

describe('attack #256: names the disk folds together', () => {
  it('keeps the new name when another program changes only the case of a note the app saved', async () => {
    const disk = aDisk({ caseInsensitive: true });
    await save(disk.fs, 'Notes/Plan.md', '# Plan\n');
    disk.refreshedThroughNow();
    disk.outside.rename('Notes/Plan.md', 'Notes/plan.md');
    expect(await disk.reported(['Notes/Plan.md', 'Notes/plan.md'])).toContain('Notes/plan.md');
  });

  it('keeps a report in the other Unicode form of a name the app saved', async () => {
    const disk = aDisk();
    const composed = 'Notes/Café.md';
    const decomposed = 'Notes/Café.md';
    await save(disk.fs, composed, '# Café\n');
    disk.refreshedThroughNow();
    expect(await disk.reported([decomposed])).toEqual([decomposed]);
  });

  it('keeps a note another program made, in another case, where the app had just trashed one', async () => {
    const disk = aDisk({ caseInsensitive: true });
    disk.outside.write('Notes/Old.md', '# Old\n');
    await disk.fs.trashEntry({ path: path('Notes/Old.md') });
    disk.refreshedThroughNow();
    disk.outside.write('Notes/old.md', '# Old again, from git\n');
    expect(await disk.reported(['Notes/old.md'])).toEqual(['Notes/old.md']);
  });
});

describe('attack #256: how long a write is the app’s', () => {
  it('drops the echo at exactly the window, and keeps it one millisecond past', async () => {
    const disk = aDisk();
    await save(disk.fs, 'Notes/Plan.md', '# Plan\n');
    disk.refreshedThroughNow();
    disk.wait(OWN_WRITE_KEPT_MS);
    expect(await disk.reported(['Notes/Plan.md'])).toEqual([]);
    disk.wait(1);
    expect(await disk.reported(['Notes/Plan.md'])).toEqual(['Notes/Plan.md']);
  });

  it('keeps the echo after the clock jumps forward past the window', async () => {
    const disk = aDisk();
    await save(disk.fs, 'Notes/Plan.md', '# Plan\n');
    disk.refreshedThroughNow();
    disk.wait(60 * 60 * 1_000);
    expect(await disk.reported(['Notes/Plan.md'])).toEqual(['Notes/Plan.md']);
  });
});
