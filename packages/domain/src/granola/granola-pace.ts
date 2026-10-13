/**
 * How fast a pull asks Granola, and how long it waits when told to slow down
 * (plan §5). Granola allows bursts of 25 requests in 5 seconds and 5 a second
 * sustained, and answers 429 past that; Atlas keeps to 4 a second, so a 429
 * is rare. The timers are the caller's; the waits are decided here.
 */

/** Requests Atlas sends in any one second. */
export const REQUESTS_PER_SECOND = 4;
const PACE_WINDOW_MS = 1_000;

/** Retries after a 429 before the note counts as failed in transport. */
export const RETRIES = 5;
const FIRST_BACKOFF_MS = 1_000;

/**
 * How long to wait before retry `attempt` (from 1) after a 429: 1, 2, 4, 8,
 * then 16 seconds. Null past the fifth: give up, and let the watermark hold
 * the note for the next pull. An attempt before the first waits the first delay.
 */
export function backoff(attempt: number): number | null {
  const retry = attempt >= 1 ? Math.floor(attempt) : 1;
  if (retry > RETRIES) return null;
  return FIRST_BACKOFF_MS * 2 ** (retry - 1);
}

/**
 * How long to wait, in milliseconds, before the next request, given when
 * the recent ones were sent: none while fewer than four went in the last
 * second, else until the fourth newest is a second old. Never more than a
 * second, even if the clock moved back.
 */
export function paceOf({
  sentAt,
  now,
}: {
  readonly sentAt: readonly number[];
  /** Now, in milliseconds since the epoch, by the injected clock. */
  readonly now: number;
}): number {
  const recent = sentAt.filter((at) => at > now - PACE_WINDOW_MS).sort((a, b) => b - a);
  const fourthNewest = recent[REQUESTS_PER_SECOND - 1];
  if (fourthNewest === undefined) return 0;
  return Math.min(PACE_WINDOW_MS, fourthNewest + PACE_WINDOW_MS - now);
}
