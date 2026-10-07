// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createVaultPath, type GraphEdge, type GraphNode, type VaultGraph } from '@atlas/domain';
import { useForceLayout } from './use-force-layout.ts';

const node = (name: string, degree: number): GraphNode => ({
  path: createVaultPath(`${name}.md`),
  title: name,
  type: null,
  degree,
});

const edge = (from: string, to: string): GraphEdge => ({
  id: `${from}->${to}`,
  source: createVaultPath(`${from}.md`),
  target: createVaultPath(`${to}.md`),
  kind: 'link',
  label: null,
});

const threeNotes = (): VaultGraph => ({
  nodes: [node('a', 2), node('b', 1), node('c', 1)],
  edges: [edge('a', 'b'), edge('a', 'c')],
});

describe('useForceLayout', () => {
  // The index moves on with every save; a graph rebuilt with the same notes
  // and links must not restart the simulation, or the picture shudders while
  // someone types beside it.
  it('keeps its layout when handed a new graph with the same notes and links', () => {
    const { result, rerender } = renderHook(({ graph }) => useForceLayout(graph), {
      initialProps: { graph: threeNotes() },
    });
    const before = result.current.positions;
    expect(before.size).toBe(3);

    rerender({ graph: { ...threeNotes(), nodes: [...threeNotes().nodes].reverse() } });

    expect(result.current.positions).toBe(before);
  });

  it('keeps the notes it had where they were, and places only the new one', () => {
    const { result, rerender } = renderHook(({ graph }) => useForceLayout(graph), {
      initialProps: { graph: threeNotes() },
    });
    const before = result.current.positions;

    rerender({
      graph: {
        nodes: [node('a', 3), node('b', 1), node('c', 1), node('d', 1)],
        edges: [...threeNotes().edges, edge('a', 'd')],
      },
    });

    const after = result.current.positions;
    expect(after.size).toBe(4);
    for (const [id, point] of before) expect(after.get(id)).toEqual(point);
    const placed = after.get('d.md');
    expect(placed).toBeDefined();
    expect(Number.isFinite(placed?.x) && Number.isFinite(placed?.y)).toBe(true);
  });
});
