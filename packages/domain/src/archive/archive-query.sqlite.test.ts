import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileArchiveQuery } from './archive-query.ts';
import { isArchivedPath, outsideArchiveSql } from './archive.ts';

/**
 * The Archive's statement run for real against SQLite, over the index's own
 * `files` and `props` tables: what is asserted is the rows, not the text.
 */
function archiveIndex(
  notes: readonly { path: string; title: string; props?: Record<string, string> }[],
) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
  `);
  const file = database.prepare('INSERT INTO files VALUES (?, ?)');
  const prop = database.prepare(
    'INSERT INTO props (path, key, idx, value_text, value_date) VALUES (?, ?, 0, ?, ?)',
  );
  for (const note of notes) {
    file.run(note.path, note.title);
    for (const [key, value] of Object.entries(note.props ?? {})) {
      // A day is indexed as a date as well as text; `archivedFrom` only as text.
      prop.run(note.path, key, value, /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
    }
  }
  return {
    archive: (search = '', limit?: number, offset?: number) => {
      const { sql, parameters } = compileArchiveQuery({
        search,
        ...(limit !== undefined && { limit }),
        ...(offset !== undefined && { offset }),
      });
      return database.prepare(sql).all(...parameters);
    },
    outside: () =>
      database
        .prepare(`SELECT path FROM files WHERE ${outsideArchiveSql('path')} ORDER BY path`)
        .all()
        .map((row) => row['path']),
  };
}

const vault = archiveIndex([
  { path: 'Projects/Live.md', title: 'Live' },
  {
    path: 'Archive/Projects/Old plan.md',
    title: 'Old plan',
    props: { archived: '2026-09-01', archivedFrom: 'Projects/Old plan.md' },
  },
  {
    path: 'Archive/Notes/Recipe.md',
    title: 'Recipe',
    props: { archived: '2026-09-20', archivedFrom: 'Notes/Recipe.md' },
  },
  { path: 'archive/By hand.md', title: 'By hand' },
  { path: 'Notes/Archive/Not archived.md', title: 'Not archived' },
]);

describe('compileArchiveQuery, run against SQLite', () => {
  it('lists only archived notes, newest first, undated last', () => {
    expect(vault.archive().map((row) => row['path'])).toEqual([
      'Archive/Notes/Recipe.md',
      'Archive/Projects/Old plan.md',
      'archive/By hand.md',
    ]);
  });

  it('carries the day and the origin archiving wrote', () => {
    expect(vault.archive()[0]).toEqual({
      path: 'Archive/Notes/Recipe.md',
      title: 'Recipe',
      archived: '2026-09-20',
      archivedFrom: 'Notes/Recipe.md',
    });
    expect(vault.archive()[2]).toMatchObject({ archived: null, archivedFrom: null });
  });

  it('narrows to the notes whose title or path holds every word, in any case', () => {
    expect(vault.archive('PLAN').map((row) => row['title'])).toEqual(['Old plan']);
    expect(vault.archive('projects old').map((row) => row['title'])).toEqual(['Old plan']);
    expect(vault.archive('projects recipe')).toEqual([]);
  });

  it('treats % and _ as characters, not wildcards', () => {
    expect(vault.archive('%')).toEqual([]);
    expect(vault.archive('_')).toEqual([]);
  });

  it('stops at the limit', () => {
    expect(vault.archive('', 1)).toHaveLength(1);
  });

  it('pages on from an offset (A20-05)', () => {
    expect(vault.archive('', 1, 1).map((row) => row['path'])).toEqual([
      'Archive/Projects/Old plan.md',
    ]);
  });

  it('treats * ? and [ typed as characters, not patterns (A20-05)', () => {
    const index = archiveIndex([
      { path: 'Archive/a.md', title: 'plain' },
      { path: 'Archive/b.md', title: 'what? [draft] 5*2' },
    ]);
    for (const typed of ['?', '[', '*', '[draft]', '5*2'])
      expect(index.archive(typed).map((row) => row['path'])).toEqual(['Archive/b.md']);
  });

  it('folds cases beyond ASCII both ways (A20-05)', () => {
    const index = archiveIndex([{ path: 'Archive/Σ.md', title: 'ΣΟΦΙΑ Çelik' }]);
    expect(index.archive('σοφια')).toHaveLength(1);
    expect(index.archive('ÇELIK')).toHaveLength(1);
    expect(index.archive('çelik')).toHaveLength(1);
  });
});

describe('a long Archive search (A20-06)', () => {
  it('runs, capped, rather than overflowing what SQLite binds or nests', () => {
    const search = Array.from({ length: 10_000 }, () => 'plan').join(' ');
    expect(vault.archive(search).map((row) => row['path'])).toEqual([
      'Archive/Projects/Old plan.md',
    ]);
  });
});

describe('outsideArchiveSql, run against SQLite', () => {
  it('leaves out exactly the notes isArchivedPath calls archived', () => {
    const paths = [
      'Archive/a.md',
      'archive/b.md',
      'ARCHIVE/c.md',
      'Archives/d.md',
      'Archive.md',
      'x/Archive/e.md',
      'f.md',
    ];
    const index = archiveIndex(paths.map((path) => ({ path, title: path })));
    expect(index.outside()).toEqual(paths.filter((path) => !isArchivedPath(path)).sort());
  });
});
