import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  type EditorDocument,
  type EditorNode,
  type VaultPath,
  type WikiLink,
} from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { IndexEntry } from '../index/ports.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import {
  anchorBlock,
  BlockMovedError,
  createBlockChoicesReader,
  type BlockLinkPanes,
} from './link-block.ts';
import { createTransclusionReader } from './read-transclusions.ts';

/*
 * Showing a block of one note in another (P26-02, P26-03): offering a note's
 * blocks, giving the one picked an id — a write to that note — and reading
 * the blocks an embed shows, again only when their note changed.
 */

/** A markdown port that reads each line as a paragraph, and an id at its end as the block's. */
const markdown: MarkdownPort = {
  ...fakeMarkdown(),
  parseBody: (body) => ({ blocks: [], doc: docOf(body) }),
  serializeBody: ({ doc }) =>
    `${doc.content
      .map((node) => {
        const text = (node.content ?? []).map((child) => child.text ?? '').join('');
        const id = node.attrs?.['anchor'];
        return typeof id === 'string' ? `${text} ^${id}` : text;
      })
      .join('\n')}\n`,
};

function docOf(body: string): EditorDocument {
  const content = body
    .split('\n')
    .filter((line) => line !== '')
    .map((line): EditorNode => {
      const found = /^(.*) \^([a-z0-9]+)$/.exec(line);
      const text = found?.[1] ?? line;
      return {
        type: 'paragraph',
        ...(found !== null && { attrs: { anchor: found[2] } }),
        content: [{ type: 'text', text }],
      };
    });
  return { type: 'doc', content };
}

const plans = createVaultPath('Plans.md');
const today = createVaultPath('Journal/Today.md');
const notePaths = [plans, today];

/** A vault of `files`, keeping what is written and counting every read. */
function vault(files: Record<string, string>, modified: Record<string, number> = {}) {
  const written: { path: string; contents: string; expectedModified: number | null }[] = [];
  const reads: string[][] = [];
  const fs = fakeVaultFs({
    readTextFile: async (path) => ({ text: files[path] ?? '', modified: modified[path] ?? 1 }),
    readNotes: async (paths) => {
      reads.push([...paths]);
      return paths
        .filter((path) => files[path] !== undefined)
        .map((path) => ({ path, text: files[path]!, modified: modified[path] ?? 1, size: 1 }));
    },
    writeTextFile: async (args) => {
      written.push(args);
      files[args.path] = args.contents;
      return 2;
    },
  });
  return { fs, written, reads };
}

/** Panes holding `states`, recording each note they are asked to read again. */
function panes(states: Record<string, 'clean' | 'dirty'> = {}) {
  const reloaded: string[] = [];
  const open: BlockLinkPanes = {
    state: (path) => states[path] ?? 'closed',
    reload: (path) => reloaded.push(path),
  };
  return { open, reloaded };
}

/** Always the same draw, so the id given is known. */
const rng = { next: () => 0 };

describe('createBlockChoicesReader', () => {
  it('offers the note’s blocks, with the ids they already have', async () => {
    const { fs } = vault({
      [plans]: '---\ntitle: Plans\n---\nPack the tent ^t1\nBook the train\n',
    });
    const choices = createBlockChoicesReader({ fs, markdown, index: fakeIndexPort() });
    expect(await choices.read(plans)).toEqual([
      { kind: 'block', text: 'Pack the tent', id: 't1', type: 'paragraph', at: [0] },
      { kind: 'block', text: 'Book the train', id: null, type: 'paragraph', at: [1] },
    ]);
  });
});

describe('anchorBlock', () => {
  it('gives a block with no id one, writing the id and nothing else, against the file read', async () => {
    const { fs, written } = vault(
      { [plans]: '---\ntitle: Plans\n---\nPack the tent\nBook the train\n' },
      { [plans]: 5 },
    );
    const { open } = panes();
    const id = await anchorBlock({
      fs,
      markdown,
      openNotes: open,
      rng,
      path: plans,
      at: [1],
      text: 'Book the train',
    });
    expect(id).toBe('aaaaaa');
    expect(written).toEqual([
      {
        path: plans,
        contents: '---\ntitle: Plans\n---\nPack the tent\nBook the train ^aaaaaa\n',
        expectedModified: 5,
      },
    ]);
  });

  it('gives back the id a block has, and writes nothing', async () => {
    const { fs, written } = vault({ [plans]: 'Pack the tent ^t1\n' });
    const id = await anchorBlock({
      fs,
      markdown,
      openNotes: panes().open,
      rng,
      path: plans,
      at: [0],
      text: 'Pack the tent',
    });
    expect(id).toBe('t1');
    expect(written).toEqual([]);
  });

  it('never gives an id the note already has', async () => {
    const { fs } = vault({ [plans]: 'First ^aaaaaa\nSecond\n' });
    let draws = 0;
    const counting = { next: () => (draws++ < 6 ? 0 : 0.5) };
    const id = await anchorBlock({
      fs,
      markdown,
      openNotes: panes().open,
      rng: counting,
      path: plans,
      at: [1],
      text: 'Second',
    });
    expect(id).not.toBe('aaaaaa');
    expect(id).toMatch(/^[a-z0-9]{6}$/);
  });

  it('refuses to write a note a pane holds unsaved typing in', async () => {
    const { fs, written } = vault({ [plans]: 'Pack the tent\n' });
    const { open } = panes({ [plans]: 'dirty' });
    await expect(
      anchorBlock({
        fs,
        markdown,
        openNotes: open,
        rng,
        path: plans,
        at: [0],
        text: 'Pack the tent',
      }),
    ).rejects.toBeInstanceOf(UnsavedTypingError);
    expect(written).toEqual([]);
  });

  it('has a pane that holds the note with nothing unsaved read it again', async () => {
    const { fs } = vault({ [plans]: 'Pack the tent\n' });
    const { open, reloaded } = panes({ [plans]: 'clean' });
    await anchorBlock({
      fs,
      markdown,
      openNotes: open,
      rng,
      path: plans,
      at: [0],
      text: 'Pack the tent',
    });
    expect(reloaded).toEqual([plans]);
  });

  it('says a chat note moved its blocks without naming it, since its name is the question', () => {
    const chat = createVaultPath('Chats/Should Mara Quill get a raise.md');
    expect(new BlockMovedError(chat).message).toBe(
      'a chat note changed while its blocks were being offered. Pick the block again.',
    );
    expect(new BlockMovedError(plans).message).toMatch(/^Plans changed while/);
  });

  it('refuses when the block is no longer what was offered, or no longer there', async () => {
    const { fs, written } = vault({ [plans]: 'Something new\n' });
    const ask = (at: number[], text: string) =>
      anchorBlock({ fs, markdown, openNotes: panes().open, rng, path: plans, at, text });
    await expect(ask([0], 'Pack the tent')).rejects.toBeInstanceOf(BlockMovedError);
    await expect(ask([3], 'Something new')).rejects.toBeInstanceOf(BlockMovedError);
    expect(written).toEqual([]);
  });
});

