import { describe, expect, it } from 'vitest';
import { lineNoteBlocks } from '@dfai/domain/testing';
import {
  kindleHighlightKey,
  literatureNoteText,
  MAX_NAME_BYTES,
  readHighlights,
  type KindleBook,
  type KindleHighlight,
  type VaultPath,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import { guardedVault } from '../testing/guarded-vault.ts';
import { literatureNoteKindleSink } from './literature-note-sink.ts';

/*
 * Regressions found reviewing PR #514 (#508): which note a Kindle book's highlights land in,
 * and the name a new one gets. Books and people are fictional.
 */

const markdown: Pick<MarkdownPort, 'frontmatterProperties' | 'noteBlocks'> = {
  frontmatterProperties: (frontmatter) =>
    Object.fromEntries(
      (frontmatter ?? '')
        .split('\n')
        .map((line) => /^([a-z_]+):\s*(.*)$/.exec(line))
        .flatMap((match) => (match === null ? [] : [[match[1], valueOf(match[2] ?? '')]])),
    ),
  noteBlocks: lineNoteBlocks,
};

function valueOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // A bare YAML word: kept as written.
    return text;
  }
}

function highlightOf(book: KindleBook): KindleHighlight {
  return {
    key: kindleHighlightKey({ asin: book.asin, annotationId: 'Q1', location: 40, words: 'x' }),
    asin: book.asin,
    annotationId: 'Q1',
    style: 'highlight',
    colour: 'blue',
    quote: 'The harbour lights came on one by one.',
    note: null,
    location: 40,
    page: null,
    commentOn: null,
  };
}

/** A disk that refuses a name longer than APFS takes, as the host's create would. */
function setUp(entries: Record<string, string> = {}, indexed: string[] = []) {
  const vault = guardedVault(entries);
  const created: string[] = [];
  const fs = {
    ...vault.fs,
    createNote: async ({ path, contents }: { path: VaultPath; contents: string }) => {
      if (vault.files.has(path)) throw new Error(`${path} already exists`);
      const name = path.split('/').at(-1) ?? '';
      if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) {
        throw new Error('File name too long (os error 63)');
      }
      vault.files.set(path, { text: contents, modified: 1 });
      created.push(path);
      return 1;
    },
  };
  let seed = 5;
  const sink = literatureNoteKindleSink({
    fs,
    markdown,
    index: { notesOfType: async () => indexed.map((path) => ({ path, title: path })) },
    openNotes: { state: () => 'closed', reload: () => {} },
    rng: { next: () => (seed = (seed * 48271) % 2147483647) / 2147483647 },
    clock: { today: () => '2026-10-22' },
  });
  return { vault, sink, created };
}

describe('a new Kindle note is named so it can be made and linked (regression)', () => {
  it('makes the note of a book whose title is longer than a file name may be', async () => {
    const book: KindleBook = {
      asin: 'B0LONGTITL',
      title: `The Complete Lantern Keeper Chronicles: ${'An Annotated Illustrated Omnibus Edition '.repeat(7)}`,
      author: 'Mira Osei',
      coverUrl: null,
    };
    const { sink, created } = setUp();
    await sink.addHighlights({ book, highlights: [highlightOf(book)], syncedAt: 0 });
    expect(created).toHaveLength(1);
  });

  it('makes the note of a book with a CJK title past 255 bytes', async () => {
    const book: KindleBook = {
      asin: 'B0CJKTITLE',
      title: '灯台守の物語'.repeat(15),
      author: 'Mira Osei',
      coverUrl: null,
    };
    const { sink, created } = setUp();
    await sink.addHighlights({ book, highlights: [highlightOf(book)], syncedAt: 0 });
    expect(created).toHaveLength(1);
  });

  it('names the note of a book titled with # so ![[Book#^id]] can reach its highlights', async () => {
    const book: KindleBook = {
      asin: 'B0SHARPBK1',
      title: 'Field Notes in C# and F#',
      author: 'Tobias Fenn',
      coverUrl: null,
    };
    const { sink, created } = setUp();
    await sink.addHighlights({ book, highlights: [highlightOf(book)], syncedAt: 0 });
    expect(created).toHaveLength(1);
    expect(created[0]).not.toMatch(/[#^[\]|]/);
  });
});

describe("which note is the book's (regression)", () => {
  const book: KindleBook = {
    asin: 'B0QUOTEBK1',
    title: 'The Keeper’s Daughter',
    author: 'Mara Quill',
    coverUrl: null,
  };
  const path = 'Library/The Keeper’s Daughter.md';

  it('writes into the person’s own note with a straight apostrophe, not a second copy', async () => {
    const own = 'Library/The Keepers Daughter (mine).md';
    const text = literatureNoteText({
      kind: 'kindle',
      title: "The Keeper's Daughter",
      author: 'Mara Quill',
      asin: null,
      file: null,
    });
    const { vault, sink, created } = setUp({ [own]: text }, [own]);
    await sink.addHighlights({ book, highlights: [highlightOf(book)], syncedAt: 0 });
    expect(created).toEqual([]);
    expect(readHighlights(vault.text(own) ?? '', lineNoteBlocks)).toHaveLength(1);
    expect(vault.text(path)).toBeUndefined();
  });

  it('matches a title Amazon gives with a zero-width space to the note without one', async () => {
    const own = 'Library/Saltwater.md';
    const text = literatureNoteText({
      kind: 'kindle',
      title: 'Saltwater Hymns',
      author: 'Mara Quill',
      asin: null,
      file: null,
    });
    const { sink, created } = setUp({ [own]: text }, [own]);
    const zeroWidth: KindleBook = { ...book, asin: 'B0ZWSPBK01', title: 'Saltwater​ Hymns' };
    await sink.addHighlights({
      book: zeroWidth,
      highlights: [highlightOf(zeroWidth)],
      syncedAt: 0,
    });
    expect(created).toEqual([]);
  });
});
