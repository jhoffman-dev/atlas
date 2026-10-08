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

export interface IndexSync {
  /** What the index holds once it is in line with the vault. */
  readonly stats: IndexStats;
  /** Each note added, changed or removed since `previous`, or since what the index held. */
  readonly changes: readonly NoteChange[];
  /** Every note as it now is: the `previous` of the next sync. */
  readonly versions: ReadonlyMap<string, NoteVersion>;
}

/**
 * Opens the index and brings it in line with the vault — from nothing, when
 * asked to rebuild it — and says which notes changed on the way.
 *
 * A rebuild, and any failure, is said in the Activity log (U-28); the refresh
 * every change sets off is not, since it is routine. The failure is passed on
 * as well, for the window to show.
 */
export async function syncIndex({
  fromScratch,
  activity,
  ...options
}: RefreshOptions & { fromScratch: boolean; activity: ActivityLog }): Promise<IndexSync> {
  // Taken before the first wait: a rebuild finishing after a switch is still this vault's.
  const recorder = activity.inOpenVault();
  try {
    await options.index.open();
    const previous = options.previous ?? (await versionsHeld(options.index, fromScratch));
    if (fromScratch) await options.index.clear();
    const refresh = await refreshIndex({ ...options, previous });
    const stats = await options.index.stats();
    if (fromScratch) recorder.record(indexRebuiltReport(stats.notes));
    return { stats, changes: refresh.changes, versions: versionsAfter(previous, refresh.changes) };
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
 * a delete in the app lets go of before the sync that follows can see it.
 */
export interface IndexSyncer {
  /** Settles with what the index then holds, after any sync already under way. */
  sync(args: {
    /** The vault being synced: what is remembered of another is not this one's past. */
    vault: string;
    fromScratch: boolean;
    onProgress?: RefreshOptions['onProgress'];
  }): Promise<IndexStats>;
}

export function createIndexSyncer({
  changes,
  ...ports
}: Omit<RefreshOptions, 'onProgress' | 'previous'> & {
  activity: ActivityLog;
  /** Where each sync's changes are published, when it has any. */
  changes: NoteChanges;
}): IndexSyncer {
  let queue: Promise<unknown> = Promise.resolve();
  let remembered: { vault: string; versions: ReadonlyMap<string, NoteVersion> } | null = null;

  const syncOnce: IndexSyncer['sync'] = async ({ vault, fromScratch, onProgress }) => {
    const previous = remembered?.vault === vault ? remembered.versions : undefined;
    const synced = await syncIndex({
      ...ports,
      fromScratch,
      ...(onProgress !== undefined && { onProgress }),
      ...(previous !== undefined && { previous }),
    });
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
