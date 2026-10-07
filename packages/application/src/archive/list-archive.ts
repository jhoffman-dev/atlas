import {
  archivedNote,
  ARCHIVE_LIST_LIMIT,
  compileArchiveQuery,
  createVaultPath,
  type ArchivedNote,
} from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';

/** The Archive's rows, and whether there were more than it lists. */
export interface ArchiveListing {
  readonly notes: readonly ArchivedNote[];
  readonly truncated: boolean;
}

/**
 * The archived notes whose title or path holds every word of `search`, most
 * recently archived first, read from the index — the Archive never walks the
 * folder itself, however many notes it holds.
 */
export async function listArchive({
  index,
  search,
  limit = ARCHIVE_LIST_LIMIT,
  offset = 0,
}: {
  index: IndexPort;
  search: string;
  limit?: number;
  /** How many matching rows to skip, for a caller that pages. */
  offset?: number;
}): Promise<ArchiveListing> {
  // One more than is shown, so a full page is told apart from a cut-off one.
  const { sql, parameters } = compileArchiveQuery({ search, limit: limit + 1, offset });
  const result = await index.query(sql, parameters);
  const cell = (row: readonly unknown[], name: string) => row[result.columns.indexOf(name)];
  const notes = result.rows.map((row) =>
    archivedNote({
      path: createVaultPath(String(cell(row, 'path'))),
      title: String(cell(row, 'title') ?? ''),
      properties: { archived: cell(row, 'archived'), archivedFrom: cell(row, 'archivedFrom') },
    }),
  );
  return {
    notes: notes.slice(0, limit),
    truncated: result.truncated || notes.length > limit,
  };
}
