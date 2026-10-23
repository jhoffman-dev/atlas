import { describe, expect, it } from 'vitest';
import { createVaultPath, type LibraryEntry, type NoteChange } from '@dfai/domain';
import { changesTouching, LIBRARY_SCOPE } from '../reads/scoped-reads.ts';
import { libraryScope } from './library-scope.ts';
import { refreshLibrary } from './load-research.ts';

const source = (path: string, projects: LibraryEntry['projects']): LibraryEntry => ({
  path: createVaultPath(path),
  title: path,
  author: null,
  kind: null,
  highlights: 0,
  modified: 1,
  tags: [],
  projects,
  cover: null,
});

const READ = {
  entries: [
    source('Library/Seeds.md', [{ path: createVaultPath('Notes/Garden.md'), name: 'Garden' }]),
    source('Library/Soil.md', [{ path: null, name: 'Orchard' }]),
    source('Library/Loam.md', []),
  ],
};
const choices = { kinds: [], tags: [], projects: [] };

const change = (path: string, type: string | null): NoteChange => ({
  kind: 'changed',
  path,
  type,
  digest: 'b',
  before: 'a',
});

describe('libraryScope', () => {
  it('is LIBRARY_SCOPE before anything is read, or when no source is filed under anything', () => {
    expect(libraryScope(undefined)).toBe(LIBRARY_SCOPE);
    expect(libraryScope({ entries: [source('Library/Loam.md', [])] })).toBe(LIBRARY_SCOPE);
  });

  it('hears an untyped note a source is filed under, by path or by the name a link waits for', () => {
    const scope = libraryScope(READ);
    expect(changesTouching(scope, [change('Notes/Garden.md', null)])).toHaveLength(1);
    expect(changesTouching(scope, [change('Elsewhere/orchard.md', null)])).toHaveLength(1);
    expect(changesTouching(scope, [change('Notes/Plain.md', null)])).toEqual([]);
  });
});

describe('refreshLibrary, told of a note that is not literature', () => {
  let asked: string[] = [];
  const index = {
    query: async (_sql: string, parameters: readonly unknown[]) => {
      asked.push(...parameters.filter((each): each is string => typeof each === 'string'));
      return { columns: [], rows: [], truncated: false };
    },
  };

  it('reads again only the sources filed under it', async () => {
    asked = [];
    const previous = { ...READ, choices };
    const next = await refreshLibrary({
      index,
      previous,
      changes: [change('Notes/Garden.md', null), change('Elsewhere/Orchard.md', 'note')],
    });
    expect(next).not.toBeNull();
    expect(asked).toEqual(expect.arrayContaining(['Library/Seeds.md', 'Library/Soil.md']));
    expect(asked).not.toContain('Library/Loam.md');
  });

  it('reads the whole again for a project or area, or a note no source is filed under', async () => {
    const previous = { ...READ, choices };
    for (const changed of [
      change('Notes/Garden.md', 'project'),
      change('Notes/Garden.md', 'Area'),
      change('Notes/Plain.md', null),
    ]) {
      expect(
        await refreshLibrary({ index, previous, changes: [changed] }),
        changed.path,
      ).toBeNull();
    }
  });
});
