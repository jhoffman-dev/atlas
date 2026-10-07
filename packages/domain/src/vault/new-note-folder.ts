import { isArchivedPath } from '../archive/archive.ts';
import { isDashboard } from '../dashboard/dashboard.ts';
import { isSavedView } from '../query/saved-view.ts';
import { createVaultPath, parentVaultPath, VAULT_ROOT, type VaultPath } from './vault-path.ts';
import { DASHBOARDS_DIRECTORY, isAtlasNote, VIEWS_DIRECTORY } from './vault-visibility.ts';

/**
 * The folder a new note goes in, given the frontmatter it starts with.
 *
 * A dashboard or a saved view goes with the others of its kind, whatever is
 * open. Any other note goes beside the one in view, which is where someone
 * writing usually wants the next one — unless that one is a note Atlas keeps
 * for itself, where nothing would list it, or an archived one, where the new
 * note would be archived as it was made — and at the root otherwise.
 */
export function newNoteFolder({
  beside,
  properties,
}: {
  beside: VaultPath | null;
  properties: Readonly<Record<string, unknown>>;
}): VaultPath {
  if (isDashboard(properties)) return createVaultPath(DASHBOARDS_DIRECTORY);
  if (isSavedView(properties)) return createVaultPath(VIEWS_DIRECTORY);
  if (beside === null || isAtlasNote(beside) || isArchivedPath(beside)) return VAULT_ROOT;
  return parentVaultPath(beside);
}
