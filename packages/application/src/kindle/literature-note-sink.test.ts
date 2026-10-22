import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lineNoteBlocks } from '@dfai/domain/testing';
import {
  kindleHighlightKey,
  kindleNoteKey,
  literatureNoteText,
  readHighlights,
  type KindleBook,
  type KindleHighlight,
  type VaultPath,
} from '@dfai/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import {
  fakeKindleDelay,
  fakeKindleNotebook,
  heldKindleDelay,
  kindlePage,
} from '../testing/fake-kindle.ts';
import { guardedVault } from '../testing/guarded-vault.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { literatureNoteKindleSink } from './literature-note-sink.ts';
import { createKindleSync } from './sync-kindle.ts';

/*
 * The sink over an in-memory vault guarded as the host guards writes, the
 * notes' blocks read as DFAI writes them (`lineNoteBlocks`). The books are
 * public domain; the highlights are the domain's hand-made fixtures.
 */

const BOOK: KindleBook = {
  asin: 'B0EXAMPLE1',
  title: 'Pride and Prejudice',
  author: 'Jane Austen',
  coverUrl: null,
};

/** Frontmatter of `key: value` lines, a value read as JSON when it is JSON. */
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

const VANITY: KindleHighlight = {
  key: kindleHighlightKey({ asin: BOOK.asin, annotationId: 'A1', location: 12, words: 'Vanity.' }),
  asin: BOOK.asin,
  annotationId: 'A1',
  style: 'highlight',
  colour: 'yellow',
  quote: 'Vanity and pride are different things.',
  note: null,
  location: 12,
  page: null,
  commentOn: null,
};

const typedOn = (on: KindleHighlight, note: string): KindleHighlight => ({
  ...on,
  key: kindleNoteKey(on.key, note),
  style: 'note',
  colour: null,
  quote: '',
  note,
  commentOn: on.key,
});

/** The vault, the sink over it, and the literature notes the index knows of. */
function setUp(
  entries: Record<string, string> = {},
  options: { indexed?: string[]; dirty?: ReadonlySet<string> } = {},
) {
  const vault = guardedVault(entries);
  const created: string[] = [];
  const fs = {
    ...vault.fs,
    createNote: async ({ path, contents }: { path: VaultPath; contents: string }) => {
      if (vault.files.has(path)) throw new Error(`${path} already exists`);
      vault.files.set(path, { text: contents, modified: 1 });
      created.push(path);
      return 1;
    },
  };
  let seed = 11;
  const sink = literatureNoteKindleSink({
    fs,
    markdown,
    index: {
      notesOfType: async () => (options.indexed ?? []).map((path) => ({ path, title: path })),
    },
    openNotes: {
      state: (path) => (options.dirty?.has(path) ? 'dirty' : 'closed'),
      reload: () => {},
    },
    rng: { next: () => (seed = (seed * 48271) % 2147483647) / 2147483647 },
    clock: { today: () => '2026-10-22' },
  });
  return { vault, sink, created };
}

const note = (fields: Record<string, string | null>) =>
  literatureNoteText({
    kind: 'kindle',
    title: fields.title ?? BOOK.title,
    author: fields.author === undefined ? BOOK.author : fields.author,
    asin: fields.asin ?? null,
    file: null,
  });

const quotesIn = (text: string | undefined) =>
  readHighlights(text ?? '', lineNoteBlocks).map((block) => block.quote);

