import { describe, expect, it } from 'vitest';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import { searchNotes, searchScope } from '../index/search-notes.ts';
import { listArchive } from './list-archive.ts';
import { notesInUseOfType } from './notes-in-use.ts';

const COLUMNS = ['path', 'title', 'archived', 'archivedFrom'];

function indexAnswering(rows: unknown[][], truncated = false) {
  const asked: { sql: string; parameters: readonly unknown[] }[] = [];
  const index = fakeIndexPort({
    query: async (sql, parameters) => {
      asked.push({ sql, parameters });
      return { columns: COLUMNS, rows, truncated };
    },
  });
  return { index, asked };
}

describe('listArchive', () => {
  it('reads each row as the Archive shows it: title, origin and day', async () => {
    const { index } = indexAnswering([
      ['Archive/Projects/X 2.md', 'X', '2026-09-27', 'Projects/X.md'],
      ['Archive/Old/Y.md', 'Y', null, null],
    ]);
    const listing = await listArchive({ index, search: '' });
    expect(listing).toEqual({
      notes: [
        {
          path: 'Archive/Projects/X 2.md',
          title: 'X',
          from: 'Projects/X.md',
          archivedOn: '2026-09-27',
        },
        { path: 'Archive/Old/Y.md', title: 'Y', from: 'Old/Y.md', archivedOn: null },
      ],
      truncated: false,
    });
  });

  it('asks the index for one more than it shows, so it can tell a full page from a cut one', async () => {
    const { index, asked } = indexAnswering([
      ['Archive/a.md', 'a', null, null],
      ['Archive/b.md', 'b', null, null],
      ['Archive/c.md', 'c', null, null],
    ]);
    const listing = await listArchive({ index, search: 'plan', limit: 2 });
    // LIMIT then OFFSET close the statement; the word is bound as a caseless GLOB.
    expect(asked[0]?.parameters.slice(-2)).toEqual([3, 0]);
    expect(asked[0]?.parameters).toContain('*[pP][lL][aA][nN]*');
    expect(listing.notes.map((note) => note.title)).toEqual(['a', 'b']);
    expect(listing.truncated).toBe(true);
  });

  it('reads a row with no title as untitled rather than as "null"', async () => {
    const { index } = indexAnswering([['Archive/a.md', null, null, null]]);
    expect((await listArchive({ index, search: '' })).notes[0]?.title).toBe('');
  });

  it('says it was cut short when the index did', async () => {
    const { index } = indexAnswering([['Archive/a.md', 'a', null, null]], true);
    expect((await listArchive({ index, search: '' })).truncated).toBe(true);
  });
});

describe('searchNotes', () => {
  it('leaves the Archive out unless asked, handing the host the prefix to skip', async () => {
    const scopes: unknown[] = [];
    const index = fakeIndexPort({
      search: async (_query, _limit, scope) => {
        scopes.push(scope);
        return [];
      },
    });
    await searchNotes({ index, query: '"x"', limit: 20, includeArchived: false });
    await searchNotes({ index, query: '"x"', limit: 20, includeArchived: true });
    expect(scopes).toEqual([{ skipPrefix: 'archive/' }, {}]);
    expect(searchScope({ includeArchived: false })).toEqual({ skipPrefix: 'archive/' });
  });
});

describe('notesInUseOfType', () => {
  it('offers the notes of a type that are not archived', async () => {
    const index = fakeIndexPort({
      notesOfType: async () => [
        { path: 'Projects/Live.md', title: 'Live' },
        { path: 'Archive/Projects/Old.md', title: 'Old' },
      ],
    });
    expect(await notesInUseOfType({ index, type: 'project' })).toEqual([
      { path: 'Projects/Live.md', title: 'Live' },
    ]);
  });
});
