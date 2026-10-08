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

/**
 * The notes among one sync's changes that arrived: each one added, unless a
 * note with the same bytes went in the same sync. That pair is a move or a
 * rename — the feed pairs nothing, so this does, by digest — and filing a
 * note, or renaming it, is not its arrival.
 */
export function arrivedPaths(changes: readonly NoteChange[]): ReadonlySet<string> {
  const movedAway = new Set(
    changes.filter((change) => change.kind === 'removed').map((change) => change.digest),
  );
  return new Set(
    changes
      .filter((change) => change.kind === 'added' && !movedAway.has(change.digest))
      .map((change) => change.path),
  );
}

/** One version of one note, as a key: what "this note, with these bytes" is remembered by. */
export function noteVersionKey(path: string, digest: string): string {
  return `${path}\u0000${digest}`;
}

/** Copies only the version's own fields: what it came from may carry more. */
function noteChange(kind: NoteChangeKind, path: string, version: NoteVersion): NoteChange {
  return { kind, path, type: version.type, digest: version.digest };
}
