import {
  INDEX_FACETS,
  TEMPLATES_DIRECTORY,
  TYPES_DIRECTORY,
  type IndexFacet,
  type NoteChange,
} from '@atlas/domain';

/**
 * A whole-vault read the window keeps until something it is made from
 * changes (ADR-0040): the graph and the tags from the index, the type
 * definitions and the templates from their folders.
 */
export type VaultRead = IndexFacet | 'types' | 'templates';

export const VAULT_READS: readonly VaultRead[] = [...INDEX_FACETS, 'types', 'templates'];

/** The folders the file reads list, each with the read made from it. */
const FOLDER_READS: readonly (readonly [string, VaultRead])[] = [
  [TYPES_DIRECTORY, 'types'],
  [TEMPLATES_DIRECTORY, 'templates'],
];

/**
 * Whether a change at `path` can reach what is listed in `folder`: a file in
 * it, the folder itself, or a folder holding it (moving `.atlas` moves both).
 * Case aside, as the Mac's disk reads a folder's name.
 */
function reaches(path: string, folder: string): boolean {
  const at = path.toLowerCase().replace(/\/+$/, '');
  const within = folder.toLowerCase();
  return at === within || at.startsWith(`${within}/`) || at === '' || within.startsWith(`${at}/`);
}

/**
 * The file reads a change at these paths makes stale: what another program
 * wrote, as the watcher reports it, or what the app wrote itself. Only the
 * folders the types and the templates are listed from count. The graph and
 * the tags are the index's, and a change reaches them only once the index has
 * taken it in, which `reportingIndexWrites` says.
 */
export function readsTouchedByPaths(paths: readonly string[]): ReadonlySet<VaultRead> {
  return new Set(
    FOLDER_READS.filter(([folder]) => paths.some((path) => reaches(path, folder))).map(
      ([, read]) => read,
    ),
  );
}

/**
 * The file reads a sync of the index found changes to: a type definition is
 * a note the index holds, so a change to one shows up here even when the
 * watcher missed it.
 */
export function readsTouchedByNoteChanges(changes: readonly NoteChange[]): ReadonlySet<VaultRead> {
  return readsTouchedByPaths(changes.map((change) => change.path));
}
