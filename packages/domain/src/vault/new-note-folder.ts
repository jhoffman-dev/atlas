import { isArchivedPath } from '../archive/archive.ts';
import { isDashboard } from '../dashboard/dashboard.ts';
import { isSavedView } from '../query/saved-view.ts';
import { createVaultPath, parentVaultPath, VAULT_ROOT, type VaultPath } from './vault-path.ts';
import { DASHBOARDS_DIRECTORY, isAtlasNote, VIEWS_DIRECTORY } from './vault-visibility.ts';

/**
 * The folder a new note goes in, given the frontmatter it starts with.
 *
 * A dashboard or a saved view goes with the others of its kind, whatever is
 * open, and a note whose type has a home folder goes there (#214). Any other
 * note goes beside the one in view, which is where someone
 * writing usually wants the next one — unless that one is a note DFAI keeps
 * for itself, where nothing would list it, or an archived one, where the new
 * note would be archived as it was made — and at the root otherwise.
 */
export function newNoteFolder({
  beside,
  properties,
  home = null,
}: {
  beside: VaultPath | null;
  properties: Readonly<Record<string, unknown>>;
  /** The home folder of the note's type, for its day (`homeFolderOf`); null when it has none. */
  home?: VaultPath | null;
}): VaultPath {
  if (isDashboard(properties)) return createVaultPath(DASHBOARDS_DIRECTORY);
  if (isSavedView(properties)) return createVaultPath(VIEWS_DIRECTORY);
  if (home !== null) return home;
  if (beside === null || isAtlasNote(beside) || isArchivedPath(beside)) return VAULT_ROOT;
  return parentVaultPath(beside);
}
