/**
 * Where a pull of Granola starts listing notes (`updated_after`), and where
 * the next pull will (plan §4.3, ADR-0034). The watermark is this Mac's,
 * per vault; losing it costs one full listing, which is cheap: ids the vault
 * already holds are never fetched. Granola documents no order for its list,
 * so the next watermark is decided only once every page has been read.
 */

const HOUR_MS = 60 * 60_000;

/** How much a pull lists again before its watermark, so a note on the edge is never missed. */
export const WATERMARK_OVERLAP_MS = 24 * HOUR_MS;

/**
 * A pull when the vault opens, one on the 15-minute timer, or the person
 * pressing Sync now to find a meeting they see is missing.
 */
export type GranolaPullMode = 'startup' | 'periodic' | 'sync-now';

/** An instant as milliseconds, or null when it is not one. */
function instantOf(text: string | null): number | null {
  if (text === null) return null;
  const instant = Date.parse(text);
  return Number.isNaN(instant) ? null : instant;
}

/**
 * The earliest (`Math.min`) or latest (`Math.max`) of the instants known;
 * null when none is. Taken pairwise: spread, a pull of many notes would
 * overflow the engine's argument limit.
 */
function extreme(
  pick: (a: number, b: number) => number,
  instants: readonly (number | null)[],
): number | null {
  let found: number | null = null;
  for (const instant of instants) {
    if (instant !== null) found = found === null ? instant : pick(found, instant);
  }
  return found;
}

const isoOf = (instant: number | null) =>
  instant === null ? null : new Date(instant).toISOString();

/**
 * The `updated_after` for a pull: a day before the watermark at startup and
 * on the timer. Null — list every note — for Sync now, for a first pull, and
 * for a watermark that cannot be read.
 */
export function sinceOf({
  watermark,
  mode,
}: {
  readonly watermark: string | null;
  readonly mode: GranolaPullMode;
}): string | null {
  const mark = mode === 'sync-now' ? null : instantOf(watermark);
  return isoOf(mark === null ? null : mark - WATERMARK_OVERLAP_MS);
}

/**
 * What became of one listed note. `written` and `held` (already in the
 * vault) are settled; so is `refused` (the mapper said no, which only a
 * mapper fix changes) and `skipped` (granolaFailureEffect's `skip`: a 404,
 * a 403, a 413 for a page of a transcript, any other refusal, an answer
 * Atlas could not read — each would fail the same way on every pull). Sync
 * now's full listing tries both again. `failed` is granolaFailureEffect's
 * `retry`, a failure that may pass by itself — network, timeout, 408, a 429
 * past its retries, a 5xx, a 413 for a whole transcript (read in pages next
 * time) — and must be listed again. A page of a transcript is judged by its
 * status like any other answer.
 */
export type GranolaNoteOutcome = 'written' | 'held' | 'refused' | 'skipped' | 'failed';

export interface GranolaNoteResult {
  readonly outcome: GranolaNoteOutcome;
  /** The note's `updated_at`, as Granola listed it. */
  readonly updatedAt: string;
}

/**
 * The watermark after a pull: the newest settled note's `updated_at` (never
 * behind the watermark it started from), but never past the oldest `failed`
 * note, so the next pull lists that one again. Only `failed` holds it: a
 * note skipped or refused would hold it for good, every later pull listing
 * everything since. A failed note whose time cannot be read keeps the
 * watermark where it was, rather than risk passing it.
 */
export function nextWatermark({
  watermark,
  results,
}: {
  readonly watermark: string | null;
  readonly results: readonly GranolaNoteResult[];
}): string | null {
  const current = instantOf(watermark);
  const failedAt = results
    .filter((result) => result.outcome === 'failed')
    .map((result) => instantOf(result.updatedAt));
  if (failedAt.includes(null)) return isoOf(current);
  const settledAt = results
    .filter((result) => result.outcome !== 'failed')
    .map((result) => instantOf(result.updatedAt));
  const reached = extreme(Math.max, [current, extreme(Math.max, settledAt)]);
  return isoOf(extreme(Math.min, [reached, extreme(Math.min, failedAt)]));
}
