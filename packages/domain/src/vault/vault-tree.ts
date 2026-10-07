import { isArtifactCopyFolder } from '../artifacts/artifact-copy-folder.ts';
import { ATTACHMENTS_FOLDER } from '../attachments/image-placement.ts';
import { isSystemFolder, isVisibleEntry } from './vault-visibility.ts';
import { isArchiveFolder } from '../archive/archive.ts';
import { compareNames } from './name-order.ts';
import { isWithin } from './vault-moves.ts';
import { VAULT_ROOT, vaultPathDepth, type VaultPath } from './vault-path.ts';
import { isMarkdownFile, type VaultEntry } from './vault-entry.ts';

/**
 * Directories sort above files, then by name the way Finder orders them.
 *
 * Three folders at the root are exceptions. `.atlas` goes last: it is the
 * vault's own machinery, still reachable, but not something to read past on
 * the way to your notes. The Archive goes just before it, and `attachments`,
 * where pasted images pile up, before that — after the root's notes too — so
 * each is there when wanted and out of the way when not. Like every folder
 * they start collapsed.
 */
export function sortVaultEntries(entries: readonly VaultEntry[]): VaultEntry[] {
  return [...entries].sort((left, right) => {
    if (lastRank(left) !== lastRank(right)) return lastRank(left) - lastRank(right);
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1;
    return compareNames(left.name, right.name);
  });
}

/** 0 for an ordinary entry; higher for the root folders that sort after everything else. */
function lastRank(entry: VaultEntry): number {
  if (isSystemFolder(entry)) return 3;
  if (isArchiveFolder(entry)) return 2;
  return entry.kind === 'directory' && entry.path === ATTACHMENTS_FOLDER ? 1 : 0;
}

/** Children are loaded lazily, one directory at a time, as the user expands them. */
export interface VaultTreeState {
  readonly children: ReadonlyMap<VaultPath, readonly VaultEntry[]>;
  readonly expanded: ReadonlySet<VaultPath>;
  /** Every note in the vault, when known: how a folder not yet read is seen to hold notes. */
  readonly notePaths?: readonly VaultPath[];
}

export interface VaultTreeRow {
  readonly entry: VaultEntry;
  readonly depth: number;
  readonly isExpanded: boolean;
  /** False for an expanded directory whose contents are still being read. */
  readonly isLoaded: boolean;
}

/**
 * Flattens the visible part of the tree into the row list a virtualiser needs.
 * Only expanded directories contribute children, so the cost tracks what is on
 * screen rather than the size of the vault.
 */
export function flattenVaultTree(state: VaultTreeState): VaultTreeRow[] {
  const rows: VaultTreeRow[] = [];
  const holdsNotes = (folder: VaultPath): boolean =>
    (state.children.get(folder)?.some(isMarkdownFile) ?? false) ||
    (state.notePaths ?? []).some((note) => isWithin(note, folder));

  const walk = (parent: VaultPath): void => {
    const entries = state.children.get(parent);
    if (entries === undefined) return;

    // An artifact's saved copy is left out: its note stands for it.
    const shown = entries.filter(
      (entry) => isVisibleEntry(entry) && !isArtifactCopyFolder(entry, entries, holdsNotes),
    );
    for (const entry of sortVaultEntries(shown)) {
      // The Archive never opens in place, so its thousands of notes are never walked here.
      const isExpanded =
        entry.kind === 'directory' && !isArchiveFolder(entry) && state.expanded.has(entry.path);
      rows.push({
        entry,
        depth: vaultPathDepth(entry.path) - 1,
        isExpanded,
        isLoaded: entry.kind === 'directory' ? state.children.has(entry.path) : true,
      });
      if (isExpanded) walk(entry.path);
    }
  };

  walk(VAULT_ROOT);
  return rows;
}
