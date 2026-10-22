import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compileHighlightsQuery,
  compileLibraryQuery,
  HIGHLIGHT_TEXT_LIMIT,
  HIGHLIGHTS_PAGE_SIZE,
  HIGHLIGHTS_QUERY_COLUMNS,
  LIBRARY_PAGE_SIZE,
  LIBRARY_QUERY_COLUMNS,
} from './research-query.ts';

/**
 * The Library's and All highlights' statements, run for real against SQLite
 * over the tables `src-tauri/src/index.rs` makes (files, props, tags,
 * relations, highlights), in their shapes: what is asserted is the rows.
 */

interface Note {
  readonly path: string;
  readonly title?: string;
  readonly modified?: number;
  readonly props?: Readonly<Record<string, string>>;
  readonly tags?: readonly string[];
  readonly projects?: readonly { target: string; dst: string | null }[];
  readonly highlights?: readonly {
    id: string;
    quote?: string;
    comment?: string;
    color?: string;
    anchor?: string;
  }[];
}

let open: DatabaseSync[] = [];
afterEach(() => {
  open.forEach((database) => database.close());
  open = [];
});

function indexOf(notes: readonly Note[]): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  open.push(database);
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      modified INTEGER NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL DEFAULT '',
      note_type TEXT, progress INTEGER);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE TABLE tags (path TEXT NOT NULL, idx INTEGER NOT NULL, tag TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
      target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);
    CREATE TABLE highlights (path TEXT NOT NULL, idx INTEGER NOT NULL, id TEXT NOT NULL,
      kind TEXT NOT NULL, quote TEXT NOT NULL, comment TEXT NOT NULL, mark TEXT NOT NULL,
      color TEXT NOT NULL, anchor TEXT NOT NULL);
  `);
  const file = database.prepare(
    'INSERT INTO files (path, title, modified, size) VALUES (?, ?, ?, 0)',
  );
  const prop = database.prepare(
    'INSERT INTO props (path, key, idx, value_text) VALUES (?, ?, 0, ?)',
  );
  const tag = database.prepare('INSERT INTO tags VALUES (?, ?, ?, ?)');
  const relation = database.prepare(
    "INSERT INTO relations VALUES (?, 'project', ?, ?, lower(?), ?)",
  );
  const mark = database.prepare(
    "INSERT INTO highlights VALUES (?, ?, ?, 'pdf', ?, ?, 'highlight', ?, ?)",
  );
  for (const note of notes) {
    file.run(note.path, note.title ?? note.path, note.modified ?? 0);
    for (const [key, value] of Object.entries(note.props ?? {})) prop.run(note.path, key, value);
    note.tags?.forEach((each, at) => tag.run(note.path, at, each, each));
    note.projects?.forEach((each, at) =>
      relation.run(note.path, at, each.target, each.target, each.dst),
    );
    note.highlights?.forEach((each, at) =>
      mark.run(
        note.path,
        at,
        each.id,
        each.quote ?? 'Quoted',
        each.comment ?? '',
        each.color ?? 'yellow',
        each.anchor ?? '{"v":1,"kind":"pdf","page":1}',
      ),
    );
  }
  return database;
}

function rowsOf(
  database: DatabaseSync,
  { sql, parameters }: { sql: string; parameters: readonly (string | number)[] },
  columns: readonly string[],
) {
  const statement = database.prepare(sql);
  expect(statement.columns().map((column) => column.name)).toEqual([...columns]);
  return statement.all(...parameters) as Record<string, unknown>[];
}

const LITERATURE = { type: 'literature', kind: 'pdf' };

describe('compileLibraryQuery', () => {
  const library = (notes: readonly Note[], page = 0) =>
    rowsOf(indexOf(notes), compileLibraryQuery(page), LIBRARY_QUERY_COLUMNS);

  it('lists every literature note, its type read as isLiteratureNote reads it, and no other note', () => {
    const rows = library([
      { path: 'Library/A.md', props: { type: 'literature' } },
      { path: 'Library/B.md', props: { type: ' Literature ' } },
      { path: 'Notes/C.md', props: { type: 'note' } },
      { path: 'Notes/D.md' },
    ]);
    expect(rows.map((row) => row['path'])).toEqual(['Library/A.md', 'Library/B.md']);
  });

  it("leaves out DFAI's own files and the Archive's", () => {
    const rows = library([
      { path: '.atlas/templates/Book.md', props: LITERATURE },
      { path: 'Archive/Library/Old.md', props: LITERATURE },
      { path: 'Library/Kept.md', props: LITERATURE },
    ]);
    expect(rows.map((row) => row['path'])).toEqual(['Library/Kept.md']);
  });

  it('reads the title, the time, the author, kind and cover, and counts the highlights', () => {
    const [row] = library([
      {
        path: 'Library/Art.md',
        title: 'The Art of War',
        modified: 1234,
        props: { ...LITERATURE, author: 'Sun Tzu', cover: '![[art.jpg]]' },
        highlights: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      },
    ]);
    expect(row).toEqual({
      path: 'Library/Art.md',
      title: 'The Art of War',
      modified: 1234,
      author: 'Sun Tzu',
      kind: 'pdf',
      cover: '![[art.jpg]]',
      highlights: 3,
      tags: null,
      projects: null,
    });
  });

  it('joins the tags each once, by key, and each project as its note and title, or as written', () => {
    // The project is no literature note, so the source is the one row.
    const [row] = library([
      { path: 'Projects/Reading.md', title: 'Reading list' },
      {
        path: 'Library/Art.md',
        props: LITERATURE,
        tags: ['war', 'strategy', 'war'],
        projects: [
          { target: 'Reading', dst: 'Projects/Reading.md' },
          { target: 'Someday', dst: null },
        ],
      },
    ]);
    expect(row?.['tags']).toBe('strategy\u001fwar');
    expect(row?.['projects']).toBe('Projects/Reading.md\u001eReading list\u001f\u001eSomeday');
  });

  it('reads a page at a time, by path', () => {
    const notes = Array.from({ length: 3 }, (_, at) => ({
      path: `Library/${at}.md`,
      props: LITERATURE,
    }));
    expect(compileLibraryQuery(2).parameters).toEqual([LIBRARY_PAGE_SIZE, 2 * LIBRARY_PAGE_SIZE]);
    expect(library(notes).map((row) => row['path'])).toEqual([
      'Library/0.md',
      'Library/1.md',
      'Library/2.md',
    ]);
    expect(library(notes, 1)).toEqual([]);
  });
});

describe('compileHighlightsQuery', () => {
  const highlights = (notes: readonly Note[], page = 0) =>
    rowsOf(indexOf(notes), compileHighlightsQuery(page), HIGHLIGHTS_QUERY_COLUMNS);

  it('lists every highlight the index holds, by note and then by place', () => {
    const rows = highlights([
      { path: 'Library/B.md', highlights: [{ id: 'b1' }, { id: 'b2' }] },
      { path: 'Library/A.md', highlights: [{ id: 'a1' }] },
    ]);
    expect(rows.map((row) => [row['path'], row['idx'], row['id']])).toEqual([
      ['Library/A.md', 0, 'a1'],
      ['Library/B.md', 0, 'b1'],
      ['Library/B.md', 1, 'b2'],
    ]);
  });

  it('reads the style, the comment, and a page or a location from the anchor; none from one not JSON', () => {
    const [pdf, kindle, broken] = highlights([
      {
        path: 'Library/Art.md',
        highlights: [
          {
            id: 'p1',
            color: 'green',
            comment: 'Compare.',
            anchor: '{"v":1,"kind":"pdf","page":3}',
          },
          { id: 'k1', anchor: '{"v":1,"kind":"kindle","location":77,"locationEnd":79}' },
          { id: 'b1', anchor: 'not json' },
        ],
      },
    ]);
    expect(pdf).toMatchObject({
      color: 'green',
      mark: 'highlight',
      comment: 'Compare.',
      page: 3,
      location: null,
    });
    expect(kindle).toMatchObject({ page: null, location: 77 });
    expect(broken).toMatchObject({ id: 'b1', page: null, location: null });
  });

  it('reads only the start of a long quote and comment', () => {
    const long = 'w'.repeat(HIGHLIGHT_TEXT_LIMIT + 50);
    const [row] = highlights([
      { path: 'Library/A.md', highlights: [{ id: 'l1', quote: long, comment: long }] },
    ]);
    expect(String(row?.['quote'])).toHaveLength(HIGHLIGHT_TEXT_LIMIT);
    expect(String(row?.['comment'])).toHaveLength(HIGHLIGHT_TEXT_LIMIT);
  });

  it('reads a page at a time', () => {
    expect(compileHighlightsQuery(3).parameters).toEqual([
      HIGHLIGHTS_PAGE_SIZE,
      3 * HIGHLIGHTS_PAGE_SIZE,
    ]);
    const notes = [{ path: 'Library/A.md', highlights: [{ id: 'a1' }] }];
    expect(highlights(notes)).toHaveLength(1);
    expect(highlights(notes, 1)).toEqual([]);
  });
});
