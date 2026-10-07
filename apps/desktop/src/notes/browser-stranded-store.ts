import { parseStrandedEdit, type StrandedEdit, type VaultPath } from '@atlas/domain';
import type { StrandedEditStore } from './stranded-edits.ts';

const PREFIX = 'atlas.stranded:';

/**
 * One entry per note, under its vault. The vault is quoted, so one vault's key
 * can never be the start of another's: `"/a":` is not a prefix of `"/a:b":`.
 */
const vaultPrefix = (vaultKey: string): string => `${PREFIX}${JSON.stringify(vaultKey)}:`;
const entryKey = (vaultKey: string, path: VaultPath): string => `${vaultPrefix(vaultKey)}${path}`;

function keysUnder(storage: Storage, prefix: string): string[] {
  const keys: string[] = [];
  for (let at = 0; at < storage.length; at += 1) {
    const key = storage.key(at);
    if (key !== null && key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function parseEntry(stored: string | null): StrandedEdit | null {
  try {
    return parseStrandedEdit(JSON.parse(stored ?? 'null'));
  } catch {
    // Not JSON reads the same as JSON of the wrong shape: nothing kept.
    return null;
  }
}

function readEntry(storage: Storage, { key, vaultKey }: { key: string; vaultKey: string }) {
  const edit = parseEntry(storage.getItem(key));
  if (edit !== null && entryKey(vaultKey, edit.path) === key) return edit;
  // Nothing can ever be handed back from an entry that does not read, so it is
  // cleared rather than left to be skipped on every start.
  try {
    storage.removeItem(key);
  } catch {
    // Safe to ignore: it is skipped again next time, which costs a parse.
  }
  return null;
}

/**
 * Work a closing pane could not save, kept in `localStorage` so it survives a
 * quit.
 *
 * Not the vault: this is unsaved work that the vault, by definition, does not
 * have. Every access is guarded, as the other stores' are — the accessor itself
 * throws in a private window and wherever site data is blocked, a read can come
 * back with anything, and a document is large enough that a write can meet the
 * quota. Unlike the others, a refused write is reported rather than ignored:
 * the work is still held in memory, and whoever is watching is told it will
 * not outlast a quit.
 */
export const browserStrandedStore: StrandedEditStore = {
  read: (vaultKey) => {
    try {
      const storage = window.localStorage;
      return keysUnder(storage, vaultPrefix(vaultKey))
        .map((key) => readEntry(storage, { key, vaultKey }))
        .filter((edit): edit is StrandedEdit => edit !== null)
        .sort((a, b) => a.keptAt - b.keptAt);
    } catch {
      return [];
    }
  },
  put: ({ vaultKey, edit }) => {
    const key = entryKey(vaultKey, edit.path);
    try {
      window.localStorage.setItem(key, JSON.stringify(edit));
      return true;
    } catch {
      try {
        // An older copy of this note's work must not come back after a quit in
        // place of the newer one that could not be stored.
        window.localStorage.removeItem(key);
      } catch {
        // Safe to ignore: storage that refuses everything holds no older copy
        // that could be read back either.
      }
      return false;
    }
  },
  remove: ({ vaultKey, path }) => {
    try {
      window.localStorage.removeItem(entryKey(vaultKey, path));
    } catch {
      // Safe to ignore: work handed back twice is caught when it comes back —
      // the note will have been saved since, so its modification time has
      // moved and the pane asks before writing it over the file.
    }
  },
};
