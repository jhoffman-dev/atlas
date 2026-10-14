import type { GranolaPullRecord, GranolaPullRecords } from '@atlas/application';

const PREFIX = 'atlas.granola-pull:';

const NONE: GranolaPullRecord = { watermark: null, lastPullAt: null };

/** A record as kept, or none when what is kept is not one. */
function recordOf(kept: string | null): GranolaPullRecord {
  if (kept === null) return NONE;
  const parsed: unknown = JSON.parse(kept);
  if (typeof parsed !== 'object' || parsed === null) return NONE;
  const { watermark, lastPullAt } = parsed as Record<string, unknown>;
  return {
    watermark: typeof watermark === 'string' ? watermark : null,
    lastPullAt: typeof lastPullAt === 'number' && Number.isFinite(lastPullAt) ? lastPullAt : null,
  };
}

/**
 * Where this Mac's Granola pulls of each vault left off, kept in the app's
 * own storage (ADR-0034): it is this Mac's, and the vault syncs, so a write on
 * every pull there would be noise in its history and a conflict between Macs.
 *
 * Every access is guarded: the accessor throws where site data is blocked,
 * and a kept record may have been edited by hand. Either way the record reads
 * as none, which costs one full listing that the dedupe makes harmless.
 */
export const browserGranolaPullRecords: GranolaPullRecords = {
  read: (vault) => {
    try {
      return recordOf(window.localStorage.getItem(`${PREFIX}${vault}`));
    } catch {
      return NONE;
    }
  },
  write: (vault, record) => {
    try {
      window.localStorage.setItem(`${PREFIX}${vault}`, JSON.stringify(record));
    } catch {
      // Safe to ignore: the next pull lists from the record kept before, which only repeats work.
    }
  },
};
