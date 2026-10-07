import { humanizeKey } from '../page/property-label.ts';
import { resolveWikiLinkTarget } from '../markdown/resolve-wikilink.ts';
import { splitWikiLinks } from '../markdown/wikilink.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { isTemplateNote } from '../vault/vault-visibility.ts';

/** A note as the index lists it, for the graph. */
export interface GraphNoteRow {
  readonly path: string;
  readonly title: string;
  readonly type: string | null;
}

/** A wiki link in a note's body that resolved to another note. */
export interface GraphLinkRow {
  readonly source: string;
  readonly target: string;
}

/** A frontmatter value written as a wiki link: a relation, whatever the type calls it. */
export interface GraphRelationRow {
  readonly source: string;
  readonly key: string;
  readonly value: string;
}

/** `link` is a `[[wikilink]]` in the body; `relation` is one held in a property. */
export type GraphEdgeKind = 'link' | 'relation';

export interface GraphNode {
  readonly path: VaultPath;
  readonly title: string;
  readonly type: string | null;
  /** How many other notes it is joined to, either way, by anything. */
  readonly degree: number;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: VaultPath;
  readonly target: VaultPath;
  readonly kind: GraphEdgeKind;
  /** The relation's name, as a person reads it; null for a plain link. */
  readonly label: string | null;
}

export interface VaultGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export const EMPTY_GRAPH: VaultGraph = { nodes: [], edges: [] };

/**
 * The vault as notes and the connections between them.
 *
 * A note linking to itself is no connection, and a link to a note that does
 * not exist has nothing to join, so both are left out. The same link written
 * twice is one edge; a link and a relation between the same two notes are two,
 * since they say different things. A relation is read the way the editor reads
 * a link, so `[[today]]` and `[[Today]]` reach the same note.
 */
export function buildVaultGraph({
  notes,
  links,
  relations,
}: {
  notes: readonly GraphNoteRow[];
  links: readonly GraphLinkRow[];
  relations: readonly GraphRelationRow[];
}): VaultGraph {
  // A template is never one of the vault's notes (ADR-0026), even in rows an
  // index built before it was hidden still holds: a link to it would open it.
  const vaultNotes = notes.filter((note) => !isTemplateNote(note.path));
  const known = new Map(vaultNotes.map((note) => [note.path, note]));
  const paths = [...known.keys()].map(createVaultPath);
  const edges = new Map<string, GraphEdge>();

  const add = (edge: Omit<GraphEdge, 'id'>) => {
    if (edge.source === edge.target) return;
    if (!known.has(edge.source) || !known.has(edge.target)) return;
    const id = `${edge.kind}:${edge.label ?? ''}:${edge.source}->${edge.target}`;
    if (!edges.has(id)) edges.set(id, { id, ...edge });
  };

  for (const link of links) {
    add({
      source: link.source as VaultPath,
      target: link.target as VaultPath,
      kind: 'link',
      label: null,
    });
  }
  for (const relation of relations) {
    for (const target of relationTargetsOf(relation.value)) {
      const resolved = resolveWikiLinkTarget(target, paths);
      if (resolved === null) continue;
      const label = humanizeKey(relation.key);
      add({ source: relation.source as VaultPath, target: resolved, kind: 'relation', label });
    }
  }

  const sortedEdges = [...edges.values()].sort((left, right) => left.id.localeCompare(right.id));
  return { nodes: nodesWithDegree(vaultNotes, sortedEdges), edges: sortedEdges };
}

function relationTargetsOf(value: string): string[] {
  return splitWikiLinks(value.trim()).flatMap((piece) =>
    piece.kind === 'wikiLink' ? [piece.target] : [],
  );
}

function nodesWithDegree(notes: readonly GraphNoteRow[], edges: readonly GraphEdge[]): GraphNode[] {
  const neighbours = neighboursOf(edges);
  return notes
    .map((note) => ({
      path: createVaultPath(note.path),
      title: note.title,
      type: note.type === null || note.type.trim() === '' ? null : note.type.trim(),
      degree: neighbours.get(note.path)?.size ?? 0,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

/** Who each note is joined to, whichever way the edge points. */
export function neighboursOf(edges: readonly GraphEdge[]): Map<string, Set<VaultPath>> {
  const found = new Map<string, Set<VaultPath>>();
  const join = (from: VaultPath, to: VaultPath) => {
    const set = found.get(from) ?? new Set<VaultPath>();
    set.add(to);
    found.set(from, set);
  };
  for (const edge of edges) {
    join(edge.source, edge.target);
    join(edge.target, edge.source);
  }
  return found;
}
