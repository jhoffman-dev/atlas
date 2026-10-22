import type { KindleSyncReport } from './kindle-sync-report.ts';

/**
 * How long Kindle sync stays off after Amazon's robot check, or its saying
 * it is asked too often (403 or 429) (#508). Asking again while Amazon doubts
 * the account is a robot makes it surer, so an automatic sync (on launch,
 * every few hours) holds back for a day; one the person asks for is theirs
 * to make and is not held. The scheduler that runs the automatic syncs asks
 * this; it keeps when the last sync {@link holdsKindleAutoSync} came, as
 * `lastHoldAt` below.
 */
export const KINDLE_AUTO_SYNC_HOLD_MS = 24 * 60 * 60 * 1000;

/** Whether a sync that ended as `report` starts the hold on automatic syncs. */
export function holdsKindleAutoSync(report: Pick<KindleSyncReport, 'kind'>): boolean {
  return report.kind === 'robot_check' || report.kind === 'rate_limited';
}

/**
 * Until when automatic syncs are held, given when the hold began (a robot
 * check or a rate limit); null when none has. A time that is not a finite
 * number (one read back badly from storage) is taken as no hold: it dates nothing.
 */
export function kindleAutoSyncHeldUntil(lastHoldAt: number | null): number | null {
  if (lastHoldAt === null || !Number.isFinite(lastHoldAt)) return null;
  return lastHoldAt + KINDLE_AUTO_SYNC_HOLD_MS;
}

/**
 * Whether an automatic sync may run at `now` (a clock's reading). A hold
 * dated after `now` — a clock set back — holds nothing, nor does one
 * whose time is not a finite number: stopping for ever on a wrong clock or a
 * bad stored value is worse than one extra try.
 */
export function mayAutoSyncKindle(args: {
  readonly now: number;
  readonly lastHoldAt: number | null;
}): boolean {
  if (args.lastHoldAt === null || !Number.isFinite(args.lastHoldAt)) return true;
  if (args.lastHoldAt > args.now) return true;
  const heldUntil = kindleAutoSyncHeldUntil(args.lastHoldAt);
  return heldUntil === null || args.now >= heldUntil;
}
