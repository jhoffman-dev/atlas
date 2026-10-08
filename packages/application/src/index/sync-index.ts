import {
  indexFailedReport,
  indexRebuiltReport,
  messageWithoutPaths,
  versionsAfter,
  type NoteChange,
  type NoteVersion,
} from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import type { NoteChanges } from './note-changes.ts';
import type { IndexPort, IndexStats } from './ports.ts';
import { refreshIndex, type RefreshOptions } from './refresh-index.ts';

/**
 * What a sync is measured from: every note as it was, or null when nothing is
 * known of the vault's past — the sync is then a baseline, and reports nothing.
 */
export type SyncBaseline = ReadonlyMap<string, NoteVersion> | null;

export interface IndexSync {
  /** What the index holds once it is in line with the vault. */
  readonly stats: IndexStats;
  /** Each note added, changed or removed since the baseline; none for a baseline of null. */
  readonly changes: readonly NoteChange[];
  /** Every note as it now is: the baseline of the next sync. */
  readonly versions: ReadonlyMap<string, NoteVersion>;
}

/**
 * Opens the index and brings it in line with the vault — from nothing, when
 * asked to rebuild it — and says which notes changed on the way.
 *
 * Changes are measured from `previous` when given. Otherwise from what the
 * index held, asked before anything is written — unless the host has only
 * just made the index (there was none, or one of an older shape was thrown
 * away): then nothing is known of the vault's past, and the sync is a
 * baseline that reports no changes, rather than every note as new.
 *
 * A rebuild, and any failure, is said in the Activity log (U-28); the refresh
 * every change sets off is not, since it is routine. The failure is passed on
 * as well, for the window to show.
 */
export async function syncIndex({
  fromScratch,
  activity,
  previous,
  onBaseline,
  ...options
}: Omit<RefreshOptions, 'previous'> & {
  fromScratch: boolean;
  activity: ActivityLog;
  previous?: SyncBaseline;
  /** Told the baseline before anything is written, so a sync that fails can be tried again from it. */
  onBaseline?: (baseline: SyncBaseline) => void;
}): Promise<IndexSync> {
  // Taken before the first wait: a rebuild finishing after a switch is still this vault's.
  const recorder = activity.inOpenVault();
  try {
    const opening = await options.index.open();
    const baseline =
      previous !== undefined
        ? previous
        : opening.fresh
          ? null
          : await versionsHeld(options.index, fromScratch);
    onBaseline?.(baseline);
    if (fromScratch) await options.index.clear();
    const measuredFrom = baseline ?? new Map<string, NoteVersion>();
    const refresh = await refreshIndex({ ...options, previous: measuredFrom });
    const stats = await options.index.stats();
    if (fromScratch) recorder.record(indexRebuiltReport(stats.notes));
    return {
      stats,
      changes: baseline === null ? [] : refresh.changes,
      versions: versionsAfter(measuredFrom, refresh.changes),
    };
  } catch (cause) {
    const problem = messageWithoutPaths(cause);
    recorder.record(indexFailedReport({ rebuilding: fromScratch, problem }));
    throw cause;
  }
}

/**
 * The notes the index holds, asked before a rebuild clears them, so reading
 * them all again is not mistaken for their arriving.
 */
async function versionsHeld(
  index: IndexPort,
  fromScratch: boolean,
): Promise<Map<string, NoteVersion>> {
  try {
    const entries = await index.manifest();
    return new Map(
      entries.map((entry) => [entry.path, { type: entry.type, digest: entry.digest }]),
    );
  } catch (cause) {
    // A rebuild is the remedy for an index that cannot answer, so it must not
    // wait on one: it goes ahead, and its notes are reported as added. Any
    // other sync fails here, as its refresh would on asking the same question.
    if (fromScratch) return new Map();
    throw cause;
  }
}

/**
 * The one way the app brings the index in line with the vault: on opening it,
 * after every change, and when asked to rebuild it.
 *
 * Syncs run one after another, so two never read the same change and report
 * it twice. Each publishes what changed since the last one in the same vault —
 * remembered here rather than read from the index, which a rebuild clears and
 * a delete in the app lets go of before the sync that follows can see it. A
 * sync that fails is tried again from the same baseline, so what it found is
 * not lost with it.
 *
 * The host's ports answer for whichever vault is open, so a sync asked for a
 * vault that is no longer open — queued before a switch, or caught by one —
 * would read the other vault's notes under this one's name. It is dropped
 * instead: nothing is published or remembered, and it settles with null.
 */
export interface IndexSyncer {
  /** Settles with what the index then holds, after any sync already under way; null when dropped. */
  sync(args: {
    /** The vault being synced: what is remembered of another is not this one's past. */
    vault: string;
    fromScratch: boolean;
    onProgress?: RefreshOptions['onProgress'];
  }): Promise<IndexStats | null>;
}

export function createIndexSyncer({
  changes,
  openVault,
  ...ports
}: Omit<RefreshOptions, 'onProgress' | 'previous'> & {
  activity: ActivityLog;
  /** Where each sync's changes are published, when it has any. */
  changes: NoteChanges;
  /** The vault open now, which the host's ports answer for; null when none is. */
  openVault: () => string | null;
}): IndexSyncer {
  let queue: Promise<unknown> = Promise.resolve();
  let remembered: { vault: string; versions: SyncBaseline } | null = null;

  const syncOnce: IndexSyncer['sync'] = async ({ vault, fromScratch, onProgress }) => {
    if (openVault() !== vault) return null;
    const previous = remembered?.vault === vault ? remembered.versions : undefined;
    const synced = await syncIndex({
      ...ports,
      fromScratch,
      ...(onProgress !== undefined && { onProgress }),
      ...(previous !== undefined && { previous }),
      onBaseline: (baseline) => {
        remembered = { vault, versions: baseline };
      },
    });
    // What was read may have been another vault's, opened while this sync ran.
    if (openVault() !== vault) return null;
    remembered = { vault, versions: synced.versions };
    if (synced.changes.length > 0) changes.publish({ vault, changes: synced.changes });
    return synced.stats;
  };

  return {
    sync(args) {
      const next = queue.then(() => syncOnce(args));
      // The queue only orders; each caller gets its own sync's outcome.
      queue = next.catch(() => undefined);
      return next;
    },
  };
}
