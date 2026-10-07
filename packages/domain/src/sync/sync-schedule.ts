/**
 * When a synced vault syncs by itself (U-29, James's additions on A29-01):
 *
 * - it pushes about half a minute after the vault was last changed — typing
 *   stopped, a Claude edit accepted, an automation run, a note moved;
 * - it pushes at least every five minutes while changes keep coming, so a
 *   long session is never left unpushed;
 * - it asks GitHub every minute whether another Mac pushed, and brings that
 *   in when one did — at once, or with this Mac's own changes once typing
 *   has stopped;
 * - nothing of this while sync is paused on this Mac.
 *
 * Both intervals are the person's to set. The timers live at the edge;
 * whether something is due is decided here.
 */

export const DEFAULT_PULL_INTERVAL_MINUTES = 1;
export const MIN_PULL_INTERVAL_MINUTES = 1;
export const MAX_PULL_INTERVAL_MINUTES = 120;
/** How often Settings offers to look for other Macs' changes, in minutes. */
export const PULL_INTERVAL_CHOICES: readonly number[] = [1, 2, 5, 10, 15, 30, 60];

export const DEFAULT_PUSH_DELAY_SECONDS = 30;
export const MIN_PUSH_DELAY_SECONDS = 5;
export const MAX_PUSH_DELAY_SECONDS = 600;
/** How long after the last change Settings offers to send it, in seconds. */
export const PUSH_DELAY_CHOICES: readonly number[] = [10, 30, 60, 120, 300];

/** Changes that keep coming are sent at least this often. */
export const MAX_UNSYNCED_MS = 5 * 60_000;

const SECOND_MS = 1_000;
const MINUTE_MS = 60_000;

/** A whole number from a setting, in bounds; the default when it says nothing usable. */
function bounded(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** How often to look for other Macs' changes, from the `syncInterval` setting. */
export function pullIntervalMinutes(value: unknown): number {
  return bounded(value, {
    min: MIN_PULL_INTERVAL_MINUTES,
    max: MAX_PULL_INTERVAL_MINUTES,
    fallback: DEFAULT_PULL_INTERVAL_MINUTES,
  });
}

/** How long after the last change to send it, from the `syncPushDelay` setting. */
export function pushDelaySeconds(value: unknown): number {
  return bounded(value, {
    min: MIN_PUSH_DELAY_SECONDS,
    max: MAX_PUSH_DELAY_SECONDS,
    fallback: DEFAULT_PUSH_DELAY_SECONDS,
  });
}

export interface SyncTiming {
  /** Now, in milliseconds since the epoch, by the injected clock. */
  readonly now: number;
  /** Whether sync is paused on this Mac: then nothing runs by itself. */
  readonly paused: boolean;
  /** When the last sync started; null when none has this session. */
  readonly lastSyncAt: number | null;
  /** When GitHub was last asked for other Macs' changes, by a sync or a look; null when never. */
  readonly lastCheckAt: number | null;
  /** When the vault was last changed; null when it has not been this session. */
  readonly lastEditAt: number | null;
  /** The first change since the last sync started; null when there has been none. */
  readonly firstUnsyncedEditAt: number | null;
  readonly pushDelaySeconds: number;
  readonly pullIntervalMinutes: number;
}

/**
 * What, if anything, is due now: a sync that sends this Mac's changes
 * (`push`), or a look at GitHub for other Macs' (`check`), which becomes a
 * sync only when there is something to bring in. Sending comes first; a
 * sync looks at GitHub too. A clock set back puts a time in the future:
 * that is taken as due rather than waited for.
 */
export function dueSync(timing: SyncTiming): 'push' | 'check' | null {
  if (timing.paused) return null;
  if (pushIsDue(timing)) return 'push';
  const lastLook = latest(timing.lastCheckAt, timing.lastSyncAt);
  const sinceLook = lastLook === null ? Infinity : timing.now - lastLook;
  if (sinceLook < 0 || sinceLook >= timing.pullIntervalMinutes * MINUTE_MS) return 'check';
  return null;
}

function pushIsDue({
  now,
  lastSyncAt,
  lastEditAt,
  firstUnsyncedEditAt,
  pushDelaySeconds: delay,
}: SyncTiming): boolean {
  // An edit made while a sync ran is newer than it, and is sent in turn.
  const unsynced = lastEditAt !== null && (lastSyncAt === null || lastEditAt >= lastSyncAt);
  if (!unsynced) return false;
  const quiet = now - lastEditAt;
  if (quiet < 0 || quiet >= delay * SECOND_MS) return true;
  const since = firstUnsyncedEditAt ?? lastEditAt;
  return now - since >= MAX_UNSYNCED_MS;
}

function latest(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Whether a look at GitHub calls for a sync at once: it found other Macs'
 * changes to bring in, or this Mac's commits a sync could not push — the
 * network was gone — still to send (review A29-01). Not while this Mac has
 * changes of its own waiting for typing to stop: the sync that sends them
 * does all of it, and a note being typed in is not reloaded under the
 * person's hands. Meanwhile the light says the vault is behind.
 */
export function syncAfterLook({
  behind,
  ahead,
  lastSyncAt,
  lastEditAt,
}: {
  behind: number;
  ahead: number;
  lastSyncAt: number | null;
  lastEditAt: number | null;
}): boolean {
  if (behind === 0 && ahead === 0) return false;
  const unsynced = lastEditAt !== null && (lastSyncAt === null || lastEditAt >= lastSyncAt);
  return !unsynced;
}

/**
 * The first unsynced change, once the vault changes at `now`: kept while
 * one is waiting, started afresh after a sync has taken the earlier ones.
 */
export function firstUnsyncedAfterEdit({
  now,
  firstUnsyncedEditAt,
  lastSyncAt,
}: {
  now: number;
  firstUnsyncedEditAt: number | null;
  lastSyncAt: number | null;
}): number {
  const waiting =
    firstUnsyncedEditAt !== null && (lastSyncAt === null || firstUnsyncedEditAt >= lastSyncAt);
  return waiting ? firstUnsyncedEditAt : now;
}