describe('createTransclusionReader', () => {
  const link = (target: string, heading: string): WikiLink => ({ target, heading, alias: null });

  function reader(files: Record<string, string>, modified: Record<string, number>) {
    const { fs, reads } = vault(files, modified);
    const index = fakeIndexPort({
      manifest: async () =>
        Object.entries(modified).map(([path, time]): IndexEntry => ({
          path,
          modified: time,
          size: 1,
          digest: '',
          type: null,
        })),
    });
    return { read: createTransclusionReader({ fs, markdown, index }), reads };
  }

  it('shows the block each link names, in the order asked', async () => {
    const { read } = reader({ [plans]: 'Pack the tent ^t1\nBook the train ^t2\n' }, { [plans]: 1 });
    const shown = await read.read({
      links: [link('Plans', '#^t2'), link('Plans', '#^t1')],
      holder: today,
      notePaths,
    });
    expect(
      shown.map((one) => (one.kind === 'block' ? one.content.content[0]?.attrs : one.kind)),
    ).toEqual([{ anchor: 't2' }, { anchor: 't1' }]);
  });

  it('says a missing note, and a missing block, apart', async () => {
    const { read } = reader({ [plans]: 'Pack the tent ^t1\n' }, { [plans]: 1 });
    const shown = await read.read({
      links: [link('Nowhere', '#^t1'), link('Plans', '#^gone')],
      holder: today,
      notePaths,
    });
    expect(shown.map((one) => one.kind)).toEqual(['missing-note', 'missing-block']);
  });

  it('reads a block of the note it is in, for `![[#^id]]`', async () => {
    const { read } = reader({ [today]: 'Mine ^m1\n' }, { [today]: 1 });
    const [shown] = await read.read({ links: [link('', '#^m1')], holder: today, notePaths });
    expect(shown?.kind).toBe('block');
  });

  it('reads a note once for all its blocks, and again only when its file changed', async () => {
    const files = { [plans]: 'Pack the tent ^t1\nBook the train ^t2\n' };
    const modified = { [plans]: 1 };
    const { read, reads } = reader(files, modified);
    const links = [link('Plans', '#^t1'), link('Plans', '#^t2')];
    await read.read({ links, holder: today, notePaths });
    await read.read({ links, holder: today, notePaths });
    expect(reads).toEqual([[plans]]);

    files[plans] = 'Pack the tent, twice ^t1\n';
    modified[plans] = 2;
    const [again] = await read.read({ links, holder: today, notePaths });
    expect(reads).toEqual([[plans], [plans]]);
    expect(again?.kind === 'block' ? again.content.content[0]?.content?.[0]?.text : null).toBe(
      'Pack the tent, twice',
    );
  });

  it('reads a note the index does not know yet from its file, every time', async () => {
    const { read, reads } = reader({ [plans]: 'Pack ^t1\n' }, {});
    const links = [link('Plans', '#^t1')];
    const [first] = await read.read({ links, holder: today, notePaths });
    await read.read({ links, holder: today, notePaths });
    expect(first?.kind).toBe('block');
    expect(reads).toEqual([[plans], [plans]]);
  });

  it('shows a note that can no longer be read as missing', async () => {
    const files: Record<string, string> = { [plans]: 'Pack ^t1\n' };
    const modified = { [plans]: 1 };
    const { read } = reader(files, modified);
    await read.read({ links: [link('Plans', '#^t1')], holder: today, notePaths });
    delete files[plans];
    modified[plans] = 2;
    const [gone] = await read.read({ links: [link('Plans', '#^t1')], holder: today, notePaths });
    expect(gone?.kind).toBe('missing-note');
  });

  it('reads nothing, and asks the index nothing, for no links', async () => {
    const { read, reads } = reader({}, {});
    expect(await read.read({ links: [], holder: today, notePaths: [] as VaultPath[] })).toEqual([]);
    expect(reads).toEqual([]);
  });
});
