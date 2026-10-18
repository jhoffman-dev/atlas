import { describe, expect, it } from 'vitest';
import { compileGraphQuery, compileNoteFacetsQuery, type GraphQueryPart } from '@atlas/domain';
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
      { target: 'a', path: 'a.md', kind: 'wikilink' },
      { target: 'nowhere', path: null, kind: 'wikilink' },
      { target: 'a.md', path: 'a.md', kind: 'markdown' },
    ],
    tags: [
      { key: 'x', name: 'X' },
      { key: 'y', name: 'y' },
    ],
  }),
  note('a.md', { properties: [prop('project', 0, '[[b]]')] }),
  note('c.md'),
];

async function filled(index: IndexPort) {
  await index.put(NOTES);
  return index;
}

const sorted = (found: readonly (readonly unknown[])[]) => found.map((row) => JSON.stringify(row)).sort();

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
});
