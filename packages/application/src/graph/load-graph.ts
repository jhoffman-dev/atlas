import {
  buildVaultGraph,
  capGraph,
  compileGraphQuery,
  createVaultPath,
  scopeGraph,
  GRAPH_PAGE_SIZE,
  type GraphFilter,
  type GraphQueryPart,
  type GraphScope,
  type NamedNote,
  type VaultGraph,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

/**
 * Past this many notes the graph page draws the most connected and says how
 * many it left out: an SVG force layout stays smooth to a few hundred.
 */
export const GRAPH_NODE_LIMIT = 600;

/** A row as the index returns it, read by column name. */
type Row = Readonly<Record<string, unknown>>;

/**
 * Every note, link and relation in the index, as the graph they make.
 *
 * Three questions of the index's own tables, each paged under the host's row
 * cap, so a large vault is read whole rather than quietly cut short.
 */
export async function readVaultGraph({ index }: { index: IndexPort }): Promise<VaultGraph> {
  const [notes, links, relations] = await Promise.all([
    readAll(index, 'notes'),
    readAll(index, 'links'),
    readAll(index, 'relations'),
  ]);
  return buildVaultGraph({
    notes: notes.map((row) => ({
      path: text(row['path']),
      title: text(row['title']),
      type: row['type'] === null || row['type'] === undefined ? null : text(row['type']),
    })),
    links: links.map((row) => ({ source: text(row['source']), target: text(row['target']) })),
    relations: relations.map((row) => ({
      source: text(row['source']),
      key: text(row['key']),
      value: text(row['value']),
    })),
  });
}

/**
 * Every note's path and title in user space: what a query's relation groups
 * are named by (`noteNames`). A note in `.atlas` or a hidden folder is not
 * listed, so a link to one reads as its bare name.
 */
export async function readNamedNotes({ index }: { index: IndexPort }): Promise<NamedNote[]> {
  const notes = await readAll(index, 'namedNotes');
  return notes.map((row) => ({
    path: createVaultPath(text(row['path'])),
    title: text(row['title']),
  }));
}

async function readAll(index: IndexPort, part: GraphQueryPart): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; ; page += 1) {
    const { sql, parameters } = compileGraphQuery(part, page);
    const result = await index.query(sql, parameters);
    const named = result.rows.map((values) =>
      Object.fromEntries(result.columns.map((column, at) => [column, values[at]])),
    );
    rows.push(...named);
    if (named.length < GRAPH_PAGE_SIZE && !result.truncated) return rows;
  }
}

const text = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

export interface GraphPicture {
  readonly graph: VaultGraph;
  /** How many notes matched but were left out to keep the page responsive. */
  readonly hidden: number;
}

/**
 * The graph a person asked to see: the vault or the notes around one, through
 * the filters, capped at what the page can draw.
 */
export function pictureGraph(
  graph: VaultGraph,
  {
    scope,
    filter,
    limit = GRAPH_NODE_LIMIT,
  }: { scope: GraphScope; filter: GraphFilter; limit?: number },
): GraphPicture {
  return capGraph(scopeGraph(graph, { scope, filter }), limit);
}

/** Reads the graph from the index and pictures it, in one step. */
export async function loadGraph({
  index,
  scope,
  filter,
  limit,
}: {
  index: IndexPort;
  scope: GraphScope;
  filter: GraphFilter;
  limit?: number;
}): Promise<GraphPicture> {
  const graph = await readVaultGraph({ index });
  return pictureGraph(graph, { scope, filter, ...(limit !== undefined && { limit }) });
}
