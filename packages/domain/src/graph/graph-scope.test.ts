import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  capGraph,
  DEFAULT_GRAPH_FILTER,
  graphTypes,
  scopeGraph,
  showsType,
  toggleGraphType,
  UNTYPED,
  withinReach,
  type GraphFilter,
} from './graph-scope.ts';
import { buildVaultGraph, type VaultGraph } from './vault-graph.ts';

/**
 * A chain a — b — c — d, a hub h linked from a and b, an orphan o, and
 * Atlas's own type note t linked to a.
 */
const graph: VaultGraph = buildVaultGraph({
  notes: [
    { path: 'a.md', title: 'a', type: 'task' },
    { path: 'b.md', title: 'b', type: 'task' },
    { path: 'c.md', title: 'c', type: 'project' },
    { path: 'd.md', title: 'd', type: null },
    { path: 'h.md', title: 'h', type: 'person' },
    { path: 'o.md', title: 'o', type: null },
    { path: '.atlas/types/task.md', title: 'task', type: null },
  ],
  links: [
    { source: 'a.md', target: 'b.md' },
    { source: 'b.md', target: 'c.md' },
    { source: 'c.md', target: 'd.md' },
    { source: 'a.md', target: 'h.md' },
    { source: 'b.md', target: 'h.md' },
    { source: '.atlas/types/task.md', target: 'a.md' },
  ],
  relations: [],
});

const all: GraphFilter = {
  types: null,
  hideOrphans: false,
  hideSystem: false,
  hideArchived: false,
};
const paths = (shown: VaultGraph) => shown.nodes.map((node) => node.path);
const vault = { kind: 'vault' } as const;
const around = (path: string, depth: 1 | 2) =>
  ({ kind: 'note', path: createVaultPath(path), depth }) as const;

describe('scopeGraph over the whole vault', () => {
  it('hides archived notes by default, and shows them when asked', () => {
    const withArchive = buildVaultGraph({
      notes: [
        { path: 'a.md', title: 'a', type: null },
        { path: 'Archive/old.md', title: 'old', type: null },
      ],
      links: [{ source: 'a.md', target: 'Archive/old.md' }],
      relations: [],
    });
    const hidden = scopeGraph(withArchive, { scope: vault, filter: DEFAULT_GRAPH_FILTER });
    expect(paths(hidden)).toEqual(['a.md']);
    expect(hidden.edges).toEqual([]);
    expect(
      paths(scopeGraph(withArchive, { scope: vault, filter: { ...all, hideArchived: false } })),
    ).toEqual(['a.md', 'Archive/old.md']);
  });

  it('hides Atlas’s own notes by default, and the edges that reached them', () => {
    const shown = scopeGraph(graph, { scope: vault, filter: DEFAULT_GRAPH_FILTER });
    expect(paths(shown)).not.toContain('.atlas/types/task.md');
    expect(shown.edges.some((edge) => edge.source.startsWith('.atlas'))).toBe(false);
    expect(paths(shown)).toContain('a.md');
  });

  it('shows them when asked', () => {
    expect(paths(scopeGraph(graph, { scope: vault, filter: all }))).toContain(
      '.atlas/types/task.md',
    );
  });

  it('shows only the chosen types, with notes of no type as a choice of their own', () => {
    const shown = scopeGraph(graph, { scope: vault, filter: { ...all, types: ['task', UNTYPED] } });
    expect(paths(shown)).toEqual(['.atlas/types/task.md', 'a.md', 'b.md', 'd.md', 'o.md']);
    expect(shown.edges.map((edge) => edge.id)).toEqual([
      'link::.atlas/types/task.md->a.md',
      'link::a.md->b.md',
    ]);
  });

  it('hides orphans — including those left alone by the other filters', () => {
    const shown = scopeGraph(graph, {
      scope: vault,
      filter: { ...all, types: ['task', UNTYPED], hideOrphans: true },
    });
    expect(paths(shown)).toEqual(['.atlas/types/task.md', 'a.md', 'b.md']);
  });
});

describe('scopeGraph around one note', () => {
  it('reaches its neighbours only, at depth 1', () => {
    expect(paths(scopeGraph(graph, { scope: around('c.md', 1), filter: all }))).toEqual([
      'b.md',
      'c.md',
      'd.md',
    ]);
  });

  it('reaches their neighbours too, at depth 2, following links either way', () => {
    expect(paths(scopeGraph(graph, { scope: around('c.md', 2), filter: all }))).toEqual([
      'a.md',
      'b.md',
      'c.md',
      'd.md',
      'h.md',
    ]);
  });

  it('does not walk through a note a filter hides', () => {
    const shown = scopeGraph(graph, {
      scope: around('c.md', 2),
      filter: { ...all, types: ['project', UNTYPED] },
    });
    expect(paths(shown)).toEqual(['c.md', 'd.md']);
  });

  it('keeps the centre whatever the filters say, even when it is alone', () => {
    const shown = scopeGraph(graph, {
      scope: around('o.md', 2),
      filter: { ...all, types: ['task'], hideOrphans: true },
    });
    expect(paths(shown)).toEqual(['o.md']);
  });

  it('is empty for a note the graph does not have', () => {
    expect(scopeGraph(graph, { scope: around('gone.md', 1), filter: all })).toEqual({
      nodes: [],
      edges: [],
    });
  });
});

describe('withinReach', () => {
  it('is only the centre at depth 0', () => {
    expect([...withinReach(graph, createVaultPath('a.md'), 0)]).toEqual(['a.md']);
  });
});

describe('capGraph', () => {
  it('leaves a graph under the limit as it is', () => {
    expect(capGraph(graph, 50)).toEqual({ graph, hidden: 0 });
  });

  it('keeps the most connected notes, ties by path, and counts the rest', () => {
    const { graph: capped, hidden } = capGraph(graph, 3);
    // a and b are joined to three notes each; c and h to two, and c sorts first.
    expect(paths(capped)).toEqual(['a.md', 'b.md', 'c.md']);
    expect(capped.edges.map((edge) => edge.id)).toEqual(['link::a.md->b.md', 'link::b.md->c.md']);
    expect(hidden).toBe(4);
  });
});

describe('toggleGraphType and showsType', () => {
  const types = ['person', 'task', UNTYPED];

  it('hides one type out of every type', () => {
    const next = toggleGraphType(DEFAULT_GRAPH_FILTER, { type: 'task', all: types });
    expect(next.types).toEqual(['person', UNTYPED]);
    expect(showsType(next, 'task')).toBe(false);
    expect(showsType(next, 'person')).toBe(true);
    expect(next.hideSystem).toBe(true);
  });

  it('goes back to every type once each is chosen again', () => {
    const hidden = toggleGraphType(DEFAULT_GRAPH_FILTER, { type: 'task', all: types });
    expect(toggleGraphType(hidden, { type: 'task', all: types }).types).toBeNull();
  });

  it('shows every type while none are chosen', () => {
    expect(showsType(DEFAULT_GRAPH_FILTER, 'anything')).toBe(true);
  });
});

describe('graphTypes', () => {
  it('lists named types sorted, then no type when some note has none', () => {
    expect(graphTypes(graph)).toEqual(['person', 'project', 'task', UNTYPED]);
  });

  it('leaves out no type when every note has one', () => {
    const typed = { ...graph, nodes: graph.nodes.filter((node) => node.type !== null) };
    expect(graphTypes(typed)).toEqual(['person', 'project', 'task']);
  });
});
