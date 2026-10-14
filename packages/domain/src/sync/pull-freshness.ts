/**
 * SPIKE #172 (throwaway, not for merge): ADR-0035 gate 2 — has a pull
 * completed since this Mac last slept?
 *
 * The host reports one number, how long the Mac has been asleep since it
 * booted. It grows only while the Mac sleeps (dark wakes' sleeps included)
 * and no clock setting moves it. A pull counts when it *started* at the same
 * reading as now: one that began before a sleep and finished after it may
 * have fetched the state from before the sleep. A pull started since launch
 * is the only kind this app session knows, so launch needs no reading.
 */

/** The reading taken as a pull started, kept once that pull has completed. */
export interface CompletedPull {
  readonly startedAsleepMs: number;
}

export function pulledSinceLastSleep({
  lastCompletedPull,
  asleepNowMs,
}: {
  /** The latest pull this session that completed; null when none has. */
  lastCompletedPull: CompletedPull | null;
  /** The host's reading now; null when it could not be read. */
  asleepNowMs: number | null;
}): boolean {
  if (lastCompletedPull === null || asleepNowMs === null) return false;
  return asleepNowMs === lastCompletedPull.startedAsleepMs;
}
