import { describe, expect, it, vi } from 'vitest';
import {
  createVaultPath,
  DEFAULT_GRAPH_FILTER,
  GRAPH_PAGE_SIZE,
  type GraphQueryPart,
} from '@atlas/domain';
import { fakeIndexPort } from '../testing/fake-ports.ts';
import type { QueryResult } from '../index/ports.ts';
import { loadGraph, pictureGraph, readVaultGraph } from './load-graph.ts';

type Tables = Record<GraphQueryPart, { columns: string[]; rows: unknown[][] }>;

const vault: Tables = {
  notes: {
    columns: ['path', 'title', 'type'],
    rows: [
      ['a.md', 'A', 'task'],
      ['b.md', 'B', null],
      ['c.md', 'C', 'project'],
      ['.atlas/types/task.md', 'task', null],
    ],
  },
  // What a query's groups are named by; the graph itself never reads it.
  namedNotes: { columns: ['path', 'title'], rows: [] },
  links: {
    columns: ['source', 'target'],
    rows: [
      ['a.md', 'b.md'],
      ['.atlas/types/task.md', 'a.md'],
    ],
  },
  relations: { columns: ['source', 'key', 'value'], rows: [['b.md', 'project', '[[c]]']] },
};

/** An index that answers each graph query from the tables, by the part its statement names. */
function indexOf(tables: Tables) {
  const query = vi.fn(async (sql: string, parameters: readonly (string | number | null)[]) => {
    const part = /graph:(\w+)/.exec(sql)?.[1] as GraphQueryPart;
    const [limit, offset] = parameters.slice(-2) as [number, number];
    const table = tables[part];
    return {
      columns: table.columns,
      rows: table.rows.slice(offset, offset + limit),
      truncated: false,
    } satisfies QueryResult;
  });
  return { index: fakeIndexPort({ query }), query };
}

describe('readVaultGraph', () => {
  it('builds the graph from the notes, links and relations the index holds', async () => {
    const graph = await readVaultGraph(indexOf(vault));
    expect(graph.nodes.map((node) => [node.path, node.type, node.degree])).toEqual([
      ['.atlas/types/task.md', null, 1],
      ['a.md', 'task', 2],
      ['b.md', null, 2],
      ['c.md', 'project', 1],
    ]);
    expect(graph.edges.map((edge) => edge.id)).toEqual([
      'link::.atlas/types/task.md->a.md',
      'link::a.md->b.md',
      'relation:Project:b.md->c.md',
    ]);
  });

  it('reads past the host’s row cap, a page at a time', async () => {
    const many = Array.from({ length: GRAPH_PAGE_SIZE + 3 }, (_, at) => [`n${at}.md`, 'n', null]);
    const { index, query } = indexOf({ ...vault, notes: { ...vault.notes, rows: many } });
    const graph = await readVaultGraph({ index });
    expect(graph.nodes).toHaveLength(GRAPH_PAGE_SIZE + 3);
    const noteCalls = query.mock.calls.filter(([sql]) => sql.includes('graph:notes'));
    expect(noteCalls).toHaveLength(2);
  });

  it('asks again when the host says it cut a page short', async () => {
    const pages: QueryResult[] = [
      { columns: ['path', 'title', 'type'], rows: [['a.md', 'A', null]], truncated: true },
      { columns: ['path', 'title', 'type'], rows: [['b.md', 'B', null]], truncated: false },
    ];
    const query = vi.fn(async (sql: string) =>
      sql.includes('graph:notes')
        ? (pages.shift() as QueryResult)
        : { columns: [], rows: [], truncated: false },
    );
    const graph = await readVaultGraph({ index: fakeIndexPort({ query }) });
    expect(graph.nodes.map((node) => node.path)).toEqual(['a.md', 'b.md']);
  });

  it('fails when the index does, rather than drawing half a vault', async () => {
    const index = fakeIndexPort({
      query: async () => {
        throw new Error('index not open');
      },
    });
    await expect(readVaultGraph({ index })).rejects.toThrow('index not open');
  });
});

describe('loadGraph', () => {
  it('shows the vault without Atlas’s own notes by default', async () => {
    const { graph, hidden } = await loadGraph({
      ...indexOf(vault),
      scope: { kind: 'vault' },
      filter: DEFAULT_GRAPH_FILTER,
    });
    expect(graph.nodes.map((node) => node.path)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(hidden).toBe(0);
  });

  it('shows one note’s neighbours at depth 1, and theirs at depth 2', async () => {
    const around = (depth: 1 | 2) =>
      loadGraph({
        ...indexOf(vault),
        scope: { kind: 'note', path: createVaultPath('c.md'), depth },
        filter: DEFAULT_GRAPH_FILTER,
      });
    expect((await around(1)).graph.nodes.map((node) => node.path)).toEqual(['b.md', 'c.md']);
    expect((await around(2)).graph.nodes.map((node) => node.path)).toEqual([
      'a.md',
      'b.md',
      'c.md',
    ]);
  });

  it('shows only the chosen types', async () => {
    const { graph } = await loadGraph({
      ...indexOf(vault),
      scope: { kind: 'vault' },
      filter: { ...DEFAULT_GRAPH_FILTER, types: ['task', 'project'] },
    });
    expect(graph.nodes.map((node) => node.path)).toEqual(['a.md', 'c.md']);
  });

  it('caps a large graph and counts what it left out', async () => {
    const { graph, hidden } = await loadGraph({
      ...indexOf(vault),
      scope: { kind: 'vault' },
      filter: DEFAULT_GRAPH_FILTER,
      limit: 2,
    });
    expect(graph.nodes.map((node) => node.path)).toEqual(['a.md', 'b.md']);
    expect(hidden).toBe(1);
  });
});

describe('pictureGraph', () => {
  it('is the graph as it is when nothing is filtered and it fits', async () => {
    const graph = await readVaultGraph(indexOf(vault));
    const picture = pictureGraph(graph, {
      scope: { kind: 'vault' },
      filter: { types: null, hideOrphans: false, hideSystem: false, hideArchived: false },
    });
    expect(picture).toEqual({ graph, hidden: 0 });
  });
});
