import type { Clock } from '../ports.ts';

/**
 * What one of the app's own writes left at a path: what the watcher's report
 * of that write must find there to be its echo (#254).
 */
export type LeftVersion =
  | { readonly kind: 'text'; readonly text: string; readonly modified: number }
  | { readonly kind: 'absent' }
  | { readonly kind: 'folder' };

/**
 * What is at a path when the watcher's report of it arrives. A `directory`
 * says whether all it holds is the app's own; `file` is a file whose text was not read; `unknown` is whatever could not be told: a file
 * that is not text, or a read that failed.
 */
export type FoundVersion =
  | LeftVersion
  | { readonly kind: 'directory'; readonly ownContents: boolean }
  | { readonly kind: 'file' }
  | { readonly kind: 'unknown' };

/**
 * Whether what is at a path now is exactly what the app's write left there.
 *
 * A note must match in its time and its every byte: another program writing
 * in the same millisecond, or on a disk whose clock keeps only seconds,
 * leaves the same time but other bytes, and its report is kept. (The refresh
 * it asks for re-reads only a note whose time or size moved, so a same-time,
 * same-size change can still slip past the index: #245.) A path the app
 * emptied is an echo only while nothing is there. A folder the app made is
 * one only while everything in it is the app's own, as it left it: another
 * program can put a whole folder of notes in its place, and the watcher then
 * reports the folder alone.
 */
export function isEchoOf(left: LeftVersion, found: FoundVersion): boolean {
  switch (left.kind) {
    case 'text':
      return found.kind === 'text' && found.modified === left.modified && found.text === left.text;
    case 'absent':
      return found.kind === 'absent';
    case 'folder':
      return found.kind === 'directory' && found.ownContents;
  }
}

/** How long a write is kept: well past the watcher's 400 ms quiet period, under load. */
export const OWN_WRITE_KEPT_MS = 10_000;
/** How many writes are kept: a burst past this refreshes for its oldest, as for any change. */
export const OWN_WRITES_KEPT = 512;

/** A path in one vault: a write in one is never the echo of a report in another. */
export interface PathInVault {
  readonly vault: string;
  readonly path: string;
}

/**
 * The app's own recent writes, by vault and path: the last one at each, and
 * how far the index has caught up with them.
 */
export interface OwnWrites {
  record(write: PathInVault & { readonly left: LeftVersion }): void;
  /** Forgets the path's write: what is there now is not known, so no report of it is an echo. */
  forget(file: PathInVault): void;
  /** The last write the app made at the path, while it is still kept; null when none is. */
  leftAt(file: PathInVault): LeftVersion | null;
  /** Which write was recorded last: a refresh that starts reading the vault now reads up to it. */
  lastWrite(): number;
  /**
   * Says a refresh of `vault` that started at `through` (a `lastWrite`) has
   * finished. It holds every write up to there except at the notes it could
   * not read (`unread`, none when left out), which keep their old version in
   * the index.
   */
  refreshed(refresh: {
    readonly vault: string;
    readonly through: number;
    readonly unread?: readonly string[];
  }): void;
  /**
   * The last write at the path, once a refresh that started after it has
   * finished and read it, so that the index holds it: the only write whose
   * echo can be dropped. A write the app has not refreshed for is refreshed
   * for by its echo.
   */
  refreshedAt(file: PathInVault): LeftVersion | null;
}

interface Kept {
  readonly left: LeftVersion;
  readonly at: number;
  readonly write: number;
  /** Whether a refresh that began after it has put it in the index. */
  readonly held: boolean;
}

/**
 * Remembers the app's own writes for a while, so that the watcher's report of
 * one can be told from another program's change (#254). A write is kept for
 * `keptMs` and the newest `capacity` of them; one older, or past the
 * capacity, is forgotten, and its report is then refreshed for, as any
 * change is. A clock that has gone back keeps nothing it cannot date.
 */
export function createOwnWrites({
  clock,
  keptMs = OWN_WRITE_KEPT_MS,
  capacity = OWN_WRITES_KEPT,
}: {
  clock: Pick<Clock, 'now'>;
  keptMs?: number;
  capacity?: number;
}): OwnWrites {
  const kept = keptWrites({ clock, keptMs, capacity });
  let written = 0;
  return {
    record({ left, ...file }) {
      written += 1;
      kept.put(file, { left, at: clock.now(), write: written, held: false });
    },
    forget: (file) => kept.drop(file),
    leftAt: (file) => kept.get(file)?.left ?? null,
    lastWrite: () => written,
    refreshed({ vault, through, unread = [] }) {
      const skipped = new Set(unread);
      kept.hold(
        (file, write) => file.vault === vault && write.write <= through && !skipped.has(file.path),
      );
    },
    refreshedAt(file) {
      const write = kept.get(file);
      return write?.held === true ? write.left : null;
    },
  };
}

/** The writes kept, by vault and path, in the order written: re-recording a path makes it newest. */
function keptWrites({
  clock,
  keptMs,
  capacity,
}: {
  clock: Pick<Clock, 'now'>;
  keptMs: number;
  capacity: number;
}) {
  const kept = new Map<string, Kept>();
  const keyOf = ({ vault, path }: PathInVault) => JSON.stringify([vault, path]);
  const stale = ({ at }: Kept, now: number) => now < at || now - at > keptMs;
  return {
    put(file: PathInVault, write: Kept) {
      const key = keyOf(file);
      kept.delete(key);
      kept.set(key, write);
      // Past the capacity, the oldest go. One past its window only takes room: it is never answered.
      for (const oldest of kept.keys()) {
        if (kept.size <= capacity) break;
        kept.delete(oldest);
      }
    },
    drop: (file: PathInVault) => void kept.delete(keyOf(file)),
    /** Marks every write `which` names as held, in place: its age and order are its own. */
    hold(which: (file: PathInVault, write: Kept) => boolean) {
      for (const [key, write] of kept) {
        const [vault, path] = JSON.parse(key) as [string, string];
        if (!write.held && which({ vault, path }, write)) kept.set(key, { ...write, held: true });
      }
    },
    get(file: PathInVault): Kept | undefined {
      const key = keyOf(file);
      const write = kept.get(key);
      if (write === undefined || !stale(write, clock.now())) return write;
      kept.delete(key);
      return undefined;
    },
  };
}

/**
 * The note a save's temporary file stands beside, or null when the path is
 * not one. The host saves a note by writing `.<name>.atlas-tmp` beside it and
 * renaming that over it (`temporary_beside` in vault.rs), and the watcher
 * reports both paths. A temporary this does not recognise is only refreshed
 * for, which is safe.
 */
export function noteSavedThrough(path: string): string | null {
  const slash = path.lastIndexOf('/');
  const name = /^\.(.+)\.atlas-tmp$/.exec(path.slice(slash + 1))?.[1];
  return name === undefined ? null : `${path.slice(0, slash + 1)}${name}`;
}
