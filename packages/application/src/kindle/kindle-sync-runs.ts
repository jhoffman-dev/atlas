import {
  kindleAutoSyncSkip,
  kindleRecordAfterFailure,
  kindleRecordAfterSync,
  type KindleAutoSyncSkip,
  type KindleSyncRecord,
  type KindleSyncReport,
} from '@dfai/domain';
import type { KindleSession } from './ports.ts';
import type { KindleSync, KindleSyncPorts } from './sync-kindle.ts';

/** Where this Mac keeps its {@link KindleSyncRecord}: the app's own storage, never the vault. */
export interface KindleSyncRecords {
  read(): KindleSyncRecord;
  write(record: KindleSyncRecord): void;
}

/** What starting a Kindle sync needs: the app's one sync, what it runs over, and the record. */
export interface KindleSyncRunPorts {
  /** The app's one `createKindleSync`, so launch, schedule and ⌘K never run two at once. */
  readonly sync: KindleSync;
  readonly ports: KindleSyncPorts;
  readonly records: KindleSyncRecords;
}

/** Why a sync was started: by itself (launch, schedule), or by the person. */
export type KindleSyncWhy = 'automatic' | 'asked';

/** How starting a sync went. */
export type KindleSyncRun =
  /** An automatic sync that did not run, and why. */
  | { readonly kind: 'skipped'; readonly reason: KindleAutoSyncSkip }
  | { readonly kind: 'ran'; readonly report: KindleSyncReport; readonly record: KindleSyncRecord }
  /** The sync threw: a stuck sync given up on, or a fault. */
  | { readonly kind: 'failed'; readonly record: KindleSyncRecord };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Runs a Kindle sync and keeps how it ended (#508). An automatic one runs only
 * once Kindle is connected, a day clear of a robot check or rate limit, and an
 * hour clear of the last sync (`kindleAutoSyncSkip`); one the person asks for
 * always runs, and the host says if there is no session. The record keeps the
 * sync's words, dates a robot check or rate limit, and follows the host on
 * whether this Mac has a session — unless the person disconnected while it
 * ran, which stands: the sync's end leaves the record as Disconnect made it.
 */
export async function runKindleSync(
  { sync, ports, records }: KindleSyncRunPorts,
  why: KindleSyncWhy,
): Promise<KindleSyncRun> {
  if (why === 'automatic') {
    const skip = kindleAutoSyncSkip(records.read(), ports.clock.now());
    if (skip !== null) return { kind: 'skipped', reason: skip };
  }
  const started = records.read();
  try {
    const report = await sync(ports);
    const current = records.read();
    if (disconnectedSince(started, current)) return { kind: 'ran', report, record: current };
    const record = kindleRecordAfterSync(current, report, ports.clock.now());
    records.write(record);
    return { kind: 'ran', report, record };
  } catch (error) {
    const current = records.read();
    if (disconnectedSince(started, current)) return { kind: 'failed', record: current };
    const record = kindleRecordAfterFailure(current, messageOf(error), ports.clock.now());
    records.write(record);
    return { kind: 'failed', record };
  }
}

/**
 * Whether the person disconnected Kindle while a sync that began connected
 * ran. Their Disconnect is the later word: the sync's end must not connect
 * it again or put its own words on a record Disconnect cleared.
 */
const disconnectedSince = (started: KindleSyncRecord, current: KindleSyncRecord): boolean =>
  started.connected && !current.connected;

/**
 * Connect Kindle: the host's sign-in window, which resolves when the person
 * closes it, whether or not they signed in; then the record says connected,
 * so syncs run by themselves from now on. The sync that follows (the
 * caller's, through {@link runKindleSync}) is what finds out whether they did.
 */
export async function connectKindle({
  session,
  records,
}: {
  readonly session: KindleSession;
  readonly records: KindleSyncRecords;
}): Promise<KindleSyncRecord> {
  await session.connect();
  const record = { ...records.read(), connected: true };
  records.write(record);
  return record;
}

/**
 * Disconnect Kindle: the host deletes this Mac's session (Amazon itself is not
 * signed out), and nothing syncs by itself again until the person connects.
 * A robot check's hold is kept: Amazon's doubt outlasts the session.
 */
export async function disconnectKindle({
  session,
  records,
}: {
  readonly session: KindleSession;
  readonly records: KindleSyncRecords;
}): Promise<KindleSyncRecord> {
  await session.disconnect();
  const record = { ...records.read(), connected: false, last: null };
  records.write(record);
  return record;
}
