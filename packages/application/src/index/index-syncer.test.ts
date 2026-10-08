import { describe, expect, it } from 'vitest';
import { createVaultPath, digestOf, type NoteChange } from '@atlas/domain';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { deleteEntry } from '../vault/delete-entry.ts';
import { renameEntry } from '../vault/relocate-entry.ts';
import type { OpenEditorsPort } from '../vault/ports.ts';
import { createNoteChanges, type NoteChangeNews } from './note-changes.ts';
import type { IndexEntry, IndexPort } from './ports.ts';
import { createIndexSyncer } from './sync-index.ts';

const LARKSPUR = '/vaults/Larkspur';
const KICKOFF = 'meetings/Kickoff.md';
const KICKOFF_TEXT = '---\ntype: meeting\n---\nAgenda with Mara Quill.\n';

/**
 * A vault held in memory, every write a tick later, and an index that keeps
 * what it is handed and answers its manifest from it — as the host's does.
 */
function vaultWithIndex(notes: Record<string, string> = {}) {
  const files = new Map<string, { text: string; modified: number }>();
  let clock = 0;
  const write = (path: string, text: string) => void files.set(path, { text, modified: ++clock });
  for (const [path, text] of Object.entries(notes)) write(path, text);

  const fs = fakeVaultFs({
    listNotes: async () =>
      [...files].map(([path, file]) => ({
        name: path.split('/').at(-1) ?? path,
        path: createVaultPath(path),
        modified: file.modified,
        size: file.text.length,
      })),
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const file = files.get(path);
        return file === undefined ? [] : [{ path, ...file, size: file.text.length }];
      }),
    readTextFile: async (path) => files.get(path) ?? { text: '', modified: 0 },
    trashEntry: async ({ path }) => void files.delete(path),
    moveEntry: async ({ from, to }) => {
      const file = files.get(from);
      if (file === undefined) return;
      files.delete(from);
      files.set(to, file);
    },
  });

  const held = new Map<string, IndexEntry>();
  const index = fakeIndexPort({
    clear: async () => held.clear(),
    manifest: async () => [...held.values()],
    put: async (indexed) => {
      for (const { path, modified, size, digest, type } of indexed) {
        held.set(path, { path, modified, size, digest, type });
      }
    },
    remove: async (paths) => {
      for (const path of paths) held.delete(path);
    },
    stats: async () => ({ notes: held.size, properties: 0, links: 0 }),
  });

  return {
    fs,
    index,
    held,
    write,
    /** A newer modification time over the same bytes, as a checkout or a sync leaves. */
    touch: (path: string) => write(path, files.get(path)?.text ?? ''),
    erase: (path: string) => void files.delete(path),
    notePaths: () => [...files.keys()].map(createVaultPath),
  };
}

type Vault = ReturnType<typeof vaultWithIndex>;

function syncerOver({ fs, index }: Pick<Vault, 'fs' | 'index'>) {
  const heard: NoteChangeNews[] = [];
  const changes = createNoteChanges({
    onError: (cause) => {
      throw cause;
    },
  });
  changes.subscribe((news) => heard.push(news));
  const syncer = createIndexSyncer({
    fs,
    index,
    markdown: fakeMarkdown(),
    activity: recordingActivity(),
    changes,
  });
  return {
    heard,
    sync: (fromScratch = false, at = LARKSPUR) => syncer.sync({ vault: at, fromScratch }),
    /** Everything heard since the last call. */
    news: () => heard.splice(0).flatMap((each) => each.changes),
  };
}

/** A vault already synced once, so what follows is measured from a known state. */
async function synced(notes: Record<string, string> = {}) {
  const vault = vaultWithIndex(notes);
  const syncer = syncerOver(vault);
  await syncer.sync();
  syncer.news();
  return { vault, ...syncer };
}

const change = (kind: NoteChange['kind'], path: string, text: string, type: string | null) => ({
  kind,
  path,
  type,
  digest: digestOf(text),
});

const editors: OpenEditorsPort = {
  state: () => 'closed',
  flush: async () => {},
  follow: () => {},
  abandon: () => {},
};

