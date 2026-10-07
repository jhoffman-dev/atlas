import { ARCHIVE_PREFIX, isTemplateNote } from '@atlas/domain';
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
 * before templates left the vault's notes.
 */
export async function searchNotes({
  index,
  query,
  limit,
  includeArchived,
}: {
  index: IndexPort;
  query: string;
  limit: number;
  includeArchived: boolean;
}): Promise<readonly SearchHit[]> {
  const hits = await index.search(query, limit, searchScope({ includeArchived }));
  return hits.filter((hit) => !isTemplateNote(hit.path));
}
