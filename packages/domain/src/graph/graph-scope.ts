import { isAtlasNote } from '../vault/vault-visibility.ts';
import { isArchivedPath } from '../archive/archive.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { neighboursOf, type GraphNode, type VaultGraph } from './vault-graph.ts';

/** How far from the centre a local graph reaches: its neighbours, or theirs too. */
export type GraphDepth = 1 | 2;

/** The whole vault, or the notes around one. */
export type GraphScope =
  | { readonly kind: 'vault' }
  | { readonly kind: 'note'; readonly path: VaultPath; readonly depth: GraphDepth };

/** Stands for "no type" among the types a graph shows. */
export const UNTYPED = '';

export interface GraphFilter {
  /** The types to show, `UNTYPED` among them for notes without one; null shows every note. */
  readonly types: readonly string[] | null;
  readonly hideOrphans: boolean;
  /** Atlas's own notes — types, templates, views — which say little about the vault. */
  readonly hideSystem: boolean;
  /** Notes put away in the Archive, which are out of the way unless asked for (U-22). */
  readonly hideArchived: boolean;
}

export const DEFAULT_GRAPH_FILTER: GraphFilter = {
  types: null,
  hideOrphans: false,
  hideSystem: true,
  hideArchived: true,
};

/**
 * The part of the graph a person asked to see.
 *
 * Filters first, then the reach from the centre, then orphans — so a local
 * graph never walks through a note it was told to hide, and a note is only an
 * orphan for what is left on screen. The centre of a local graph is always
 * shown, whatever the filters say: it is the point of the page.
 */
export function scopeGraph(
  graph: VaultGraph,
  { scope, filter }: { scope: GraphScope; filter: GraphFilter },
): VaultGraph {
  const centre = scope.kind === 'note' ? scope.path : null;
  const kept = graph.nodes.filter((node) => node.path === centre || passes(node, filter));
  let visible = restrict(graph, new Set(kept.map((node) => node.path)));

  if (scope.kind === 'note') {
    if (!visible.nodes.some((node) => node.path === scope.path)) return { nodes: [], edges: [] };
    visible = restrict(visible, withinReach(visible, scope.path, scope.depth));
  }
  if (filter.hideOrphans) visible = withoutOrphans(visible, centre);
  return visible;
}

function passes(node: GraphNode, filter: GraphFilter): boolean {
  if (filter.hideSystem && isAtlasNote(node.path)) return false;
  if (filter.hideArchived && isArchivedPath(node.path)) return false;
  if (filter.types === null) return true;
  return filter.types.includes(node.type ?? UNTYPED);
}

/** The graph with only these notes, and only the edges between two of them. */
function restrict(graph: VaultGraph, keep: ReadonlySet<string>): VaultGraph {
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.path)),
    edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
  };
}

/** Breadth first from the centre, following edges either way, `depth` steps out. */
export function withinReach(graph: VaultGraph, centre: VaultPath, depth: number): Set<VaultPath> {
  const neighbours = neighboursOf(graph.edges);
  const reached = new Set<VaultPath>([centre]);
  let frontier: VaultPath[] = [centre];
  for (let step = 0; step < depth; step += 1) {
    const next: VaultPath[] = [];
    for (const path of frontier) {
      for (const neighbour of neighbours.get(path) ?? []) {
        if (reached.has(neighbour)) continue;
        reached.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return reached;
}

function withoutOrphans(graph: VaultGraph, centre: VaultPath | null): VaultGraph {
  const joined = new Set<string>(graph.edges.flatMap((edge) => [edge.source, edge.target]));
  if (centre !== null) joined.add(centre);
  return restrict(graph, joined);
}

/**
 * At most `limit` notes, the most connected first.
 *
 * A force layout drawn in SVG stays responsive to a few hundred notes; past
 * that the page would stall, so it draws the part that carries the structure
 * and says how many it left out. Ties go to the path, so the cut never moves
 * between two renders of the same vault.
 */
export function capGraph(graph: VaultGraph, limit: number): { graph: VaultGraph; hidden: number } {
  if (graph.nodes.length <= limit) return { graph, hidden: 0 };
  const kept = [...graph.nodes]
    .sort((left, right) => right.degree - left.degree || left.path.localeCompare(right.path))
    .slice(0, limit);
  return {
    graph: restrict(graph, new Set(kept.map((node) => node.path))),
    hidden: graph.nodes.length - kept.length,
  };
}

/** Whether a type's notes are shown: every type is, until types are chosen. */
export function showsType(filter: GraphFilter, type: string): boolean {
  return filter.types === null || filter.types.includes(type);
}

/**
 * The filter with one type's chip flipped. Choosing again every type there is
 * goes back to "every type", so a type that appears later is shown too.
 */
export function toggleGraphType(
  filter: GraphFilter,
  { type, all }: { type: string; all: readonly string[] },
): GraphFilter {
  const shown = filter.types ?? all;
  const next = shown.includes(type) ? shown.filter((each) => each !== type) : [...shown, type];
  const everything = all.every((each) => next.includes(each));
  return { ...filter, types: everything ? null : next };
}

/** The types a graph's notes carry, for its chips: named ones sorted, then "no type" if any. */
export function graphTypes(graph: VaultGraph): string[] {
  const named = new Set<string>();
  let untyped = false;
  for (const node of graph.nodes) {
    if (node.type === null) untyped = true;
    else named.add(node.type);
  }
  const sorted = [...named].sort((left, right) => left.localeCompare(right));
  return untyped ? [...sorted, UNTYPED] : sorted;
}
