import { LIBRARY_SCOPE, type ReadScope } from '../reads/scoped-reads.ts';
import type { LibraryRead } from './load-research.ts';

/**
 * What the Library is made from once it has read (#507): `LIBRARY_SCOPE`,
 * the notes its sources are filed under, whatever their type, and the names
 * their unresolved `project:` links wait for. A source's `project:` can
 * resolve to an untyped note, whose title the row shows; that note's
 * retitle, move or deletion — or a note made with a name a link was waiting
 * for — re-resolves the row in the index without changing the source, so
 * only the note's own path, or its name, says so in the news.
 */
export function libraryScope(read: Pick<LibraryRead, 'entries'> | undefined): ReadScope {
  const notes = new Set<string>();
  const linkedNames = new Set<string>();
  for (const entry of read?.entries ?? []) {
    for (const project of entry.projects) {
      if (project.path === null) linkedNames.add(project.name);
      else notes.add(project.path);
    }
  }
  if (notes.size === 0 && linkedNames.size === 0) return LIBRARY_SCOPE;
  return { ...LIBRARY_SCOPE, notes: [...notes], linkedNames: [...linkedNames] };
}
