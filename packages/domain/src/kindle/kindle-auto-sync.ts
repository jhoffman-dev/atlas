import { holdsKindleAutoSync, mayAutoSyncKindle } from './kindle-backoff.ts';
import { describeKindleSync, type KindleSyncReport } from './kindle-sync-report.ts';

/*
 * When Kindle sync runs by itself (#508): on launch and every few hours,
 * only once the person has connected, never within a day of Amazon's robot
 * check or rate limit, and not again soon after a sync already ran — a
 * launch right after a restart does not ask Amazon again.
 */

/** How often an automatic sync is tried while the app is open. */
export const KINDLE_AUTO_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** The least time between a sync and an automatic one after it: a restart does not sync again. */
export const KINDLE_AUTO_SYNC_MIN_GAP_MS = 60 * 60 * 1000;

/** How the last sync ended, in the person's words. */
export interface KindleLastSync {
  /** When it ended, by the clock that ran it. */
  readonly at: number;
  readonly message: string;
  readonly ok: boolean;
}

/** What this Mac keeps of Kindle sync, outside the vault: it is this Mac's session. */
export interface KindleSyncRecord {
  /** Whether the person connected Kindle here and has not disconnected it since. */
  readonly connected: boolean;
  /** When the last robot check or rate limit came (`holdsKindleAutoSync`); null for none. */
  readonly lastHoldAt: number | null;
  readonly last: KindleLastSync | null;
}

export const NO_KINDLE_SYNC_RECORD: KindleSyncRecord = {
  connected: false,
  lastHoldAt: null,
  last: null,
};

/** Why an automatic sync does not run now. */
export type KindleAutoSyncSkip = 'not_connected' | 'held' | 'recent';

/**
 * Why an automatic sync should not run at `now`, or null when it should.
 * A last sync dated after `now` (a clock set back) is no reason to wait.
 */
export function kindleAutoSyncSkip(
  record: KindleSyncRecord,
  now: number,
): KindleAutoSyncSkip | null {
  if (!record.connected) return 'not_connected';
  if (!mayAutoSyncKindle({ now, lastHoldAt: record.lastHoldAt })) return 'held';
  const last = record.last?.at ?? null;
  if (last !== null && last <= now && now - last < KINDLE_AUTO_SYNC_MIN_GAP_MS) return 'recent';
  return null;
}

/**
 * The record once a sync ended as `report` at `now`: its words kept, a robot
 * check or rate limit dated, and the connection as the host found it — none
 * when it said there is no session, made when a sync went through.
 */
export function kindleRecordAfterSync(
  record: KindleSyncRecord,
  report: KindleSyncReport,
  now: number,
): KindleSyncRecord {
  const connected =
    report.kind === 'not_connected' || report.kind === 'unsupported'
      ? false
      : record.connected || report.kind === 'synced';
  return {
    connected,
    lastHoldAt: holdsKindleAutoSync(report) ? now : record.lastHoldAt,
    last: { at: now, ...describeKindleSync(report) },
  };
}

/** The record once a sync failed outright, its error's words kept. */
export function kindleRecordAfterFailure(
  record: KindleSyncRecord,
  message: string,
  now: number,
): KindleSyncRecord {
  return { ...record, last: { at: now, message: `Kindle sync failed: ${message}`, ok: false } };
}
