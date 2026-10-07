import {
  isMarkdownFile,
  isMarkdownName,
  noteTitle,
  type VaultEntry,
} from '../vault/vault-entry.ts';
import { parentVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { ARTIFACTS_FOLDER, artifactSlug } from './artifact.ts';

/**
 * Whether a folder is an artifact's saved copy, which Pages leaves out: a page
 * and its scripts are the artifact's insides, not notes to browse, and the
 * artifact is reached by its note.
 *
 * A copy is a folder in `artifacts/` named as the slug of a note beside it —
 * `artifacts/sales-deck/` beside `artifacts/Sales deck.md` — which is where
 * saving puts it. Judged from the folder's siblings, so the tree needs no read
 * to draw it. Only in `artifacts/`: elsewhere a folder named like a note beside
 * it is somebody's folder note, and stays. And never a folder that holds a
 * note: a copy cannot (`artifactFileRefusal` keeps markdown out), so one that
 * does is somebody's folder of notes that merely shares a name, and hiding it
 * would hide those notes. `holdsNotes` is asked only when the name matches.
 */
export function isArtifactCopyFolder(
  entry: VaultEntry,
  siblings: readonly VaultEntry[],
  holdsNotes: (folder: VaultPath) => boolean = () => false,
): boolean {
  if (entry.kind !== 'directory' || parentVaultPath(entry.path) !== ARTIFACTS_FOLDER) return false;
  const named = siblings.some(
    (sibling) => isMarkdownFile(sibling) && artifactSlug(noteTitle(sibling.path)) === entry.name,
  );
  return named && !holdsNotes(entry.path);
}

/**
 * Why a note's `saved` folder cannot take files written into it as the note's
 * copy, or null when it can. A copy sits beside its note, which is where
 * saving and dropping put it, and holds no notes — so a `saved` that names a
 * folder of notes (`Tasks`) or one elsewhere in the vault is not a place to
 * write files into, whatever the note says.
 */
export function savedCopyRefusal({
  notePath,
  folder,
  held,
}: {
  notePath: VaultPath;
  folder: VaultPath;
  /** The files already in `folder`, relative to it. */
  held: readonly string[];
}): string | null {
  if (parentVaultPath(folder) !== parentVaultPath(notePath)) {
    return `${folder} is not beside ${notePath}, so it is not its copy`;
  }
  if (held.some(isMarkdownName)) return `${folder} holds notes, so it is not an artifact's copy`;
  return null;
}
