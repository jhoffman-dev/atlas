import { isArchivedPath } from '../archive/archive.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import type { GraphEdge, VaultGraph } from './vault-graph.ts';

/** One note at the other end of a connection, and what the connection is. */
export interface NoteLinkEntry {
  readonly path: VaultPath;
  readonly title: string;
  /** The relation it comes through, by name; null for a wiki link in the body. */
  readonly via: string | null;
}

export interface NoteLinks {
  /** Notes that point at this one — by a link in their body or a relation. */
  readonly incoming: readonly NoteLinkEntry[];
  /** Notes this one points at. */
  readonly outgoing: readonly NoteLinkEntry[];
}

export const NO_LINKS: NoteLinks = { incoming: [], outgoing: [] };

/**
 * What a note is connected to, both ways, for the foot of the note.
 *
 * Read from the same graph the graph page draws, so the two never disagree.
 * Sorted by title, then plain links before relations, so a note linked both
 * ways reads as one group. A note in the Archive that links here is left out
 * unless `includeArchived` asks for it: it is out of the way (U-22), and the
 * link it holds is not one anyone is still following.
 */
export function noteLinks(
  graph: VaultGraph,
  path: VaultPath,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): NoteLinks {
  const titles = new Map<string, string>(graph.nodes.map((node) => [node.path, node.title]));
  const entry = (edge: GraphEdge, other: VaultPath): NoteLinkEntry => ({
    path: other,
    title: titles.get(other) ?? other,
    via: edge.label,
  });

  return {
    incoming: sorted(
      graph.edges
        .filter((edge) => edge.target === path)
        .filter((edge) => includeArchived || !isArchivedPath(edge.source))
        .map((edge) => entry(edge, edge.source)),
    ),
    outgoing: sorted(
      graph.edges.filter((edge) => edge.source === path).map((edge) => entry(edge, edge.target)),
    ),
  };
}

function sorted(entries: NoteLinkEntry[]): NoteLinkEntry[] {
  return entries.sort(
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.path.localeCompare(right.path) ||
      (left.via ?? '').localeCompare(right.via ?? ''),
  );
}

/** How the foot of a note counts its connections: "3 linked here · 1 linked from here". */
export function noteLinksLabel(links: NoteLinks): string {
  const incoming = links.incoming.length;
  const outgoing = links.outgoing.length;
  if (incoming === 0 && outgoing === 0) return 'No links yet';
  return `${incoming} linked here · ${outgoing} linked from here`;
}
