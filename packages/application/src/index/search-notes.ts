import { ARCHIVE_PREFIX, isTemplateNote } from '@dfai/domain';
import type { IndexPort, SearchHit, SearchScope } from './ports.ts';

/**
 * What a search reaches: the notes in use, or the archived ones as well.
 * Archived notes are out of the way unless asked for (U-22).
 */
export function searchScope({ includeArchived }: { includeArchived: boolean }): SearchScope {
  return includeArchived ? {} : { skipPrefix: ARCHIVE_PREFIX };
}

/**
 * Full-text search over the vault, leaving the Archive out unless it is asked
 * for. A template is never a hit (ADR-0026), even from an index that read it
 * before templates left the vault's notes. With `highlights`, the highlights
 * in literature notes whose quote or comment match follow the notes (#507),
 * each naming its block.
 */
export async function searchNotes({
  index,
  query,
  limit,
  includeArchived,
  highlights = false,
}: {
  index: IndexPort;
  query: string;
  limit: number;
  includeArchived: boolean;
  highlights?: boolean;
}): Promise<readonly SearchHit[]> {
  const scope = searchScope({ includeArchived });
  const hits = await index.search(query, limit, highlights ? { ...scope, highlights } : scope);
  return hits.filter((hit) => !isTemplateNote(hit.path));
}
