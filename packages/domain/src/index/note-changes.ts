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
  /**
   * On a `changed` note only: the digest it had before. A note archived or
   * moved away, with a new one made at its path in the same sync, is
   * reported as that path changed; this is what says where the old one went
   * (P29-01).
   */
  readonly before?: string;
}

/**
 * What happened to each note between two looks at the vault, notes that came
 * or changed first, in the order `after` holds them, then notes that went.
 *
 * A note has changed only when its text has: a newer modification time over
 * the same bytes, which a sync or a rebuild leaves behind, is not a change.
 * A rename is its old path removed and its new path added, with one digest
 * between them — nothing in a file says where it used to be, so pairing the
 * two is left to whoever needs to. A changed note says the digest it had.
 */
export function noteChangesBetween(
  before: ReadonlyMap<string, NoteVersion>,
  after: ReadonlyMap<string, NoteVersion>,
): NoteChange[] {
  const changes: NoteChange[] = [];
  for (const [path, version] of after) {
    const earlier = before.get(path);
    if (earlier === undefined) changes.push(noteChange('added', path, version));
    else if (earlier.digest !== version.digest) {
      changes.push({ ...noteChange('changed', path, version), before: earlier.digest });
    }
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

/** What one sync's added, removed and changed notes say once the two ends of each move are paired. */
export interface UnpairedChanges {
  /** Paths a new note arrived at: added with no note gone to account for it, or made where one left. */
  readonly arrived: ReadonlySet<string>;
  /** Paths a note left — deleted, moved, renamed or archived — whether or not a new one is there now. */
  readonly left: ReadonlySet<string>;
}

/**
 * What one sync's changes say arrived, and which paths a note left. The feed
 * pairs nothing, so this does, one note to one, in three passes:
 *
 * - archiving a note, or putting it back, by its two paths (`isArchiveMove`):
 *   the stamp changes its bytes, so they cannot tell;
 * - a move to another folder: the same bytes under the same name;
 * - a rename: the same bytes under another name.
 *
 * Each pass pairs a note added with one removed, or else with a note
 * `changed` whose old digest (`before`) it carries, or whose path it was
 * archived from: that note left, and the one at its path now is new.
 *
 * So of a note copied and the original moved, one is the move and the copy
 * arrived; filing, renaming, archiving or restoring a note is not its arrival.
 */
export function unpairedChanges(changes: readonly NoteChange[]): UnpairedChanges {
  const gone = new Set(changes.filter((change) => change.kind === 'removed'));
  const replaceable = new Set(changes.filter((change) => change.kind === 'changed'));
  const arrived = new Set(changes.filter((change) => change.kind === 'added'));
  const left = new Set([...gone].map((change) => change.path));
  const renewed = new Set<string>();
  const pairOff = (pairs: (went: Departure, came: NoteChange) => boolean) => {
    for (const came of arrived) {
      const removed = [...gone].find((each) => pairs(each, came));
      if (removed !== undefined) {
        gone.delete(removed);
        arrived.delete(came);
        continue;
      }
      const replaced = [...replaceable].find((each) => pairs(departureOf(each), came));
      if (replaced === undefined) continue;
      replaceable.delete(replaced);
      arrived.delete(came);
      renewed.add(replaced.path);
      left.add(replaced.path);
    }
  };
  pairOff((went, came) => isArchiveMove(createVaultPath(went.path), createVaultPath(came.path)));
  pairOff((went, came) => went.digest === came.digest && nameOf(went.path) === nameOf(came.path));
  pairOff((went, came) => went.digest === came.digest);
  return { arrived: new Set([...[...arrived].map((change) => change.path), ...renewed]), left };
}

/** A note that went from a path: its path, and its bytes as they were when known. */
interface Departure {
  readonly path: string;
  readonly digest: string | undefined;
}

/** What went from a changed note's path: the note that was there; with no `before`, only its path pairs it. */
const departureOf = (change: NoteChange): Departure => ({
  path: change.path,
  digest: change.before,
});

/** The paths among one sync's changes that a new note arrived at: see {@link unpairedChanges}. */
export function arrivedPaths(changes: readonly NoteChange[]): ReadonlySet<string> {
  return unpairedChanges(changes).arrived;
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Copies only the version's own fields: what it came from may carry more. */
function noteChange(kind: NoteChangeKind, path: string, version: NoteVersion): NoteChange {
  return { kind, path, type: version.type, digest: version.digest };
}
