import { describe, expect, it } from 'vitest';
import { createVaultPath, digestOf, type NoteChange } from '@atlas/domain';
import { recordingActivity } from '../testing/fake-activity.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { createNoteChanges, type NoteChangeNews } from './note-changes.ts';
import type { IndexEntry, IndexPort } from './ports.ts';
import { createIndexSyncer } from './sync-index.ts';

/**
 * Adversarial pass on the index change feed (P28-03): failures, vault switches
 * and unreadable notes the card's own tests do not reach.
 */

const LARKSPUR = '/vaults/Larkspur';
const FENN = '/vaults/Fenn';
const KICKOFF = 'meetings/Kickoff.md';
const KICKOFF_TEXT = '---\ntype: meeting\n---\nAgenda with Mara Quill.\n';

/** A vault in memory whose index keeps what it is handed, as the host's does. */
function vaultWithIndex(notes: Record<string, string> = {}) {
  const files = new Map<string, { text: string; modified: number }>();
  const unreadable = new Set<string>();
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
    // As the host's read_notes: a file it cannot read is skipped, not fatal.
    readNotes: async (paths) =>
      paths.flatMap((path) => {
        const file = files.get(path);
        return file === undefined || unreadable.has(path)
          ? []
          : [{ path, ...file, size: file.text.length }];
      }),
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
    write,
    erase: (path: string) => void files.delete(path),
    /** The file is there but cannot be read just now: a cloud placeholder, a write under way. */
    unreadable: (path: string) => void unreadable.add(path),
  };
}

function syncerOver(
  { fs, index }: Pick<ReturnType<typeof vaultWithIndex>, 'fs' | 'index'>,
  /** The vault open now; unless a test says otherwise, the one last synced. */
  openVault?: () => string | null,
) {
  let asked: string | null = null;
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
    openVault: openVault ?? (() => asked),
  });
  return {
    heard,
    sync: (fromScratch = false, at = LARKSPUR) => {
      asked = at;
      return syncer.sync({ vault: at, fromScratch });
    },
    news: () => heard.splice(0).flatMap((each) => each.changes),
  };
}

const change = (kind: NoteChange['kind'], path: string, text: string, type: string | null) => ({
  kind,
  path,
  type,
  digest: digestOf(text),
});

describe('the index change feed under attack (P28-03)', () => {
  it('reports what the first sync since opening found, when that sync failed part way', async () => {
    // Last session left Kickoff in the index; while the app was closed it went and Idea came.
    const vault = vaultWithIndex({ [KICKOFF]: KICKOFF_TEXT });
    await syncerOver(vault).sync();
    vault.erase(KICKOFF);
    vault.write('Idea.md', 'a spark');

    let failing = true;
    const index: IndexPort = {
      ...vault.index,
      put: async (notes) => {
        await vault.index.put(notes);
        if (failing) throw new Error('disk full');
      },
    };
    const { sync, news } = syncerOver({ fs: vault.fs, index });
    await expect(sync()).rejects.toThrow('disk full');
    failing = false;
    await sync();

    expect(news()).toEqual([
      change('added', 'Idea.md', 'a spark', null),
      change('removed', KICKOFF, KICKOFF_TEXT, 'meeting'),
    ]);
  });

  it("never reports another vault's notes under the name of the vault a sync was asked for", async () => {
    const larkspur = vaultWithIndex({ [KICKOFF]: KICKOFF_TEXT });
    const fenn = vaultWithIndex({ 'Plan.md': 'the plan' });
    await syncerOver(fenn).sync(false, FENN);
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
    const { sync, heard } = syncerOver({ fs, index }, () => (open === fenn ? FENN : LARKSPUR));
    await sync(false, LARKSPUR);
    heard.splice(0);

    // Fenn is opened; a refresh Larkspur asked for (a pull finishing, a save's
    // follow-up) still runs on the syncer it was asked of.
    open = fenn;
    await sync(false, LARKSPUR);

    const toldOfLarkspur = heard.filter((news) => news.vault === LARKSPUR);
    expect(toldOfLarkspur.flatMap((news) => news.changes)).toEqual([]);
  });

  it('does not report a note still in the vault as removed because a rebuild could not read it', async () => {
    const { vault, sync, news } = await (async () => {
      const made = vaultWithIndex({ [KICKOFF]: KICKOFF_TEXT, 'Idea.md': 'a spark' });
      const syncer = syncerOver(made);
      await syncer.sync();
      syncer.news();
      return { vault: made, ...syncer };
    })();

    vault.unreadable(KICKOFF);
    await sync(true);

    expect(news()).toEqual([]);
  });
});
