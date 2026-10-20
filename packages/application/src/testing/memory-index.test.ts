import { describe, expect, it } from 'vitest';
import {
  compileGraphQuery,
  compileNoteFacetsQuery,
  compileLinkHoldersQuery,
  compileTagCountsQuery,
  type GraphQueryPart,
} from '@atlas/domain';
import type { IndexedNote, IndexPort } from '../index/ports.ts';
import { memoryIndexPort } from './memory-index.ts';
import { sqliteIndexPort } from './sqlite-index.ts';

const note = (path: string, extra: Partial<IndexedNote> = {}): IndexedNote => ({
  path,
  title: path.replace(/\.md$/, ''),
  modified: 1,
  size: 1,
  digest: 'd',
  type: null,
  body: '',
  summary: '',
  properties: [],
  links: [],
  tags: [],
  relations: [],
  blocks: [],
  checks: [],
  progress: null,
  ...extra,
});

const prop = (key: string, index: number, text: string) => ({
  key,
  index,
  text,
  number: null,
  date: null,
  json: null,
});

const NOTES = [
  note('b.md', {
    properties: [prop('type', 1, 'second'), prop('type', 0, 'task'), prop('status', 0, 'done')],
    links: [
      { target: 'a', leaf: 'a', path: 'a.md', kind: 'wikilink' },
      { target: 'nowhere', leaf: 'nowhere', path: null, kind: 'wikilink' },
      { target: 'a.md', leaf: 'a', path: 'a.md', kind: 'markdown' },
    ],
    tags: [
      { key: 'x', name: 'X' },
      { key: 'y', name: 'y' },
    ],
  }),
  note('a.md', {
    properties: [prop('project', 0, '[[b]]')],
    relations: [{ key: 'project', index: 0, target: 'b', name: 'b', path: 'b.md' }],
    tags: [{ key: 'x', name: 'x' }],
  }),
  note('c.md'),
];

async function filled(index: IndexPort) {
  await index.put(NOTES);
  return index;
}

const sorted = (found: readonly (readonly unknown[])[]) =>
  found.map((row) => JSON.stringify(row)).sort();

describe('the in-memory index, beside the one in SQLite', () => {
  it('answers the facet check with the same rows', async () => {
    const { sql, parameters } = compileNoteFacetsQuery(['a.md', 'b.md']);
    const [memory, sqlite] = await Promise.all(
      [memoryIndexPort(), sqliteIndexPort()].map(async (index) =>
        (await filled(index)).query(sql, parameters),
      ),
    );
    expect(memory?.columns).toEqual(sqlite?.columns);
    expect(sorted(memory?.rows ?? [])).toEqual(sorted(sqlite?.rows ?? []));
    expect(memory?.rows.length).toBeGreaterThan(0);
  });

  it('answers each part of the graph with the same rows', async () => {
    for (const part of ['notes', 'links', 'relations'] as GraphQueryPart[]) {
      const { sql, parameters } = compileGraphQuery(part, 0);
      const [memory, sqlite] = await Promise.all(
        [memoryIndexPort(), sqliteIndexPort()].map(async (index) =>
          (await filled(index)).query(sql, parameters),
        ),
      );
      expect(sorted(memory?.rows ?? []), part).toEqual(sorted(sqlite?.rows ?? []));
    }
  });

  it('answers the tag counts with the same rows', async () => {
    for (const { sql, parameters } of [compileTagCountsQuery(0)]) {
      const [memory, sqlite] = await Promise.all(
        [memoryIndexPort(), sqliteIndexPort()].map(async (index) =>
          (await filled(index)).query(sql, parameters),
        ),
      );
      expect(sorted(memory?.rows ?? [])).toEqual(sorted(sqlite?.rows ?? []));
      expect(memory?.rows.length).toBeGreaterThan(0);
    }
  });

  it('answers which notes hold a link a note made or gone moves, by relation or in the body', async () => {
    const cases: [Parameters<typeof compileLinkHoldersQuery>, string[]][] = [
      // a.md's relation names b, and points elsewhere than the new x/b.md.
      [[{ made: ['x/b.md'], gone: [] }], ['a.md']],
      // Only b.md's body link names nowhere.
      [[{ made: ['p/Nowhere.md'], gone: [] }], ['b.md']],
      // b.md's body links point at a.md, which has gone.
      [[{ made: [], gone: ['a.md'] }], ['b.md']],
      // Already the note it means: a.md's relation is not moved by b.md coming back (#440).
      [[{ made: ['b.md'], gone: [] }], []],
      [[{ made: ['x/b.md', 'nowhere.md'], gone: [] }, 1], ['b.md']],
    ];
    for (const [query, holders] of cases) {
      const { sql, parameters } = compileLinkHoldersQuery(...query);
      const [memory, sqlite] = await Promise.all(
        [memoryIndexPort(), sqliteIndexPort()].map(async (index) =>
          (await filled(index)).query(sql, parameters),
        ),
      );
      expect(sqlite?.rows, JSON.stringify(query)).toEqual(holders.map((path) => [path]));
      expect(memory?.rows, JSON.stringify(query)).toEqual(sqlite?.rows);
    }
  });

  it('refuses a statement it was not made to answer', async () => {
    await expect(memoryIndexPort().query('SELECT 1', [])).rejects.toThrow(/does not answer/);
  });
});
