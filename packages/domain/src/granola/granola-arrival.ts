/**
 * A note the pull finds, not yet in the vault, that the webhook should have
 * brought long since (plan §5): the sign that Granola disabled the webhook
 * endpoint after four days of failures. Whether the webhook is set up at
 * all (`granola_webhook`) is the caller's to check.
 */

/** How long the webhook path (Granola → n8n → GitHub → sync) may take before a note is late. */
export const STALE_ARRIVAL_MS = 2 * 60 * 60_000;

/**
 * Whether a note the pull is about to write was last updated more than
 * {@link STALE_ARRIVAL_MS} ago. `updated_at` is read rather than `created_at`:
 * a note is created when the meeting starts, but only listed — and only sent
 * by the webhook — once its summary is written, which updates it. A time that
 * cannot be read is never late: no warning on a guess.
 */
export function isStaleArrival({
  updatedAt,
  now,
}: {
  readonly updatedAt: string;
  /** Now, in milliseconds since the epoch, by the injected clock. */
  readonly now: number;
}): boolean {
  // An unreadable time parses to NaN, and no comparison with NaN is true.
  return now - Date.parse(updatedAt) > STALE_ARRIVAL_MS;
}
