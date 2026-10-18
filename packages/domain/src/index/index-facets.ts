import type { CompiledQuery } from '../query/view-query.ts';

/**
 * A part of the index a whole-vault read is made from: `graph` is each note's
 * title, its type and the properties written as links, and the wiki links that
 * resolved (what the graph queries read); `tags` is each use of a tag (what the
 * tag counts read).
 */
export type IndexFacet = 'graph' | 'tags';

export const INDEX_FACETS: readonly IndexFacet[] = ['graph', 'tags'];

/**
 * The most notes one write is checked for, before and after. A write of more
 * (a build, a rebuild, a sync pull) is taken to have changed every facet
 * unread: checking would cost more than reading the vault again.
 */
export const FACET_CHECK_LIMIT = 50;

/** One row of what a note holds of a facet. Values are as the index answers them. */
export interface FacetRow {
  readonly facet: IndexFacet;
  readonly path: string;
  readonly part: string;
  readonly a: unknown;
  readonly b: unknown;
  readonly c: unknown;
}

/**
 * Every row these notes hold of each facet: exactly the columns the graph's
 * and the tag counts' statements read, for these paths only. The index writes
 * a note's rows and nobody else's, so these are all a write of them can change.
 */
export function compileNoteFacetsQuery(paths: readonly string[]): CompiledQuery {
  const marks = paths.map(() => '?').join(', ');
  const sql = `/* index facets */ SELECT 'graph' AS "facet", files.path AS "path", 'title' AS "part",
        files.title AS "a", NULL AS "b", NULL AS "c" FROM files WHERE files.path IN (${marks})
 UNION ALL SELECT 'graph', props.path, 'prop', props.key, props.idx, props.value_text
 FROM props WHERE props.path IN (${marks}) AND (props.key = ? OR props.value_text LIKE ?)
 UNION ALL SELECT 'graph', links.src, 'link', links.dst, NULL, NULL
 FROM links WHERE links.src IN (${marks}) AND links.kind = ? AND links.dst IS NOT NULL
 UNION ALL SELECT 'tags', tags.path, 'tag', tags.tag, tags.idx, tags.name
 FROM tags WHERE tags.path IN (${marks})`;
  return {
    sql,
    parameters: [...paths, ...paths, 'type', '[[%]]%', ...paths, 'wikilink', ...paths],
  };
}

/**
 * Which facets a write of `paths` changed, from what the index held of them
 * before and after it. Unknown either side (null) is every facet. So is an
 * answer after the write that is missing a note it wrote: whatever was asked
 * did not reach those notes, and nothing can be told from it.
 */
export function facetsChangedBetween({
  paths,
  before,
  after,
}: {
  paths: readonly string[];
  before: readonly FacetRow[] | null;
  after: readonly FacetRow[] | null;
}): ReadonlySet<IndexFacet> {
  if (before === null || after === null || !holdsEvery(after, paths)) return new Set(INDEX_FACETS);
  return new Set(
    INDEX_FACETS.filter((facet) => canonical(before, facet) !== canonical(after, facet)),
  );
}

function holdsEvery(rows: readonly FacetRow[], paths: readonly string[]): boolean {
  const titled = new Set(rows.filter((row) => row.part === 'title').map((row) => row.path));
  return paths.every((path) => titled.has(path));
}

/** The facet's rows in one order, whatever order the index answered them in. */
function canonical(rows: readonly FacetRow[], facet: IndexFacet): string {
  return JSON.stringify(
    rows
      .filter((row) => row.facet === facet)
      .map((row) => JSON.stringify([row.path, row.part, row.a, row.b, row.c]))
      .sort(),
  );
}
