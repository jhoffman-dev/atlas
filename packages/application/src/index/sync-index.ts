import { indexFailedReport, indexRebuiltReport, messageWithoutPaths } from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import type { IndexStats } from './ports.ts';
import { refreshIndex, type RefreshOptions } from './refresh-index.ts';

/**
 * Opens the index and brings it in line with the vault — from nothing, when
 * asked to rebuild it. Settles with what it then holds.
 *
 * A rebuild, and any failure, is said in the Activity log (U-28); the refresh
 * every change sets off is not, since it is routine. The failure is passed on
 * as well, for the window to show.
 */
export async function syncIndex({
  fromScratch,
  activity,
  ...options
}: RefreshOptions & { fromScratch: boolean; activity: ActivityLog }): Promise<IndexStats> {
  // Taken before the first wait: a rebuild finishing after a switch is still this vault's.
  const recorder = activity.inOpenVault();
  try {
    await options.index.open();
    if (fromScratch) await options.index.clear();
    await refreshIndex(options);
    const stats = await options.index.stats();
    if (fromScratch) recorder.record(indexRebuiltReport(stats.notes));
    return stats;
  } catch (cause) {
    const problem = messageWithoutPaths(cause);
    recorder.record(indexFailedReport({ rebuilding: fromScratch, problem }));
    throw cause;
  }
}
