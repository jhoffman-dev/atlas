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
function setUp(
  entries: Record<string, string> = {},
  indexed: string[] = [],
  options: { beforeCreate?: (path: VaultPath, files: Map<string, unknown>) => void } = {},
) {
  const vault = guardedVault(entries);
  const created: string[] = [];
  const read: string[] = [];
  const fs = {
    ...vault.fs,
    readNotes: async (paths: readonly string[]) => {
      read.push(...paths);
      return vault.fs.readNotes(paths);
    },
    createNote: async ({ path, contents }: { path: VaultPath; contents: string }) => {
      options.beforeCreate?.(path, vault.files);
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
  return { vault, sink, created, read };
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

const roman = (book: KindleBook): KindleHighlight => ({
  ...highlightOf(book),
  key: kindleHighlightKey({ asin: book.asin, annotationId: 'Q9', location: null, words: 'y' }),
  annotationId: 'Q9',
  location: null,
  page: 'xiv',
});

describe('what the sink says it wrote (regression)', () => {
  const book: KindleBook = {
    asin: 'B0WRITTEN1',
    title: 'The Harbour Lights',
    author: 'Mira Osei',
    coverUrl: null,
  };

  it('counts the entries a new note took, and names the highlight it could not place', async () => {
    const { vault, sink } = setUp();
    const written = await sink.addHighlights({
      book,
      highlights: [highlightOf(book), roman(book)],
      syncedAt: 0,
    });
    expect(written).toEqual({ written: 1, unplaced: ['page xiv'] });
    expect(
      readHighlights(vault.text('Library/The Harbour Lights.md') ?? '', lineNoteBlocks),
    ).toHaveLength(1);
  });

  it('counts only what changed an existing note, and nothing when it held the lot', async () => {
    const { sink } = setUp();
    const given = { book, highlights: [highlightOf(book)], syncedAt: 0 };
    expect(await sink.addHighlights(given)).toEqual({ written: 1, unplaced: [] });
    expect(await sink.addHighlights(given)).toEqual({ written: 0, unplaced: [] });
  });

  it('makes no note for a book none of whose highlights can be placed, and writes it when one can', async () => {
    const { sink, created } = setUp();
    const written = await sink.addHighlights({ book, highlights: [roman(book)], syncedAt: 0 });
    expect(written).toEqual({ written: 0, unplaced: ['page xiv'] });
    expect(created).toEqual([]);
  });

  it('writes nothing to a note that holds the placed ones, for the one it could not place', async () => {
    const { vault, sink } = setUp();
    await sink.addHighlights({ book, highlights: [highlightOf(book)], syncedAt: 0 });
    const path = 'Library/The Harbour Lights.md';
    const before = vault.text(path);
    const writes = vault.writes.length;
    const written = await sink.addHighlights({
      book,
      highlights: [roman(book)],
      syncedAt: 1,
    });
    expect(written).toEqual({ written: 0, unplaced: ['page xiv'] });
    expect(vault.text(path)).toBe(before);
    expect(vault.writes).toHaveLength(writes);
  });
});

describe('looking through the vault once for a whole sync (regression)', () => {
  const notes = Object.fromEntries(
    Array.from({ length: 12 }, (_, at) => [
      `Library/Other ${at}.md`,
      literatureNoteText({
        kind: 'kindle',
        title: `Other ${at}`,
        author: 'Tobias Fenn',
        asin: `B0OTHER${String(at).padStart(3, '0')}`,
        file: null,
      }),
    ]),
  );
  const books: KindleBook[] = ['B0NEWBOOK1', 'B0NEWBOOK2', 'B0NEWBOOK3', 'B0NEWBOOK4'].map(
    (asin, at) => ({ asin, title: `New ${at}`, author: 'Mira Osei', coverUrl: null }),
  );

  async function syncAll(sink: ReturnType<typeof setUp>['sink']) {
    sink.beginSync?.();
    for (const book of books) {
      await sink.recordedKeys(book);
      await sink.addHighlights({ book, highlights: [highlightOf(book)], syncedAt: 0 });
    }
  }

  it('reads each note of the vault once for all the books, those with no note included', async () => {
    const { sink, read, created } = setUp(notes, Object.keys(notes));
    await syncAll(sink);
    expect(created).toHaveLength(4);
    expect(read.filter((path) => path.startsWith('Library/Other '))).toHaveLength(12);
  });

  it('looks again at the next sync: a note made in between is found, not made twice', async () => {
    const indexed = Object.keys(notes);
    const { vault, sink, created } = setUp(notes, indexed);
    await syncAll(sink);
    indexed.push('Reading/Mine.md');
    const [first] = books;
    vault.files.set('Reading/Mine.md', {
      text: literatureNoteText({
        kind: 'kindle',
        title: 'Mine',
        author: 'Mira Osei',
        asin: 'B0LATEBOOK',
        file: null,
      }),
      modified: 1,
    });
    const late: KindleBook = { ...(first as KindleBook), asin: 'B0LATEBOOK', title: 'Late' };
    sink.beginSync?.();
    await sink.addHighlights({ book: late, highlights: [highlightOf(late)], syncedAt: 1 });
    expect(created).toHaveLength(4);
  });
});

describe('a name taken between the listing and the create (regression)', () => {
  const book: KindleBook = {
    asin: 'B0RACEBOOK1',
    title: 'The Harbour Lights',
    author: 'Mira Osei',
    coverUrl: null,
  };

  it('names the note again past the name another write took meanwhile', async () => {
    let raced = false;
    const { vault, sink, created } = setUp({}, [], {
      beforeCreate: (path, files) => {
        if (raced) return;
        raced = true;
        files.set(path, { text: 'Someone else got there first.\n', modified: 1 });
      },
    });
    await sink.addHighlights({ book, highlights: [highlightOf(book)], syncedAt: 0 });
    expect(vault.text('Library/The Harbour Lights.md')).toBe('Someone else got there first.\n');
    expect(created).toEqual(['Library/The Harbour Lights 2.md']);
  });

  it('gives up with the disk’s refusal after three names taken, writing over none', async () => {
    const { vault, sink } = setUp({}, [], {
      beforeCreate: (path, files) => files.set(path, { text: 'Taken.\n', modified: 1 }),
    });
    await expect(
      sink.addHighlights({ book, highlights: [highlightOf(book)], syncedAt: 0 }),
    ).rejects.toThrow(/already exists/);
    expect([...vault.files.values()].every((file) => file.text === 'Taken.\n')).toBe(true);
  });
});
