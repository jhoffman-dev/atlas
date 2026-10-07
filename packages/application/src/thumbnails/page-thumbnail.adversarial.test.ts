/**
 * Attacks on picturing a note's page (U-15).
 *
 * The module claims a cached picture is "made again whenever the note is
 * newer than it", and that a renamed note's old picture "is simply never
 * read again". Each test here tries to leave a card showing a picture that
 * is not of the note it fronts, as the host really dates files: a write
 * stamps the host's clock, and a move keeps the file's own time.
 */

import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  pageThumbnailPath,
  pageThumbnailStale,
  type EditorDocument,
  type VaultEntry,
  type VaultPath,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { OpenEditorsPort, VaultFsPort } from '../vault/ports.ts';
import { deleteEntry } from '../vault/delete-entry.ts';
import { renameEntry } from '../vault/relocate-entry.ts';
import { generatePageThumbnail, picturedPages } from './page-thumbnail.ts';
import type { NotePageRenderer } from './ports.ts';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const DUNE = createVaultPath('Books/Dune.md');
const EMMA = createVaultPath('Books/Emma.md');

const EMPTY: EditorDocument = { type: 'doc', content: [] };
const markdown: MarkdownPort = { ...fakeMarkdown(), parseBody: () => ({ doc: EMPTY, blocks: [] }) };
const renderer: NotePageRenderer = { bodyHtml: () => '', styles: '' };

const editors: OpenEditorsPort = {
  state: () => 'closed',
  flush: async () => {},
  follow: () => {},
  abandon: () => {},
};

/**
 * A vault on a disk with a clock: every write is dated by it, and a move
 * keeps the file's time — as `rename(2)`, and so the host's `moveEntry`, does.
 */
function datedVault(notes: Record<string, string>) {
  let clock = 1_000;
  const texts = new Map<string, { text: string; modified: number }>();
  const binaries = new Map<string, { bytes: Uint8Array; modified: number }>();
  for (const [path, text] of Object.entries(notes)) texts.set(path, { text, modified: clock++ });
  const tick = () => (clock += 1_000);

  const fs: VaultFsPort = fakeVaultFs({
    readTextFile: async (path) => {
      const note = texts.get(path);
      if (note === undefined) throw new Error(`no such note: ${path}`);
      return note;
    },
    writeTextFile: async ({ path, contents }) => {
      const modified = tick();
      texts.set(path, { text: contents, modified });
      return modified;
    },
    writeBinaryFile: async ({ path, bytes }) => {
      binaries.set(path, { bytes, modified: tick() });
      return bytes.byteLength;
    },
    listDirectory: async (folder) => {
      const prefix = `${folder}/`;
      const entries: VaultEntry[] = [];
      for (const [path, { modified }] of [...texts, ...binaries]) {
        if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
        const name = path.slice(prefix.length);
        entries.push({ kind: 'file', name, path: createVaultPath(path), modified });
      }
      return entries;
    },
    moveEntry: async ({ from, to }) => {
      const note = texts.get(from);
      if (note === undefined) throw new Error(`no such note: ${from}`);
      if (texts.has(to)) throw new Error(`${to} is taken`);
      texts.delete(from);
      texts.set(to, note);
    },
    trashEntry: async ({ path }) => {
      texts.delete(path);
    },
  });

  const noteModified = (path: VaultPath) => texts.get(path)?.modified ?? Number.NaN;
  const save = (path: VaultPath, text: string) =>
    fs.writeTextFile({ path, contents: text, expectedModified: null });
  return { fs, noteModified, save };
}

function picture(fs: VaultFsPort, notePath: VaultPath, capture = async () => PNG) {
  return generatePageThumbnail({
    deps: { fs, markdown, snapshot: { capture }, renderer },
    notePath,
    thumbnailKey: 'art',
    asked: false,
    setProperties: async () => {},
  });
}

/** Whether the card of the note at `path` would ask for its page to be pictured again. */
async function wantsPictureAgain(
  fs: VaultFsPort,
  noteModified: (path: VaultPath) => number,
  path: VaultPath,
): Promise<boolean> {
  const pictured = await picturedPages(fs);
  return pageThumbnailStale({
    noteModified: noteModified(path),
    picturedAt: pictured.get(pageThumbnailPath(path)) ?? null,
  });
}

describe('a picture of a page is of the note it fronts', () => {
  it('a note saved while its page is being pictured is pictured again', async () => {
    const { fs, noteModified, save } = datedVault({
      [DUNE]: '---\ntype: book\n---\nfirst draft\n',
    });
    // Snapshotting loads a web page in a process of its own: seconds, in which
    // a pane's autosave or a sync can land.
    await picture(fs, DUNE, async () => {
      await save(DUNE, '---\ntype: book\n---\nsecond draft\n');
      return PNG;
    });

    // The picture is of "first draft"; the note says "second draft". Its
    // card must not take the picture as fresh just because it was written last.
    expect(await wantsPictureAgain(fs, noteModified, DUNE)).toBe(true);
  });

  it('a note moved onto the path of a deleted one is not fronted by the deleted one’s picture', async () => {
    const { fs, noteModified } = datedVault({
      // Emma is older than any picture made below.
      [EMMA]: '---\ntype: book\n---\nEmma\n',
      [DUNE]: '---\ntype: book\n---\nDune\n',
    });
    await picture(fs, DUNE);
    const notePaths = [DUNE, EMMA];
    const index = fakeIndexPort();

    await deleteEntry({ fs, index, editors, entry: { path: DUNE, kind: 'file' }, notePaths });
    await renameEntry({
      ports: { fs, index, editors },
      entry: { path: EMMA, kind: 'file' },
      name: 'Dune',
      notePaths: [EMMA],
    });
    expect((await fs.readTextFile(DUNE)).text).toContain('Emma');

    // Books/Dune.md is now Emma, whose file keeps its older time across the
    // rename: the cached picture of the deleted Dune reads as fresh for her.
    expect(await wantsPictureAgain(fs, noteModified, DUNE)).toBe(true);
  });
});
