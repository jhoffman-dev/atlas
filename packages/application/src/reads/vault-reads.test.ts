import { describe, expect, it } from 'vitest';
import type { NoteChange } from '@atlas/domain';
import { readsTouchedByNoteChanges, readsTouchedByPaths } from './vault-reads.ts';

const touched = (...paths: string[]) => [...readsTouchedByPaths(paths)].sort();

describe('which file reads a change at a path makes stale', () => {
  it('is the types for a type definition, and the templates for a template, at any depth', () => {
    expect(touched('.atlas/types/book.md')).toEqual(['types']);
    expect(touched('.atlas/templates/Book.md')).toEqual(['templates']);
    expect(touched('.atlas/templates/Meetings/Weekly.md')).toEqual(['templates']);
  });

  it('is nothing for an ordinary note, a view, or a name that only starts the same', () => {
    expect(touched('Projects/Atlas.md')).toEqual([]);
    expect(touched('.atlas/views/Open tasks.md')).toEqual([]);
    expect(touched('.atlas/typesetting.md', '.atlas/templates-old/x.md')).toEqual([]);
  });

  it('is the folder’s read when the folder itself, or one holding it, is moved', () => {
    expect(touched('.atlas/types')).toEqual(['types']);
    expect(touched('.atlas/templates/')).toEqual(['templates']);
    expect(touched('.atlas')).toEqual(['templates', 'types']);
    // The vault's root holds everything.
    expect(touched('')).toEqual(['templates', 'types']);
  });

  it('reads a folder’s name case aside, as the Mac’s disk does', () => {
    expect(touched('.atlas/Templates/Book.md')).toEqual(['templates']);
    expect(touched('.Atlas/TYPES/book.md')).toEqual(['types']);
  });

  it('is every read any one of several paths touches', () => {
    expect(touched('a.md', '.atlas/types/book.md', '.atlas/templates/Book.md')).toEqual([
      'templates',
      'types',
    ]);
  });
});

describe('which file reads a sync’s note changes make stale', () => {
  const change = (path: string, kind: NoteChange['kind'] = 'changed'): NoteChange => ({
    kind,
    path,
    type: null,
    digest: 'd',
  });

  it('is the types for a type definition the index found changed, added or removed', () => {
    for (const kind of ['added', 'changed', 'removed'] as const) {
      expect([...readsTouchedByNoteChanges([change('.atlas/types/book.md', kind)])]).toEqual([
        'types',
      ]);
    }
  });

  it('is nothing for notes alone: the graph and the tags hear of those from the index’s writes', () => {
    expect([...readsTouchedByNoteChanges([change('a.md'), change('b.md', 'added')])]).toEqual([]);
  });
});