describe('the index syncer reports what changed (P28-03)', () => {
  it('reports a new note as added once, with its type and digest', async () => {
    const { vault, sync, news } = await synced({ 'Idea.md': 'a spark' });

    vault.write(KICKOFF, KICKOFF_TEXT);
    await sync();

    expect(news()).toEqual([change('added', KICKOFF, KICKOFF_TEXT, 'meeting')]);
  });

  it('reports an edited note as changed once, as it now is', async () => {
    const { vault, sync, news } = await synced({ [KICKOFF]: KICKOFF_TEXT });

    const edited = `${KICKOFF_TEXT}Decided: ship on Friday.\n`;
    vault.write(KICKOFF, edited);
    await sync();

    expect(news()).toEqual([change('changed', KICKOFF, edited, 'meeting')]);
  });

  it('reports a deleted note as removed once, as it last was', async () => {
    const { vault, sync, news } = await synced({ [KICKOFF]: KICKOFF_TEXT, 'Idea.md': 'a spark' });

    vault.erase(KICKOFF);
    await sync();

    expect(news()).toEqual([change('removed', KICKOFF, KICKOFF_TEXT, 'meeting')]);
  });

  it('publishes nothing when nothing changed, nor when only a modification time did', async () => {
    const { vault, sync, heard } = await synced({ [KICKOFF]: KICKOFF_TEXT });

    await sync();
    vault.touch(KICKOFF);
    await sync();

    expect(vault.held.get(KICKOFF)?.modified).toBe(2);
    expect(heard).toEqual([]);
  });

  it('reports nothing when the index is rebuilt and the notes are as they were', async () => {
    const { vault, sync, heard } = await synced({ [KICKOFF]: KICKOFF_TEXT, 'Idea.md': 'a spark' });

    await sync(true);

    expect(vault.held.size).toBe(2);
    expect(heard).toEqual([]);
  });

  it('reports only what really changed across a rebuild', async () => {
    const { vault, sync, news } = await synced({ [KICKOFF]: KICKOFF_TEXT, 'Idea.md': 'a spark' });

    vault.write('Idea.md', 'a bigger spark');
    await sync(true);

    expect(news()).toEqual([change('changed', 'Idea.md', 'a bigger spark', null)]);
  });

  it('reports nothing when the first sync since opening is a rebuild', async () => {
    const vault = vaultWithIndex({ [KICKOFF]: KICKOFF_TEXT });
    await syncerOver(vault).sync();
    const reopened = syncerOver(vault);

    await reopened.sync(true);

    expect(reopened.heard).toEqual([]);
  });

  it('still rebuilds an index that cannot say what it held, its notes reported as added', async () => {
    const vault = vaultWithIndex({ [KICKOFF]: KICKOFF_TEXT });
    let broken = true;
    const index = {
      ...vault.index,
      manifest: () =>
        broken
          ? Promise.reject(new Error('database disk image is malformed'))
          : vault.index.manifest(),
      clear: async () => {
        broken = false;
        await vault.index.clear();
      },
    };
    const { sync, news } = syncerOver({ fs: vault.fs, index });

    await sync(true);

    expect(news()).toEqual([change('added', KICKOFF, KICKOFF_TEXT, 'meeting')]);
  });

  it('fails a sync that cannot learn what the index held, rather than call every note new', async () => {
    const vault = vaultWithIndex({ [KICKOFF]: KICKOFF_TEXT });
    await syncerOver(vault).sync();
    let failures = 1;
    const index = {
      ...vault.index,
      manifest: () =>
        failures-- > 0 ? Promise.reject(new Error('index is locked')) : vault.index.manifest(),
    };
    const { sync, heard } = syncerOver({ fs: vault.fs, index });

    await expect(sync()).rejects.toThrow('index is locked');
    await sync();

    expect(heard).toEqual([]);
  });

  it('measures the first sync since opening from the index: a note that came while closed is added', async () => {
    const vault = vaultWithIndex({ 'Idea.md': 'a spark' });
    await syncerOver(vault).sync();

    vault.write(KICKOFF, KICKOFF_TEXT);
    const reopened = syncerOver(vault);
    await reopened.sync();

    expect(reopened.news()).toEqual([change('added', KICKOFF, KICKOFF_TEXT, 'meeting')]);
  });

  it('reports a rename in the app as the old path removed and the new one added', async () => {
    const { vault, sync, news } = await synced({ [KICKOFF]: KICKOFF_TEXT });

    await renameEntry({
      ports: { fs: vault.fs, index: vault.index, editors },
      entry: { path: createVaultPath(KICKOFF), kind: 'file' },
      name: 'Kickoff with Larkspur',
      notePaths: vault.notePaths(),
    });
    await sync();

    expect(news()).toEqual([
      change('added', 'meetings/Kickoff with Larkspur.md', KICKOFF_TEXT, 'meeting'),
      change('removed', KICKOFF, KICKOFF_TEXT, 'meeting'),
    ]);
  });

  it('reports a delete in the app once, though the index let go of it first, and not the notes that named it', async () => {
    const task = '---\ntype: task\nproject: [[Kickoff]]\n---\nFollow up\n';
    const { vault, sync, news } = await synced({ [KICKOFF]: KICKOFF_TEXT, 'tasks/Write.md': task });
    // The task names the meeting, so the delete lets go of it too, to be read again.
    vault.index.query = async (sql) => ({
      columns: ['path'],
      rows: sql.includes('FROM relations') ? [['tasks/Write.md']] : [],
      truncated: false,
    });

    await deleteEntry({
      fs: vault.fs,
      index: vault.index,
      editors,
      entry: { path: createVaultPath(KICKOFF), kind: 'file' },
      notePaths: vault.notePaths(),
    });
    expect(vault.held.has('tasks/Write.md')).toBe(false);
    await sync();

    expect(vault.held.has('tasks/Write.md')).toBe(true);
    expect(news()).toEqual([change('removed', KICKOFF, KICKOFF_TEXT, 'meeting')]);
  });

  it('reports a change once when two syncs are asked for at the same time', async () => {
    const { vault, sync, news } = await synced({ [KICKOFF]: KICKOFF_TEXT });

    vault.write('Idea.md', 'a spark');
    await Promise.all([sync(), sync()]);

    expect(news()).toEqual([change('added', 'Idea.md', 'a spark', null)]);
  });

  it('keeps a change found by a sync that failed for the next one to report', async () => {
    const vault = vaultWithIndex({ [KICKOFF]: KICKOFF_TEXT });
    let failing = false;
    const index = {
      ...vault.index,
      put: async (notes: Parameters<IndexPort['put']>[0]) => {
        await vault.index.put(notes);
        if (failing) throw new Error('disk full');
      },
    };
    const { sync, news } = syncerOver({ fs: vault.fs, index });
    await sync();
    news();

    vault.write('Idea.md', 'a spark');
    failing = true;
    await expect(sync()).rejects.toThrow('disk full');
    failing = false;
    await sync();

    expect(news()).toEqual([change('added', 'Idea.md', 'a spark', null)]);
  });

  it('does not measure one vault from what another held', async () => {
    const larkspur = vaultWithIndex({ [KICKOFF]: KICKOFF_TEXT });
    const fenn = vaultWithIndex({ 'Plan.md': 'the plan' });
    await syncerOver(fenn).sync();
    // The host's ports answer for whichever vault is open, as the app's do.
    let open = larkspur;
    const fs = fakeVaultFs({
      listNotes: (options) => open.fs.listNotes(options),
      readNotes: (paths) => open.fs.readNotes(paths),
    });
    const index = fakeIndexPort({
      manifest: () => open.index.manifest(),
      put: (notes) => open.index.put(notes),
      remove: (paths) => open.index.remove(paths),
      stats: () => open.index.stats(),
    });
    const { sync, news } = syncerOver({ fs, index });
    await sync(false, LARKSPUR);
    news();

    open = fenn;
    await sync(false, '/vaults/Fenn');

    // Fenn's own index already holds its note, and Larkspur's meeting did not go anywhere.
    expect(news()).toEqual([]);
  });

  it('says which vault the changes happened in', async () => {
    const { vault, sync, heard } = await synced();

    vault.write(KICKOFF, KICKOFF_TEXT);
    await sync();

    expect(heard.map((news) => news.vault)).toEqual([LARKSPUR]);
  });
});
