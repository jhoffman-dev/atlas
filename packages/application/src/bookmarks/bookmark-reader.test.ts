import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath, type WikiLink } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import type { IndexEntry } from '../index/ports.ts';
import { createBookmarkReader, readBookmarks } from './read-bookmark.ts';

/**
 * A note's cards read together, and read again only when the note a card
 * opens has changed (A22-01): a save anywhere in the vault — the note's own
 * autosave above all — must not re-read every card's file.
 */

const markdown: MarkdownPort = {
  ...fakeMarkdown(),
  parseBody: (body) => ({
    blocks: [],
    doc: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: body.trim() }] }],
    },
  }),
};

const link = (target: string, heading: string | null = null): WikiLink => ({
  target,
  heading,
  alias: null,
});
const rome = createVaultPath('Trips/Rome.md');
const oslo = createVaultPath('Trips/Oslo.md');
const plans = createVaultPath('Plans.md');
const notePaths = [rome, oslo, plans];

/** A vault whose files say what `texts` holds, counting every read; the index knows `modified`. */
function vault(modified: Record<string, number>) {
  const texts: Record<string, string> = {
    [rome]: 'Rome body',
    [oslo]: 'Oslo body',
    [plans]: '# Plans',
  };
  const reads: string[][] = [];
  const fs = fakeVaultFs({
    readNotes: async (paths) => {
      reads.push([...paths]);
      return paths.map((path) => ({
        path,
        text: texts[path] ?? '',
        modified: modified[path] ?? 0,
        size: 1,
      }));
    },
  });
  let manifestCalls = 0;
  const index = fakeIndexPort({
    manifest: async () => {
      manifestCalls += 1;
      return Object.entries(modified).map(([path, time]): IndexEntry => ({
        path,
        modified: time,
        size: 1,
        digest: '',
        type: null,
      }));
    },
  });
  return { fs, index, reads, texts, manifestCalls: () => manifestCalls };
}

const summaries = (cards: readonly { kind: string; summary?: string }[]) =>
  cards.map((card) => (card.kind === 'note' ? card.summary : card.kind));

describe('readBookmarks', () => {
  it('reads every note the cards open in one go, each once', async () => {
    const { fs, reads } = vault({ [rome]: 1, [oslo]: 1 });
    const cards = await readBookmarks({
      fs,
      markdown,
      links: [link('Rome'), link('Oslo'), link('Paris'), link('Rome')],
      holder: plans,
      notePaths,
      typeOf: () => undefined,
    });
    expect(reads).toEqual([[rome, oslo]]);
    expect(summaries(cards)).toEqual(['Rome body', 'Oslo body', 'missing', 'Rome body']);
  });

  it('reads a link to a heading in the same note as a card of that note', async () => {
    const { fs } = vault({});
    const [card] = await readBookmarks({
      fs,
      markdown,
      links: [link('', '#Plans')],
      holder: plans,
      notePaths,
      typeOf: () => undefined,
    });
    expect(card).toMatchObject({ kind: 'note', path: plans });
  });

  it('reads nothing when there is no card', async () => {
    const { fs, reads } = vault({});
    const cards = await readBookmarks({
      fs,
      markdown,
      links: [link('Paris')],
      holder: plans,
      notePaths,
      typeOf: () => undefined,
    });
    expect(reads).toEqual([]);
    expect(cards).toEqual([{ kind: 'missing', label: 'Paris' }]);
  });
});

describe('a bookmark reader', () => {
  const read = (reader: ReturnType<typeof createBookmarkReader>, links: readonly WikiLink[]) =>
    reader.read({ links, holder: plans, notePaths, typeOf: () => undefined });

  it('reads a card again only when the index says its note has changed', async () => {
    const modified: Record<VaultPath, number> = { [rome]: 1, [oslo]: 1, [plans]: 1 };
    const files = vault(modified);
    const reader = createBookmarkReader({ fs: files.fs, markdown, index: files.index });
    const first = await read(reader, [link('Rome'), link('Oslo')]);
    expect(files.reads).toEqual([[rome, oslo]]);

    // The note the cards are in was saved: nothing they open changed.
    modified[plans] = 2;
    const second = await read(reader, [link('Rome'), link('Oslo')]);
    expect(files.reads).toHaveLength(1);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);

    // Rome was saved: only its card is read again, and shows what it says now.
    modified[rome] = 3;
    files.texts[rome] = 'Rome, rewritten';
    const third = await read(reader, [link('Rome'), link('Oslo')]);
    expect(files.reads).toEqual([[rome, oslo], [rome]]);
    expect(summaries(third)).toEqual(['Rome, rewritten', 'Oslo body']);
    expect(third[1]).toBe(first[1]);
    expect(files.manifestCalls()).toBe(3);
  });

  it('reads from the file a note the index does not know yet', async () => {
    const files = vault({ [rome]: 1 });
    const reader = createBookmarkReader({ fs: files.fs, markdown, index: files.index });
    await read(reader, [link('Oslo')]);
    await read(reader, [link('Oslo')]);
    expect(files.reads).toEqual([[oslo], [oslo]]);
  });

  it('reads every card from its file while the index cannot be asked', async () => {
    const files = vault({ [rome]: 1 });
    const index = fakeIndexPort({
      manifest: () => Promise.reject(new Error('index is building')),
    });
    const reader = createBookmarkReader({ fs: files.fs, markdown, index });
    const cards = await read(reader, [link('Rome')]);
    expect(summaries(cards)).toEqual(['Rome body']);
    await read(reader, [link('Rome')]);
    expect(files.reads).toEqual([[rome], [rome]]);
  });

  it('asks the index nothing when no card opens a note', async () => {
    const files = vault({});
    const reader = createBookmarkReader({ fs: files.fs, markdown, index: files.index });
    expect(await read(reader, [link('Paris')])).toEqual([{ kind: 'missing', label: 'Paris' }]);
    expect(files.manifestCalls()).toBe(0);
  });
});
