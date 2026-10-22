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
 * whether this Mac has a session.
 */
export async function runKindleSync(
  { sync, ports, records }: KindleSyncRunPorts,
  why: KindleSyncWhy,
): Promise<KindleSyncRun> {
  if (why === 'automatic') {
    const skip = kindleAutoSyncSkip(records.read(), ports.clock.now());
    if (skip !== null) return { kind: 'skipped', reason: skip };
  }
  try {
    const report = await sync(ports);
    const record = kindleRecordAfterSync(records.read(), report, ports.clock.now());
    records.write(record);
    return { kind: 'ran', report, record };
  } catch (error) {
    const record = kindleRecordAfterFailure(records.read(), messageOf(error), ports.clock.now());
    records.write(record);
    return { kind: 'failed', record };
  }
}

/**
 * Connect Kindle: the host's sign-in window, then a sync, which is what finds
 * out whether the person signed in (the window says nothing either way). The
 * record says connected first, so a sync on its own later tries too.
 */
export async function connectKindle(
  run: KindleSyncRunPorts & { readonly session: KindleSession },
): Promise<KindleSyncRun> {
  await run.session.connect();
  run.records.write({ ...run.records.read(), connected: true });
  return runKindleSync(run, 'asked');
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
