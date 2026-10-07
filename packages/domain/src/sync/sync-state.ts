/**
 * What a sync did, and what the vault's sync state therefore is (U-29) —
 * one word for the sidebar and a line for Settings.
 */

export interface ConflictCopy {
  /** The file both Macs changed, or made under names that differ only in case. */
  readonly path: string;
  /** Where the version that could not stay at `path` was saved. */
  readonly copy: string;
  /**
   * Whose version the copy holds: the other Mac's, when both changed a file
   * (this Mac's stays in place); this Mac's, when the other Mac's file of a
   * name differing only in case took the name.
   */
  readonly whose: 'theirs' | 'ours';
}

export interface SyncReport {
  /** When the sync finished, by the injected clock. */
  readonly at: number;
  /** Whether this Mac's changes were committed. */
  readonly committed: boolean;
  /** Whether the other Macs' changes were merged in. */
  readonly pulled: boolean;
  readonly pushed: boolean;
  readonly conflicts: readonly ConflictCopy[];
  /** What stays on this Mac unsynced: files over GitHub's limit, and repositories of their own. */
  readonly notSynced: readonly string[];
  /** Atlas's own files a line of the vault's `.gitignore` keeps out, by file or folder (issue #8). */
  readonly ignored: readonly string[];
}

export type SyncPhase =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-set-up' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'synced'; readonly report: SyncReport }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly reason: string; readonly at: number };

export type SyncTone = 'quiet' | 'paused' | 'busy' | 'ok' | 'behind' | 'warning' | 'error';

/** What the sidebar's light knows beside the phase: whether sync is paused, and how far behind GitHub it is. */
export interface SyncLightFacts {
  readonly paused: boolean;
  /** Other Macs' commits fetched and not yet brought in. */
  readonly behind: number;
}

/**
 * How a synced vault stands, the one thing the sidebar's light and Settings
 * both show, in one order: a sync under way says so over everything; a
 * pause the person chose over how the last sync went, which it has made old
 * news; a failure over being behind; being behind over the last sync.
 */
export type SyncStanding =
  | { readonly kind: 'syncing' }
  | { readonly kind: 'paused' }
  | { readonly kind: 'failed'; readonly at: number }
  | { readonly kind: 'behind'; readonly count: number }
  | { readonly kind: 'not-synced-yet' }
  | { readonly kind: 'synced'; readonly report: SyncReport };

/** How the vault stands; null for a vault that does not sync, or before that is known. */
export function syncStanding(
  phase: SyncPhase,
  { paused, behind }: SyncLightFacts = { paused: false, behind: 0 },
): SyncStanding | null {
  switch (phase.kind) {
    case 'unknown':
    case 'not-set-up':
    case 'refused':
      return null;
    case 'syncing':
      return { kind: 'syncing' };
    default:
      break;
  }
  if (paused) return { kind: 'paused' };
  if (phase.kind === 'failed') return { kind: 'failed', at: phase.at };
  if (behind > 0) return { kind: 'behind', count: behind };
  if (phase.kind === 'ready') return { kind: 'not-synced-yet' };
  return { kind: 'synced', report: phase.report };
}

/**
 * How the sidebar's light shows the vault's sync: a tone and a word or two —
 * synced, syncing, behind, failed, paused — or nothing for a vault that
 * does not sync.
 */
export function syncBadge(
  phase: SyncPhase,
  facts?: SyncLightFacts,
): { tone: SyncTone; label: string } | null {
  const standing = syncStanding(phase, facts);
  switch (standing?.kind) {
    case undefined:
      return null;
    case 'syncing':
      return { tone: 'busy', label: 'Syncing…' };
    case 'paused':
      return { tone: 'paused', label: 'Sync paused' };
    case 'failed':
      return { tone: 'error', label: 'Sync failed' };
    case 'behind':
      return { tone: 'behind', label: behindCount(standing.count) };
    case 'not-synced-yet':
      return { tone: 'quiet', label: 'Not synced yet' };
    case 'synced':
      return standing.report.conflicts.length > 0
        ? { tone: 'warning', label: conflictCount(standing.report.conflicts.length) }
        : { tone: 'ok', label: 'Synced' };
  }
}

function behindCount(count: number): string {
  return count === 1 ? '1 change to bring in' : `${count} changes to bring in`;
}

function conflictCount(count: number): string {
  return count === 1 ? '1 conflict' : `${count} conflicts`;
}

/** The Activity log's line for a finished sync. */
export function syncActivityMessage(report: SyncReport): string {
  const parts = [
    report.committed ? 'saved this Mac’s changes' : null,
    report.pulled ? 'brought in changes from other Macs' : null,
    report.pushed ? 'sent them to GitHub' : null,
  ].filter((part): part is string => part !== null);
  const did = parts.length === 0 ? 'nothing had changed' : parts.join(', ');
  const conflicts =
    report.conflicts.length === 0
      ? ''
      : ` Both Macs changed ${report.conflicts.length === 1 ? 'a file' : `${report.conflicts.length} files`}; this Mac’s version was kept and the other saved beside it.`;
  return `Synced: ${did}.${conflicts}`;
}
