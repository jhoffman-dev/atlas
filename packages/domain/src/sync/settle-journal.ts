/**
 * The journal a settle keeps (A29-01), so a sync the app quit part-way
 * through is finished the next time, never guessed at. It is written once
 * the merge has stopped on its conflicts and before any file is touched,
 * and holds, for each conflicted file, what git wrote into it and where the
 * other Mac's version is to be saved. Each step after it can be run again:
 * none writes over this Mac's file unless it still holds exactly what git
 * wrote.
 *
 * It also holds every copy made and not yet said (review A29-01): a sync the
 * app quit after making one never reported it, so the next sync does, and
 * only a sync that finishes clears them.
 */
import type { GitConflict } from './git-status.ts';
import type { ConflictCopy } from './sync-state.ts';

export interface JournalFile {
  readonly path: string;
  /** The blob of what git wrote into the file when the merge stopped; null when it wrote none. */
  readonly merged: string | null;
  /** The two sides' blobs, which say the entry is about this conflict and not an older one. */
  readonly ours: string | null;
  readonly theirs: string | null;
  /** Where the other Mac's version is saved; null when it is not copied. */
  readonly copy: string | null;
}

export interface SettleJournal {
  /**
   * The commit being merged in (`MERGE_HEAD`), so a journal of another merge
   * is never used; null before a merge has stopped on conflicts.
   */
  readonly mergeHead: string | null;
  readonly files: readonly JournalFile[];
  /** The copies made — or about to be — that no finished sync has reported yet. */
  readonly unreported: readonly ConflictCopy[];
}

/** A journal that says nothing yet. */
export const EMPTY_JOURNAL: SettleJournal = { mergeHead: null, files: [], unreported: [] };

/** The journal, with these copies among those still to be reported, each once. */
export function withUnreported(
  journal: SettleJournal,
  copies: readonly ConflictCopy[],
): SettleJournal {
  const known = new Set(journal.unreported.map(({ copy }) => copy));
  const added = copies.filter(({ copy }) => !known.has(copy));
  return { ...journal, unreported: [...journal.unreported, ...added] };
}

const VERSION = 1;

export function journalText(journal: SettleJournal): string {
  return `${JSON.stringify({ version: VERSION, ...journal }, null, 2)}\n`;
}

const isBlob = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && /^[0-9a-f]{40,64}$/.test(value));

function isJournalFile(value: unknown): value is JournalFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file['path'] === 'string' &&
    isBlob(file['merged']) &&
    isBlob(file['ours']) &&
    isBlob(file['theirs']) &&
    (file['copy'] === null || typeof file['copy'] === 'string')
  );
}

function isCopy(value: unknown): value is ConflictCopy {
  if (typeof value !== 'object' || value === null) return false;
  const copy = value as Record<string, unknown>;
  return (
    typeof copy['path'] === 'string' &&
    typeof copy['copy'] === 'string' &&
    (copy['whose'] === 'theirs' || copy['whose'] === 'ours')
  );
}

/** The journal the text holds; null for none, or for one this version cannot trust. */
export function parseJournal(text: string | null): SettleJournal | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    // Cut off mid-write cannot happen (the host writes it whole), but a
    // journal that cannot be read is one that says nothing: the settle
    // then decides as it would without one.
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const journal = value as Record<string, unknown>;
  const { files, mergeHead, unreported = [] } = journal;
  if (
    journal['version'] !== VERSION ||
    (mergeHead !== null && typeof mergeHead !== 'string') ||
    !Array.isArray(files) ||
    !files.every(isJournalFile) ||
    !Array.isArray(unreported) ||
    !unreported.every(isCopy)
  ) {
    return null;
  }
  return { mergeHead, files, unreported };
}

/** The journal's entry for this conflict of this merge, if it has one. */
export function journalEntryFor({
  journal,
  mergeHead,
  conflict,
}: {
  journal: SettleJournal | null;
  mergeHead: string | null;
  conflict: GitConflict;
}): JournalFile | null {
  if (journal === null || mergeHead === null || journal.mergeHead !== mergeHead) return null;
  return (
    journal.files.find(
      (file) =>
        file.path === conflict.path &&
        file.ours === (conflict.ours?.oid ?? null) &&
        file.theirs === (conflict.theirs?.oid ?? null),
    ) ?? null
  );
}

/**
 * What becomes of this Mac's file when both Macs changed it: it stays as it
 * is, or git's copy of this Mac's side is written over it. Only a file that
 * still holds exactly what the merge wrote — its markers — is written over:
 * typing done into it since, below the markers or anywhere, is this Mac's
 * newest version and stays. A file that is gone gets this Mac's side back.
 *
 * Without the journal (the app quit in the moment between the merge and
 * writing it, or the merge was started by hand) what git wrote is not known:
 * the file is then this Mac's side, or it is written over with it. Both
 * sides are saved either way; typing into markers in that moment is the one
 * thing that would not be.
 */
export function thisMacsFileAfterConflict({
  current,
  merged,
  ours,
}: {
  /** The file's blob now; null when it is not there. */
  current: string | null;
  /** What git wrote into it, from the journal; null when not known. */
  merged: string | null;
  /** This Mac's side's blob. */
  ours: string;
}): 'as-is' | 'ours' {
  if (current === null) return 'ours';
  if (merged !== null) return current === merged && current !== ours ? 'ours' : 'as-is';
  return current === ours ? 'as-is' : 'ours';
}
