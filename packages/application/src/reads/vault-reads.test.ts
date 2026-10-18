import { describe, expect, it } from 'vitest';
import type { NoteChange } from '@atlas/domain';
import {
  READS_ON_INDEX_NEWS,
  readsMadeFromFacets,
  readsTouchedByNoteChanges,
  readsTouchedByPaths,
  VAULT_READS,
} from './vault-reads.ts';

const touched = (...paths: string[]) => [...readsTouchedByPaths(paths)].sort();

/** What any change under `.atlas` reaches: the sidebar walks all of it. */
const IN_ATLAS = ['quick-counts', 'sidebar-atlas'];

describe('which file reads a change at a path makes stale', () => {
  it('is the types for a type definition, and the templates for a template, at any depth', () => {
    expect(touched('.atlas/types/book.md')).toEqual([...IN_ATLAS, 'types'].sort());
    expect(touched('.atlas/templates/Book.md')).toEqual([...IN_ATLAS, 'templates'].sort());
    expect(touched('.atlas/templates/Meetings/Weekly.md')).toEqual(
      [...IN_ATLAS, 'templates'].sort(),
    );
  });

  it('is the settings for the settings note, and only for it', () => {
    expect(touched('.atlas/settings.md')).toEqual([...IN_ATLAS, 'settings'].sort());
    expect(touched('.atlas/settings.md.bak', '.atlas/settings/x.md')).toEqual(IN_ATLAS);
    expect(touched('settings.md', 'Notes/.atlas/settings.md')).toEqual([]);
  });

  it('is the sidebar’s walk and the quick counts for a view or a dashboard Atlas keeps', () => {
    expect(touched('.atlas/views/Open tasks.md')).toEqual(IN_ATLAS);
    expect(touched('.atlas/dashboards/Week.md')).toEqual(IN_ATLAS);
  });

  it('is nothing for an ordinary note, or a name that only starts the same', () => {
    expect(touched('Projects/Atlas.md')).toEqual([]);
    expect(touched('.atlasy/types/book.md', 'atlas/settings.md')).toEqual([]);
    expect(touched('.atlas/typesetting.md', '.atlas/templates-old/x.md')).toEqual(IN_ATLAS);
  });

  it('is the read when its file or folder itself, or one holding it, is moved', () => {
    expect(touched('.atlas/types')).toEqual([...IN_ATLAS, 'types'].sort());
    expect(touched('.atlas/templates/')).toEqual([...IN_ATLAS, 'templates'].sort());
    const everyFileRead = [...IN_ATLAS, 'settings', 'templates', 'types'].sort();
    expect(touched('.atlas')).toEqual(everyFileRead);
    // The vault's root holds everything.
    expect(touched('')).toEqual(everyFileRead);
  });

  it('reads a name case aside, as the Mac’s disk does', () => {
    expect(touched('.atlas/Templates/Book.md')).toEqual([...IN_ATLAS, 'templates'].sort());
    expect(touched('.Atlas/TYPES/book.md')).toEqual([...IN_ATLAS, 'types'].sort());
    expect(touched('.ATLAS/Settings.md')).toEqual([...IN_ATLAS, 'settings'].sort());
  });

  it('is every read any one of several paths touches', () => {
    expect(touched('a.md', '.atlas/types/book.md', '.atlas/templates/Book.md')).toEqual(
      [...IN_ATLAS, 'templates', 'types'].sort(),
    );
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
      expect(readsTouchedByNoteChanges([change('.atlas/types/book.md', kind)])).toContain('types');
    }
  });

  it('is the settings for the settings note the index found changed', () => {
    expect(readsTouchedByNoteChanges([change('.atlas/settings.md')])).toContain('settings');
  });

  it('is nothing for notes alone: the graph and the tags hear of those from the index’s writes', () => {
    expect([...readsTouchedByNoteChanges([change('a.md'), change('b.md', 'added')])]).toEqual([]);
  });
});

describe('which reads an index write’s facets make stale', () => {
  it('is the graph and the types’ counts for the graph: a count is its notes’ `type`', () => {
    expect([...readsMadeFromFacets(['graph'])].sort()).toEqual(['graph', 'type-counts']);
  });

  it('is the tags alone for the tags', () => {
    expect([...readsMadeFromFacets(['tags'])]).toEqual(['tags']);
  });

  it('is nothing for no facet, and both facets’ reads for both', () => {
    expect([...readsMadeFromFacets([])]).toEqual([]);
    expect([...readsMadeFromFacets(['graph', 'tags'])].sort()).toEqual([
      'graph',
      'tags',
      'type-counts',
    ]);
  });
});

describe('the reads the index’s every news makes stale', () => {
  it('is the sidebar’s marks and the quick counts, which no facet holds', () => {
    expect([...READS_ON_INDEX_NEWS].sort()).toEqual(['quick-counts', 'sidebar-marks']);
  });

  it('leaves no read with no way to be made again', () => {
    const renewed = new Set([
      ...READS_ON_INDEX_NEWS,
      ...readsMadeFromFacets(['graph', 'tags']),
      ...readsTouchedByPaths(['']),
    ]);
    expect(VAULT_READS.filter((read) => !renewed.has(read))).toEqual([]);
  });
});
