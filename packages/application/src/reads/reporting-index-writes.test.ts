import { describe, expect, it } from 'vitest';
import { createVaultPath, type IndexFacet } from '@atlas/domain';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import type { IndexedNote, IndexPort } from '../index/ports.ts';
import { reportingIndexWrites } from './reporting-index-writes.ts';

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

function reporting(index: IndexPort = sqliteIndexPort()) {
  const reports: IndexFacet[][] = [];
  const queries: string[] = [];
  const counted: IndexPort = {
    ...index,
    query: (sql, parameters) => {
      queries.push(sql);
      return index.query(sql, parameters);
    },
  };
  const wrapped = reportingIndexWrites({
    index: counted,
    report: (facets) => reports.push([...facets].sort()),
  });
  return { index: wrapped, reports, queries };
}

const linkTo = (path: string) => ({ target: path, path, kind: 'wikilink' as const });

describe('an index that says which facets each write changed', () => {
  it('says nothing for a note rewritten with only its words changed', async () => {
    const { index, reports } = reporting();
    await index.put([note('a.md', { body: 'one', links: [linkTo('b.md')] })]);
    reports.length = 0;

    await index.put([note('a.md', { body: 'two', digest: 'e', links: [linkTo('b.md')] })]);

    expect(reports).toEqual([]);
  });

  it('says the graph for a new link or a new title, and the tags for a new tag', async () => {
    const { index, reports } = reporting();
    await index.put([note('a.md')]);
    reports.length = 0;

    await index.put([note('a.md', { links: [linkTo('b.md')] })]);
    await index.put([note('a.md', { title: 'Renamed', links: [linkTo('b.md')] })]);
    await index.put([
      note('a.md', { title: 'Renamed', links: [linkTo('b.md')], tags: [{ key: 'x', name: 'x' }] }),
    ]);

    expect(reports).toEqual([['graph'], ['graph'], ['tags']]);
  });

  it('says the graph for a note it did not hold before', async () => {
    const { index, reports } = reporting();
    await index.put([note('a.md')]);
    expect(reports).toEqual([['graph']]);
  });

  it('asks the index twice per write, and not at all for a write of nothing', async () => {
    const { index, queries } = reporting();
    await index.put([]);
    expect(queries).toEqual([]);
    await index.put([note('a.md'), note('b.md')]);
    expect(queries).toHaveLength(2);
  });

  it('says every facet, unasked, for a write too large to check', async () => {
    const { index, reports, queries } = reporting();
    await index.put(Array.from({ length: 51 }, (_, at) => note(`n${at}.md`)));
    expect(reports).toEqual([['graph', 'tags']]);
    expect(queries).toEqual([]);
  });

  it('says every facet for a removal and a clear', async () => {
    const { index, reports } = reporting();
    await index.remove([createVaultPath('a.md')]);
    await index.clear();
    expect(reports).toEqual([
      ['graph', 'tags'],
      ['graph', 'tags'],
    ]);
  });

  it('says nothing for a removal of nothing', async () => {
    const { index, reports } = reporting();
    await index.remove([]);
    expect(reports).toEqual([]);
  });

  it('says every facet when the index will not answer, or answers short', async () => {
    const refusing = reporting({
      ...sqliteIndexPort(),
      query: () => Promise.reject(new Error('index closed')),
    });
    await refusing.index.put([note('a.md')]);
    expect(refusing.reports).toEqual([['graph', 'tags']]);

    const short = reporting({
      ...sqliteIndexPort(),
      query: async () => ({ columns: [], rows: [], truncated: true }),
    });
    await short.index.put([note('a.md')]);
    expect(short.reports).toEqual([['graph', 'tags']]);
  });

  it('says every facet for a write that failed, and still fails it', async () => {
    const { index, reports } = reporting({
      ...sqliteIndexPort(),
      put: () => Promise.reject(new Error('disk full')),
      remove: () => Promise.reject(new Error('disk full')),
    });
    await expect(index.put([note('a.md')])).rejects.toThrow('disk full');
    await expect(index.remove([createVaultPath('a.md')])).rejects.toThrow('disk full');
    expect(reports).toEqual([
      ['graph', 'tags'],
      ['graph', 'tags'],
    ]);
  });
});

describe('an index whose facets are all to be read again already', () => {
  it('writes without asking what changed, and says nothing more', async () => {
    const index = sqliteIndexPort();
    const queries: string[] = [];
    const reports: IndexFacet[][] = [];
    const due = new Set<string>(['graph']);
    const wrapped = reportingIndexWrites({
      index: {
        ...index,
        query: (sql, parameters) => (queries.push(sql), index.query(sql, parameters)),
      },
      report: (facets) => reports.push([...facets]),
      stale: () => due,
    });

    // Only the graph is due: the tags are still worth checking.
    await wrapped.put([note('a.md', { tags: [{ key: 'x', name: 'x' }] })]);
    expect(queries).toHaveLength(2);
    expect(reports).toEqual([['graph', 'tags']]);

    due.add('tags');
    await wrapped.put([note('b.md')]);
    expect(queries).toHaveLength(2);
    expect(reports).toHaveLength(1);
    expect((await index.manifest()).map((entry) => entry.path).sort()).toEqual(['a.md', 'b.md']);
  });
});

describe('puts whose checks overlap', () => {
  it('each says the graph, and the tags when either wrote one, whatever its own check saw', async () => {
    const index = sqliteIndexPort();
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const reports: IndexFacet[][] = [];
    const wrapped = reportingIndexWrites({
      index: { ...index, put: async (notes, scope) => (await held, index.put(notes, scope)) },
      report: (facets) => reports.push([...facets].sort()),
    });

    const both = Promise.all([
      wrapped.put([note('a.md', { tags: [{ key: 'x', name: 'x' }] })]),
      wrapped.put([note('a.md')]),
    ]);
    release();
    await both;

    expect(reports).toEqual([
      ['graph', 'tags'],
      ['graph', 'tags'],
    ]);
  });

  it('checks a put that runs alone, after them, as it always does', async () => {
    const { index, reports } = reporting();
    await Promise.all([index.put([note('a.md')]), index.put([note('b.md')])]);
    reports.length = 0;
    await index.put([note('a.md', { body: 'more', digest: 'e' })]);
    expect(reports).toEqual([]);
  });
});
