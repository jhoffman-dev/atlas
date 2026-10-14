/**
 * ADR-0035 part 4: whether a Mac may act on what sync has brought in.
 *
 * Every Mac, named or not, runs the meeting import and a rule's Claude step
 * only after a pull that completed with the Mac awake throughout, and only if
 * the settings read after that pull still name it. A Mac another claimed
 * while it slept wakes, pulls, finds it is not named, and runs nothing.
 *
 * The host reports one number (#172): how long the Mac has been asleep since
 * it booted. It grows only while the Mac sleeps, the sleeps around a dark
 * wake included, and no clock setting moves it. A pull counts when it
 * *started* at the reading there is now: one that began before a sleep and
 * finished after it may have fetched the state from before the sleep. A new
 * session has no completed pull, so launch needs no reading of its own.
 */

/** What this session knows of one vault's last pull. Null: no pull has completed, or the last one failed. */
export type PullStanding =
  /** The vault does not sync: it has one Mac, and nothing to wait for. */
  | { readonly kind: 'not-synced' }
  /** A pull is under way: what it brings is judged once it has completed. */
  | { readonly kind: 'pulling' }
  | {
      readonly kind: 'pulled';
      /** The host's time asleep since boot, read as the pull started. */
      readonly startedAsleepMs: number;
      /** When it completed, on this Mac's clock. */
      readonly finishedAt: number;
      /** Whether the vault's settings, read once it had completed, name this Mac. */
      readonly namedAfter: boolean;
    };

/**
 * How far apart two readings of one awake spell may be. The host reads two
 * clocks one after the other, so a reading moves by the moment between them:
 * rounding can show that as a millisecond, a thread preempted between the two
 * as a few more. No sleep, a dark wake's included, is anywhere near as short.
 */
export const ASLEEP_READING_SLACK_MS = 1_000;

/**
 * Gate 2: a pull has completed that started since this Mac last slept (or
 * since the app launched, which a session with no pull covers). A vault that
 * does not sync has nothing to wait for. With no reading of the counter, it
 * never guesses.
 */
export function pulledSinceLastSleep({
  standing,
  asleepNowMs,
}: {
  standing: PullStanding | null;
  /** The host's time asleep since boot, read now; null when it could not be read. */
  asleepNowMs: number | null;
}): boolean {
  if (standing === null || standing.kind === 'pulling') return false;
  if (standing.kind === 'not-synced') return true;
  if (asleepNowMs === null) return false;
  return Math.abs(asleepNowMs - standing.startedAsleepMs) <= ASLEEP_READING_SLACK_MS;
}

/**
 * Gate 1: the last completed pull finished later than the file was last
 * modified on this Mac, so whatever another Mac has done to it by then has
 * been brought in. A vault that does not sync has nothing to wait for.
 */
export function pulledAfterArrival({
  standing,
  modifiedAt,
}: {
  standing: PullStanding | null;
  /** When the file was last modified on this Mac, on its clock. */
  modifiedAt: number;
}): boolean {
  if (standing === null || standing.kind === 'pulling') return false;
  if (standing.kind === 'not-synced') return true;
  return standing.finishedAt > modifiedAt;
}

/**
 * Whether this Mac may run the meeting import, or a rule's Claude step, on
 * the vault's files now: gate 2 holds and the settings name this Mac, both
 * as read after the pull and as held now. Asked right before acting.
 */
export function actsOnPulledFiles({
  standing,
  asleepNowMs,
  namedNow,
}: {
  standing: PullStanding | null;
  asleepNowMs: number | null;
  /** Whether the settings as this Mac holds them now name it (`runsAutomationsHere`). */
  namedNow: boolean;
}): boolean {
  if (!namedNow || !pulledSinceLastSleep({ standing, asleepNowMs })) return false;
  return standing?.kind !== 'pulled' || standing.namedAfter;
}
