import { compileNoteFacetsQuery, FACET_CHECK_LIMIT, type FacetRow } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

/**
 * What the index holds of each facet for these notes, or null when that
 * cannot be told: too many notes to be worth asking, an answer cut short, or
 * an index that would not answer. Null is read as "everything changed".
 */
export async function readNoteFacets({
  index,
  paths,
}: {
  index: IndexPort;
  paths: readonly string[];
}): Promise<FacetRow[] | null> {
  if (paths.length > FACET_CHECK_LIMIT) return null;
  const { sql, parameters } = compileNoteFacetsQuery(paths);
  try {
    const result = await index.query(sql, parameters);
    if (result.truncated) return null;
    return result.rows.map(
      (values) =>
        Object.fromEntries(
          result.columns.map((column, at) => [column, values[at] ?? null]),
        ) as unknown as FacetRow,
    );
  } catch {
    // Unknown, not failed: the caller reads every facet again, which is always safe.
    return null;
  }
}