describe('literatureNoteKindleSink', () => {
  it("makes the book's note in Library with its highlights, and then knows them", async () => {
    const { vault, sink, created } = setUp();
    expect(await sink.recordedKeys(BOOK)).toEqual(new Set());
    await sink.addHighlights({
      book: BOOK,
      highlights: [VANITY, typedOn(VANITY, 'Mary.')],
      syncedAt: 0,
    });

    expect(created).toEqual(['Library/Pride and Prejudice.md']);
    const text = vault.text('Library/Pride and Prejudice.md') ?? '';
    expect(text).toMatch(/^---\ntype: literature\nkind: kindle\ntitle: "Pride and Prejudice"\n/);
    expect(text).toContain('asin: "B0EXAMPLE1"');
    expect(quotesIn(text)).toEqual(['Vanity and pride are different things.']);
    const keys = await sink.recordedKeys(BOOK);
    expect(keys.has(VANITY.key)).toBe(true);
    expect(keys.has(typedOn(VANITY, 'Mary.').key)).toBe(true);
  });

  it('writes into the note that names the ASIN, wherever it is and whatever it is called', async () => {
    const mine = 'Reading/My copy.md';
    const { vault, sink, created } = setUp(
      { [mine]: note({ title: 'P&P', asin: 'B0EXAMPLE1' }) },
      { indexed: [mine] },
    );
    await sink.addHighlights({ book: BOOK, highlights: [VANITY], syncedAt: 0 });
    expect(created).toEqual([]);
    expect(quotesIn(vault.text(mine))).toEqual([VANITY.quote]);
  });

  it('writes into a note with no ASIN that has the title and author', async () => {
    const path = 'Library/Pride and Prejudice.md';
    const { vault, sink, created } = setUp({ [path]: note({}) });
    await sink.addHighlights({ book: BOOK, highlights: [VANITY], syncedAt: 0 });
    expect(created).toEqual([]);
    expect(quotesIn(vault.text(path))).toEqual([VANITY.quote]);
  });

  it('never takes a note with the title alone, and never writes over the name it holds', async () => {
    const other = note({ author: 'Mara Quill' });
    const path = 'Library/Pride and Prejudice.md';
    const { vault, sink, created } = setUp({ [path]: other });
    await sink.addHighlights({ book: BOOK, highlights: [VANITY], syncedAt: 0 });
    expect(created).toEqual(['Library/Pride and Prejudice 2.md']);
    expect(vault.text(path)).toBe(other);
    expect(quotesIn(vault.text('Library/Pride and Prejudice 2.md'))).toEqual([VANITY.quote]);
  });

  it('names its note past a plain note of the same name, leaving that note as it was', async () => {
    const plain = 'Library/Pride and Prejudice.md';
    const { vault, sink, created } = setUp({ [plain]: 'My own notes on the book.\n' });
    await sink.addHighlights({ book: BOOK, highlights: [VANITY], syncedAt: 0 });
    expect(created).toEqual(['Library/Pride and Prejudice 2.md']);
    expect(vault.text(plain)).toBe('My own notes on the book.\n');
  });

  it('finds the note it made before the index knows of it', async () => {
    const { vault, sink } = setUp();
    await sink.addHighlights({ book: BOOK, highlights: [VANITY], syncedAt: 0 });
    // A second sink, as after a restart: nothing remembered, nothing indexed.
    const { sink: again } = setUp(
      Object.fromEntries([...vault.files].map(([p, f]) => [p, f.text])),
    );
    expect((await again.recordedKeys(BOOK)).has(VANITY.key)).toBe(true);
  });

  it('looks again when the note it found no longer says it is the book', async () => {
    const { vault, sink } = setUp();
    await sink.addHighlights({ book: BOOK, highlights: [VANITY], syncedAt: 0 });
    vault.edit('Library/Pride and Prejudice.md', note({ asin: 'B0OTHER' }));
    expect(await sink.recordedKeys(BOOK)).toEqual(new Set());
  });

  it('adds a note typed later to the comment of the passage synced before', async () => {
    const { vault, sink } = setUp();
    await sink.addHighlights({ book: BOOK, highlights: [VANITY], syncedAt: 0 });
    await sink.addHighlights({ book: BOOK, highlights: [typedOn(VANITY, 'Later.')], syncedAt: 1 });
    const [block] = readHighlights(
      vault.text('Library/Pride and Prejudice.md') ?? '',
      lineNoteBlocks,
    );
    expect(block?.comment).toBe('Later.');
  });

  it('refuses a note with unsaved typing, writing nothing', async () => {
    const path = 'Library/Pride and Prejudice.md';
    const { vault, sink } = setUp(
      { [path]: note({ asin: 'B0EXAMPLE1' }) },
      { dirty: new Set([path]) },
    );
    await expect(
      sink.addHighlights({ book: BOOK, highlights: [VANITY], syncedAt: 0 }),
    ).rejects.toBeInstanceOf(UnsavedTypingError);
    expect(vault.writes).toEqual([]);
  });
});

const fixture = (name: string) =>
  readFileSync(new URL(`../../../domain/src/kindle/fixtures/${name}`, import.meta.url), 'utf8');

/** The first book's two pages, with the other books' pages empty. */
function notebook(secondPage = fixture('annotations-page-2.html')) {
  const empty = (asin: string) =>
    kindlePage(
      `<input class="kp-notebook-annotations-next-page-start" value=""><input id="kp-notebook-annotations-asin" value="${asin}"><div id="kp-notebook-annotations"></div>`,
    );
  return fakeKindleNotebook({
    library: kindlePage(fixture('library.html')),
    books: {
      B0EXAMPLE1: [kindlePage(fixture('annotations-page-1.html')), kindlePage(secondPage)],
      B0EXAMPLE2: [empty('B0EXAMPLE2')],
      B0EXAMPLE3: [empty('B0EXAMPLE3')],
    },
  });
}

describe('syncKindle into literature notes', () => {
  const clock = { now: () => Date.UTC(2026, 9, 22, 9, 0) };

  it('makes the book note on the first sync, and adds nothing on the second', async () => {
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    const { vault, sink, created } = setUp();
    const first = await syncKindle({ source: notebook(), sink, clock, delay: fakeKindleDelay() });
    expect(first).toMatchObject({ kind: 'synced', added: 6 });
    expect(created).toEqual(['Library/Pride and Prejudice.md']);
    const text = vault.text('Library/Pride and Prejudice.md');
    expect(quotesIn(text)).toHaveLength(5);

    const second = await syncKindle({ source: notebook(), sink, clock, delay: fakeKindleDelay() });
    expect(second).toMatchObject({ kind: 'synced', added: 0 });
    expect(vault.text('Library/Pride and Prejudice.md')).toBe(text);
  });

  it('leaves a book whose note has unsaved typing for the next sync, saying so', async () => {
    const path = 'Library/Pride and Prejudice.md';
    const before = note({ asin: 'B0EXAMPLE1' });
    const syncKindle = createKindleSync({ deadline: heldKindleDelay() });
    const { vault, sink } = setUp({ [path]: before }, { dirty: new Set([path]) });
    const report = await syncKindle({ source: notebook(), sink, clock, delay: fakeKindleDelay() });
    expect(report).toMatchObject({
      kind: 'synced',
      books: [{ kind: 'unsaved_typing', asin: 'B0EXAMPLE1', title: 'Pride and Prejudice' }, {}, {}],
    });
    expect(vault.text(path)).toBe(before);
  });
});
