import { insideVault, sourceRefreshReport, sourceTrustRefusal } from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import { refreshSource, type SourceReport } from './refresh-source.ts';

export type SourceRefreshArgs = Parameters<typeof refreshSource>[0];

/**
 * The one way a source is refreshed: its pane's timer, its Refresh button and
 * the local API all go through the same refresher, which the app makes once.
 */
export interface SourceRefresher {
  /**
   * Refreshes the source unless it is being refreshed already; null when it is.
   * A source that may not run from where its note is (`sourceTrustRefusal`)
   * reads nothing: its report says why and where to move it.
   */
  refresh(args: SourceRefreshArgs): Promise<SourceReport | null>;
}

/**
 * Each refresh that ran — or was refused — is said in the Activity log
 * (U-28): what it brought in, or why it failed. One already under way is not.
 */
export function createSourceRefresher({ activity }: { activity: ActivityLog }): SourceRefresher {
  // A second refresh of the same source must not join the first: it would
  // plan against notes the first has not finished writing, and make them twice.
  const running = new Set<string>();
  const told = (args: SourceRefreshArgs, report: SourceReport): SourceReport => {
    const path = insideVault(args.sourcePath);
    // The vault the refresh ran in, which another may have replaced by the time it answers.
    if (path !== null) activity.inVault(args.vault).record(sourceRefreshReport(path, report));
    return report;
  };

  return {
    async refresh(args) {
      const refusal = sourceTrustRefusal({ source: args.source, sourcePath: args.sourcePath });
      if (refusal !== null) return told(args, refusedReport({ args, refusal }));
      const key = `${args.vault}\n${args.sourcePath}`;
      if (running.has(key)) return null;
      running.add(key);
      try {
        return told(args, await refreshSource(args));
      } finally {
        running.delete(key);
      }
    },
  };
}

/** A report of a refresh that read nothing, saying why. */
function refusedReport({
  args,
  refusal,
}: {
  args: SourceRefreshArgs;
  refusal: string;
}): SourceReport {
  return {
    ran: args.now,
    from: args.source.url ?? args.source.file ?? '',
    records: 0,
    created: 0,
    replaced: 0,
    updated: 0,
    missing: 0,
    unkeyed: 0,
    truncated: false,
    error: refusal,
  };
}
