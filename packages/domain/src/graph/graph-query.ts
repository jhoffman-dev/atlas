import type { CompiledQuery } from '../query/view-query.ts';
import { userSpaceNoteSql } from '../vault/vault-visibility.ts';

/**
 * How many rows each page of a graph query asks for. The host refuses to hand
 * back more than 5,000 at once, so a page is exactly that and the next page is
 * asked for until one comes back short.
 */
export const GRAPH_PAGE_SIZE = 5000;

/** The part of the graph a query reads. Each statement is marked with it. */
export type GraphQueryPart = 'notes' | 'namedNotes' | 'links' | 'relations';

const STATEMENTS: Readonly<Record<GraphQueryPart, string>> = {
  // A note's type is its first `type` value; the columns are path, title, type.
  notes: `/* graph:notes */ SELECT files.path AS "path", files.title AS "title",
        (SELECT props.value_text FROM props
          WHERE props.path = files.path AND props.key = ? ORDER BY props.idx LIMIT 1) AS "type"
 FROM files ORDER BY files.path LIMIT ? OFFSET ?`,
  // What a query's relation groups are named by: the vault's own notes only,
  // so a group never carries the title of a note in `.atlas` or a hidden folder.
  namedNotes: `/* graph:namedNotes */ SELECT files.path AS "path", files.title AS "title"
 FROM files WHERE ${userSpaceNoteSql('files.path')} ORDER BY files.path LIMIT ? OFFSET ?`,
  // Only links that resolved: one pointing nowhere has no note to join.
  links: `/* graph:links */ SELECT links.src AS "source", links.dst AS "target"
 FROM links WHERE links.dst IS NOT NULL AND links.kind = ?
 ORDER BY links.src, links.dst LIMIT ? OFFSET ?`,
  // Every property written as a wiki link, whatever its type calls it.
  relations: `/* graph:relations */ SELECT props.path AS "source", props.key AS "key",
        props.value_text AS "value"
 FROM props WHERE props.value_text LIKE ? AND props.key <> ?
 ORDER BY props.path, props.key, props.idx LIMIT ? OFFSET ?`,
};

const BOUND: Readonly<Record<GraphQueryPart, readonly string[]>> = {
  notes: ['type'],
  namedNotes: [],
  links: ['wikilink'],
  // `type` names the note's kind, not a note it points at.
  relations: ['[[%]]%', 'type'],
};

/**
 * One page of one part of the graph, asked of the index's tables directly.
 *
 * Nothing in the text comes from a note: the only values are the key names and
 * the page, and they are bound.
 */
export function compileGraphQuery(part: GraphQueryPart, page: number): CompiledQuery {
  return {
    sql: STATEMENTS[part],
    parameters: [...BOUND[part], GRAPH_PAGE_SIZE, page * GRAPH_PAGE_SIZE],
  };
}
