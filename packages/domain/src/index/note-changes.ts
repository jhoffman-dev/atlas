import { isArchiveMove } from '../archive/archive.ts';
import { createVaultPath } from '../vault/vault-path.ts';

/**
 * A note as it was when the index last read it: enough to tell whether it has
 * changed since, and to say what it was once it has gone (P28-03).
 */
export interface NoteVersion {
  /** The type its frontmatter declares, or null when it declares none. */
  readonly type: string | null;
  /** FNV-1a of its whole text (`digestOf`, ADR-0012). */
  readonly digest: string;
}

export type NoteChangeKind = 'added' | 'changed' | 'removed';

/** What happened to one note between two looks at the vault. A removed note is as it last was. */
export interface NoteChange extends NoteVersion {
  readonly kind: NoteChangeKind;
  readonly path: string;
}

/**
 * What happened to each note between two looks at the vault, notes that came
 * or changed first, in the order `after` holds them, then notes that went.
 *
 * A note has changed only when its text has: a newer modification time over
 * the same bytes, which a sync or a rebuild leaves behind, is not a change.
 * A rename is its old path removed and its new path added, with one digest
 * between them — nothing in a file says where it used to be, so pairing the
 * two is left to whoever needs to.
 */
export function noteChangesBetween(
  before: ReadonlyMap<string, NoteVersion>,
  after: ReadonlyMap<string, NoteVersion>,
): NoteChange[] {
  const changes: NoteChange[] = [];
  for (const [path, version] of after) {
    const earlier = before.get(path);
    if (earlier === undefined) changes.push(noteChange('added', path, version));
    else if (earlier.digest !== version.digest) changes.push(noteChange('changed', path, version));
  }
  for (const [path, version] of before) {
    if (!after.has(path)) changes.push(noteChange('removed', path, version));
  }
  return changes;
}

/** The versions `before` becomes once the changes have happened to it. */
export function versionsAfter(
  before: ReadonlyMap<string, NoteVersion>,
  changes: readonly NoteChange[],
): Map<string, NoteVersion> {
  const after = new Map(before);
  for (const change of changes) {
    if (change.kind === 'removed') after.delete(change.path);
    else after.set(change.path, { type: change.type, digest: change.digest });
  }
  return after;
}

/** The notes one sync added and removed that are not two ends of one note: arrivals, and deletions. */
export interface UnpairedChanges {
  /** Paths added that no note gone accounts for. */
  readonly arrived: ReadonlySet<string>;
  /** Paths removed that no note added accounts for. */
  readonly deleted: ReadonlySet<string>;
}

/**
 * The notes among one sync's changes that arrived, and those that were
 * deleted: each one added or removed that is not one end of a note moved.
 * The feed pairs nothing, so this does, one to one, in three passes:
 *
 * - archiving a note, or putting it back, by its two paths (`isArchiveMove`):
 *   the stamp changes its bytes, so they cannot tell;
 * - a move to another folder: the same bytes under the same name;
 * - a rename: the same bytes under another name.
 *
 * One note gone pairs with one added, so of a note copied and the original
 * moved, one is the move and the copy arrived. Filing, renaming, archiving or
 * restoring a note is not its arrival.
 */
export function unpairedChanges(changes: readonly NoteChange[]): UnpairedChanges {
  const gone = new Set(changes.filter((change) => change.kind === 'removed'));
  const arrived = new Set(changes.filter((change) => change.kind === 'added'));
  const pairOff = (pairs: (went: NoteChange, came: NoteChange) => boolean) => {
    for (const came of arrived) {
      const went = [...gone].find((each) => pairs(each, came));
      if (went === undefined) continue;
      gone.delete(went);
      arrived.delete(came);
    }
  };
  pairOff((went, came) => isArchiveMove(createVaultPath(went.path), createVaultPath(came.path)));
  pairOff((went, came) => went.digest === came.digest && nameOf(went.path) === nameOf(came.path));
  pairOff((went, came) => went.digest === came.digest);
  const paths = (each: ReadonlySet<NoteChange>) => new Set([...each].map((change) => change.path));
  return { arrived: paths(arrived), deleted: paths(gone) };
}

/** The notes among one sync's changes that arrived: see {@link unpairedChanges}. */
export function arrivedPaths(changes: readonly NoteChange[]): ReadonlySet<string> {
  return unpairedChanges(changes).arrived;
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Copies only the version's own fields: what it came from may carry more. */
function noteChange(kind: NoteChangeKind, path: string, version: NoteVersion): NoteChange {
  return { kind, path, type: version.type, digest: version.digest };
}
