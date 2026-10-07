import { noteTitle, type VaultEntry } from '../vault/vault-entry.ts';
import { isSystemFolder } from '../vault/vault-visibility.ts';
import { ARCHIVE_DIRECTORY, isArchiveFolder } from '../archive/archive.ts';

/** What the `.atlas` folder is called on screen. */
export const SYSTEM_FOLDER_LABEL = 'System';

/**
 * The name a row in Pages shows.
 *
 * A note is its title, without the extension — the extension is how the file
 * is stored, not what it is called. `.atlas` is "System": a dot-folder name is
 * an implementation detail, and what it holds is the vault's own machinery.
 * The Archive is "Archive" however the disk spells it, since it is one place
 * and not a folder of notes to read through. Anything else, a folder or an
 * attachment, keeps the name it has on disk.
 */
export function treeEntryLabel(entry: VaultEntry): string {
  if (isSystemFolder(entry)) return SYSTEM_FOLDER_LABEL;
  if (isArchiveFolder(entry)) return ARCHIVE_DIRECTORY;
  return entry.kind === 'file' ? noteTitle(entry.path) : entry.name;
}

/**
 * The letter on the vault's tile: the first letter or digit of its name,
 * upper-cased. A name with neither — all punctuation, or empty — gets a
 * neutral mark rather than a stray symbol.
 */
export function vaultInitial(vaultName: string): string {
  const first = [...vaultName].find((character) => /[\p{L}\p{N}]/u.test(character));
  return first === undefined ? '·' : first.toLocaleUpperCase();
}
