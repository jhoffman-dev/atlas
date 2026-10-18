import { describe, expect, it } from 'vitest';
import { createVaultPath, parentVaultPath, vaultPathName, type VaultEntry } from '@atlas/domain';
import { fakeVaultFs } from '../testing/fake-ports.ts';
import { createOwnWrites, OWN_WRITES_KEPT } from './own-writes.ts';
import { awaitsOwnRefresh, outsideChanges } from './outside-changes.ts';
import { recordingOwnWrites } from './recording-own-writes.ts';
import type { VaultFsPort } from './ports.ts';

/**
 * Attacks on PR #264 (#258): the app now records each note it creates as its
 * own write, so the watcher's echo of it is dropped. An outside change at a
 * newly created path must never be dropped with it.
 *
 * The disk here trashes and moves a folder with everything in it, as a real
 * one does, refuses a create where something already is, and counts host calls.
 */

const VAULT = '/vaults/larkspur';
const path = createVaultPath;

type OnDisk = { readonly text: string; readonly modified: number } | 'folder';

function aDisk() {
  const files = new Map<string, OnDisk>();
  const calls = { readNotes: 0, listDirectory: 0, pathsRead: 0 };
  const disk = { mtime: 1_000 };
  const now = 50_000;
  const under = (at: string) => (each: string) => each === at || each.startsWith(`${at}/`);
  const removeTree = (at: string) => {
    for (const each of [...files.keys()].filter(under(at))) files.delete(each);
  };
  const moveTree = (from: string, to: string) => {
    for (const each of [...files.keys()].filter(under(from))) {
      const moving = files.get(each);
      files.delete(each);
      if (moving !== undefined) files.set(`${to}${each.slice(from.length)}`, moving);
    }
  };
  const host: VaultFsPort = fakeVaultFs({
    readNotes: async (paths) => {
      calls.readNotes += 1;
      calls.pathsRead += paths.length;
      return paths.flatMap((each) => {
        const file = files.get(each);
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
      files.set(at, { text: contents, modified: disk.mtime });
      return disk.mtime;
    },
    createNote: async ({ path: at, contents }) => {
      if (files.has(at)) throw new Error('a note with that name already exists');
      files.set(at, { text: contents, modified: disk.mtime });
      return disk.mtime;
    },
    createFolder: async ({ path: at }) => void files.set(at, 'folder'),
    moveEntry: async ({ from, to }) => {
      if (!files.has(from)) throw new Error('nothing to move');
      moveTree(from, to);
    },
    trashEntry: async ({ path: at }) => removeTree(at),
  });
  const ownWrites = createOwnWrites({ clock: { now: () => now } });
  const fs = recordingOwnWrites({ fs: host, ownWrites, vault: VAULT });
  const outside = {
    /** Another program's write, timed by the disk's clock. */
    write: (at: string, text: string) => files.set(at, { text, modified: disk.mtime }),
    /** A copy that keeps the file's own time, as `cp -p`, a sync client or a restore does. */
    restore: (at: string, text: string, modified: number) => files.set(at, { text, modified }),
    folder: (at: string) => files.set(at, 'folder'),
    remove: (at: string) => removeTree(at),
  };
  return {
    fs,
    disk,
    calls,
    outside,
    ownWrites,
    refreshedThroughNow: () =>
      ownWrites.refreshed({ vault: VAULT, through: ownWrites.lastWrite() }),
    reported: (paths: readonly string[]) =>
      outsideChanges({ fs: host, ownWrites, vault: VAULT, paths }),
  };
}

const create = (fs: VaultFsPort, at: string, contents: string) =>
  fs.createNote({ path: path(at), contents });
const save = (fs: VaultFsPort, at: string, contents: string) =>
  fs.writeTextFile({ path: path(at), contents, expectedModified: null });

describe('attack #264: an outside write straight after the app’s create', () => {
  it('keeps another program’s write of other bytes in the same millisecond as the create', async () => {
    const disk = aDisk();
    await create(disk.fs, 'Inbox/Call the vet.md', '# Call the vet\n');
    disk.refreshedThroughNow();
    disk.outside.write('Inbox/Call the vet.md', '# Call the vet tomorrow\n');
    expect(await disk.reported(['Inbox/Call the vet.md'])).toEqual(['Inbox/Call the vet.md']);
  });

  it('keeps a sync client’s replacement, which keeps the remote copy’s own time', async () => {
    const disk = aDisk();
    await create(disk.fs, 'Inbox/Call the vet.md', '# Call the vet\n');
    disk.refreshedThroughNow();
    disk.outside.restore('Inbox/Call the vet.md', '# Call the vet\n', 999);
    expect(await disk.reported(['Inbox/Call the vet.md'])).toEqual(['Inbox/Call the vet.md']);
  });

  it('keeps another program’s write that lands after the create and before the refresh reads it', async () => {
    const disk = aDisk();
    await create(disk.fs, 'Inbox/Call the vet.md', '# Call the vet\n');
    const began = disk.ownWrites.lastWrite();
    disk.outside.write('Inbox/Call the vet.md', '# Theirs\n');
    disk.ownWrites.refreshed({ vault: VAULT, through: began });
    expect(await disk.reported(['Inbox/Call the vet.md'])).toEqual(['Inbox/Call the vet.md']);
  });
});

describe('attack #264: the app creates, then writes again', () => {
  it('drops the echo of a create and the save straight after it, both the app’s', async () => {
    const disk = aDisk();
    await create(disk.fs, 'Inbox/Capture.md', '# Capture\n');
    disk.disk.mtime += 1;
    await save(disk.fs, 'Inbox/Capture.md', '# Capture\n\nMore.\n');
    disk.refreshedThroughNow();
    expect(await disk.reported(['Inbox/.Capture.md.atlas-tmp', 'Inbox/Capture.md'])).toEqual([]);
  });

  it('keeps another program’s write that came back to the create’s bytes and time after the app’s save', async () => {
    const disk = aDisk();
    await create(disk.fs, 'Inbox/Capture.md', '# Capture\n');
    disk.disk.mtime += 1;
    await save(disk.fs, 'Inbox/Capture.md', '# Capture\n\nMore.\n');
    disk.refreshedThroughNow();
    disk.outside.restore('Inbox/Capture.md', '# Capture\n', 1_000);
    expect(await disk.reported(['Inbox/Capture.md'])).toEqual(['Inbox/Capture.md']);
  });

  it('keeps the save’s echo when the create’s answer arrives after the save’s', async () => {
    const disk = aDisk();
    let answerCreate: () => void = () => undefined;
    const slowCreate = recordingOwnWrites({
      fs: fakeVaultFs({
        createNote: () =>
          new Promise<number>((resolve) => {
            answerCreate = () => resolve(1_000);
          }),
      }),
      ownWrites: disk.ownWrites,
      vault: VAULT,
    });
    const creating = create(slowCreate, 'Inbox/Capture.md', '# Capture\n');
    disk.outside.write('Inbox/Capture.md', '# Capture\n');
    disk.disk.mtime += 1;
    await save(disk.fs, 'Inbox/Capture.md', '# Capture, saved\n');
    answerCreate();
    await creating;
    disk.refreshedThroughNow();
    // The create's late record stands over the save's: what it says is not on disk,
    // so the echo of the save is refreshed for, never wrongly dropped.
    expect(await disk.reported(['Inbox/Capture.md'])).toEqual(['Inbox/Capture.md']);
  });
});

describe('attack #264: a new note moved, trashed or refused', () => {
  it('keeps another program’s note at the old path of a new note the app renamed', async () => {
    const disk = aDisk();
    await create(disk.fs, 'Inbox/Untitled.md', '# Untitled\n');
    await disk.fs.moveEntry({ from: path('Inbox/Untitled.md'), to: path('Inbox/Groceries.md') });
    disk.refreshedThroughNow();
    disk.outside.restore('Inbox/Untitled.md', '# Untitled\n', 1_000);
    expect(await disk.reported(['Inbox/Untitled.md'])).toEqual(['Inbox/Untitled.md']);
  });

  it('keeps a trashed new note another program put back with its bytes and time', async () => {
    const disk = aDisk();
    await create(disk.fs, 'Inbox/Untitled.md', '# Untitled\n');
    await disk.fs.trashEntry({ path: path('Inbox/Untitled.md') });
    disk.refreshedThroughNow();
    disk.outside.restore('Inbox/Untitled.md', '# Untitled\n', 1_000);
    expect(await disk.reported(['Inbox/Untitled.md'])).toEqual(['Inbox/Untitled.md']);
  });

  it('keeps another program’s note where the app’s second create was refused', async () => {
    const disk = aDisk();
    await create(disk.fs, 'Inbox/Untitled.md', '# Untitled\n');
    disk.refreshedThroughNow();
    disk.outside.write('Inbox/Untitled.md', '# Theirs\n');
    await expect(create(disk.fs, 'Inbox/Untitled.md', '# Untitled\n')).rejects.toThrow(
      'already exists',
    );
    expect(await disk.reported(['Inbox/Untitled.md'])).toEqual(['Inbox/Untitled.md']);
  });
});

describe('attack #264: a new note in a folder the app has just made', () => {
  it('drops the echo of the folder and the note made in it', async () => {
    const disk = aDisk();
    await disk.fs.createFolder({ path: path('Projects/Larkspur') });
    await create(disk.fs, 'Projects/Larkspur/Plan.md', '# Plan\n');
    disk.refreshedThroughNow();
    expect(
      await disk.reported([
        'Projects/Larkspur',
        'Projects/Larkspur/.Plan.md.atlas-tmp',
        'Projects/Larkspur/Plan.md',
      ]),
    ).toEqual([]);
  });

  it('keeps the folder when another program adds a note to it beside the app’s', async () => {
    const disk = aDisk();
    await disk.fs.createFolder({ path: path('Projects/Larkspur') });
    await create(disk.fs, 'Projects/Larkspur/Plan.md', '# Plan\n');
    disk.refreshedThroughNow();
    disk.outside.write('Projects/Larkspur/Budget.md', '# Budget\n');
    expect(await disk.reported(['Projects/Larkspur'])).toEqual(['Projects/Larkspur']);
  });

  // The app trashes the folder; the record of the note it created inside is
  // not touched, so it still says the note is there, held by the index. A
  // sync client or a restore that brings the note back with its own bytes and
  // time — the folder having come back first, in an earlier report — is then
  // taken for the app's echo, and the note never reaches the index.
  it('keeps a note put back, with its bytes and time, inside a folder of new notes the app trashed', async () => {
    const disk = aDisk();
    await disk.fs.createFolder({ path: path('Projects/Larkspur') });
    await create(disk.fs, 'Projects/Larkspur/Plan.md', '# Plan\n');
    await disk.fs.trashEntry({ path: path('Projects/Larkspur') });
    disk.refreshedThroughNow();

    disk.outside.folder('Projects/Larkspur');
    disk.outside.restore('Projects/Larkspur/Plan.md', '# Plan\n', 1_000);

    expect(await disk.reported(['Projects/Larkspur/Plan.md'])).toEqual([
      'Projects/Larkspur/Plan.md',
    ]);
  });

  it('forgets the notes the app created inside a folder it trashed', async () => {
    const disk = aDisk();
    await disk.fs.createFolder({ path: path('Projects/Larkspur') });
    await create(disk.fs, 'Projects/Larkspur/Plan.md', '# Plan\n');
    await disk.fs.trashEntry({ path: path('Projects/Larkspur') });
    expect(
      disk.ownWrites.leftAt({ vault: VAULT, path: 'Projects/Larkspur/Plan.md' }),
    ).not.toMatchObject({ kind: 'text' });
  });

  it('keeps a note put back at its old path inside a folder of new notes the app renamed', async () => {
    const disk = aDisk();
    await disk.fs.createFolder({ path: path('Projects/Larkspur') });
    await create(disk.fs, 'Projects/Larkspur/Plan.md', '# Plan\n');
    await disk.fs.moveEntry({ from: path('Projects/Larkspur'), to: path('Archive/Larkspur') });
    disk.refreshedThroughNow();

    disk.outside.folder('Projects/Larkspur');
    disk.outside.restore('Projects/Larkspur/Plan.md', '# Plan\n', 1_000);

    expect(await disk.reported(['Projects/Larkspur/Plan.md'])).toEqual([
      'Projects/Larkspur/Plan.md',
    ]);
  });
});

describe('attack #264: a host that answers a create with no usable time', () => {
  for (const answer of [null, undefined, Number.NaN, 0, -0]) {
    it(`keeps the new note when the host answers its create with ${Object.is(answer, -0) ? '-0' : String(answer)}`, async () => {
      const disk = aDisk();
      const oddHost = recordingOwnWrites({
        fs: fakeVaultFs({
          createNote: async ({ path: at, contents }) => {
            disk.outside.write(at, contents);
            return answer as unknown as number; // An older or broken host, as JSON brings it.
          },
        }),
        ownWrites: disk.ownWrites,
        vault: VAULT,
      });
      await create(oddHost, 'Inbox/Untitled.md', '# Untitled\n');
      disk.refreshedThroughNow();
      expect(await disk.reported(['Inbox/Untitled.md'])).toEqual(['Inbox/Untitled.md']);
    });
  }
});

describe('attack #264: the cost of a burst of creates', () => {
  it('reads once, and no more notes than it keeps, for a burst of 1,000 creates', async () => {
    const disk = aDisk();
    const notes = Array.from({ length: 1_000 }, (_, at) => `Inbox/Capture ${at}.md`);
    for (const note of notes) {
      disk.disk.mtime += 1;
      await create(disk.fs, note, `# ${note}\n`);
    }
    disk.refreshedThroughNow();
    const left = await disk.reported(notes);

    expect(left).toEqual(notes.slice(0, 1_000 - OWN_WRITES_KEPT));
    expect(disk.calls).toEqual({ readNotes: 1, listDirectory: 0, pathsRead: OWN_WRITES_KEPT });
  });

  it('waits on the app’s refresh for a burst of new notes only while one is still kept', async () => {
    const disk = aDisk();
    const notes = Array.from({ length: 1_000 }, (_, at) => `Inbox/Capture ${at}.md`);
    for (const note of notes) await create(disk.fs, note, `# ${note}\n`);
    expect(awaitsOwnRefresh({ ownWrites: disk.ownWrites, vault: VAULT, paths: notes })).toBe(true);
    disk.refreshedThroughNow();
    expect(awaitsOwnRefresh({ ownWrites: disk.ownWrites, vault: VAULT, paths: notes })).toBe(false);
  });
});
