import { describe, expect, it } from 'vitest';
import { buildVaultGraph, type GraphNoteRow } from './vault-graph.ts';

const note = (path: string, type: string | null = null): GraphNoteRow => ({
  path,
  title: path.replace(/\.md$/, '').split('/').at(-1) ?? path,
  type,
});

const notes = [note('a.md', 'task'), note('b.md'), note('c.md', 'project'), note('d.md')];

describe('buildVaultGraph', () => {
  it('draws one edge per pair a note links, however many times the link is written', () => {
    const graph = buildVaultGraph({
      notes,
      links: [
        { source: 'a.md', target: 'b.md' },
        { source: 'a.md', target: 'b.md' },
      ],
      relations: [],
    });
    expect(graph.edges).toEqual([
      { id: 'link::a.md->b.md', source: 'a.md', target: 'b.md', kind: 'link', label: null },
    ]);
  });

  it('keeps a link and a relation between the same two notes apart', () => {
    const graph = buildVaultGraph({
      notes,
      links: [{ source: 'a.md', target: 'c.md' }],
      relations: [{ source: 'a.md', key: 'project', value: '[[c]]' }],
    });
    expect(graph.edges.map((edge) => [edge.kind, edge.label])).toEqual([
      ['link', null],
      ['relation', 'Project'],
    ]);
  });

  it('resolves a relation the way a link resolves, whatever its case', () => {
    const graph = buildVaultGraph({
      notes,
      links: [],
      relations: [{ source: 'a.md', key: 'blocked_by', value: '[[C]]' }],
    });
    expect(graph.edges).toEqual([
      {
        id: 'relation:Blocked by:a.md->c.md',
        source: 'a.md',
        target: 'c.md',
        kind: 'relation',
        label: 'Blocked by',
      },
    ]);
  });

  it('leaves out a note linking itself, and links to notes that do not exist', () => {
    const graph = buildVaultGraph({
      notes,
      links: [
        { source: 'a.md', target: 'a.md' },
        { source: 'a.md', target: 'ghost.md' },
      ],
      relations: [
        { source: 'b.md', key: 'owner', value: '[[Nobody]]' },
        { source: 'b.md', key: 'owner', value: 'plain words' },
      ],
    });
    expect(graph.edges).toEqual([]);
  });

  it('sizes a note by how many notes it is joined to, either way', () => {
    const graph = buildVaultGraph({
      notes,
      links: [
        { source: 'a.md', target: 'b.md' },
        { source: 'b.md', target: 'a.md' },
        { source: 'c.md', target: 'a.md' },
      ],
      relations: [{ source: 'd.md', key: 'x', value: '[[a]]' }],
    });
    const degree = Object.fromEntries(graph.nodes.map((node) => [node.path, node.degree]));
    expect(degree).toEqual({ 'a.md': 3, 'b.md': 1, 'c.md': 1, 'd.md': 1 });
  });

  it('treats an empty type as no type', () => {
    const graph = buildVaultGraph({ notes: [note('a.md', '  ')], links: [], relations: [] });
    expect(graph.nodes[0]?.type).toBeNull();
  });

  it('reads every link in a relation that holds several', () => {
    const graph = buildVaultGraph({
      notes,
      links: [],
      relations: [{ source: 'a.md', key: 'related', value: '[[b]] [[d]]' }],
    });
    expect(graph.edges.map((edge) => edge.target)).toEqual(['b.md', 'd.md']);
  });
});
