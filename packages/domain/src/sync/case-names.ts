/**
 * Names that differ only in case, on a Mac whose disk does not tell them
 * apart (A29-01). git on such a disk misses a note renamed only in case, and
 * a merge that brings in `Idea.md` beside this Mac's `idea.md` writes one
 * over the other. Both are found here, before git is asked to do either.
 */
import type { GitEntry } from './git-listings.ts';

/** How macOS compares two names: case folded, and composed and decomposed accents alike. */
export function foldedPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/** A note renamed only in case on this Mac: from its spelling in the index to the one on disk. */
export interface CaseRename {
  readonly from: string;
  readonly to: string;
}

/**
 * The renames git missed: a path on disk that git, comparing names exactly,
 * does not track, but that it tracks under another case when it ignores
 * case. On a disk that tells case apart the two listings agree, and there
 * are none.
 */
export function caseRenames({
  tracked,
  untrackedExact,
  untracked,
}: {
  /** The index's paths. */
  tracked: readonly string[];
  /** Untracked paths, compared by exact spelling. */
  untrackedExact: readonly string[];
  /** Untracked paths, as git compares them on this disk. */
  untracked: readonly string[];
}): readonly CaseRename[] {
  const reallyNew = new Set(untracked);
  const byFolded = new Map<string, string[]>();
  for (const path of tracked) {
    const key = foldedPath(path);
    byFolded.set(key, [...(byFolded.get(key) ?? []), path]);
  }
  const renames: CaseRename[] = [];
  for (const to of untrackedExact) {
    if (reallyNew.has(to) || to.endsWith('/')) continue;
    const spellings = (byFolded.get(foldedPath(to)) ?? []).filter((path) => path !== to);
    const [from] = spellings;
    // Two tracked spellings of one name cannot both be this file: leave it be.
    if (from !== undefined && spellings.length === 1) renames.push({ from, to });
  }
  return renames;
}

/**
 * This Mac's paths to move aside before a merge, so none is written over:
 * those the merge would keep beside another Mac's path that differs only in
 * case. A path a side kept unchanged while the other deleted it is not kept
 * — that is a case-only rename, which the merge carries through.
 */
export function caseCollisions({
  base,
  ours,
  theirs,
}: {
  base: ReadonlyMap<string, GitEntry>;
  ours: ReadonlyMap<string, GitEntry>;
  theirs: ReadonlyMap<string, GitEntry>;
}): readonly string[] {
  const keeps = (side: ReadonlyMap<string, GitEntry>, other: ReadonlyMap<string, GitEntry>) =>
    [...side.values()]
      .filter(({ path, oid }) => other.has(path) || base.get(path)?.oid !== oid)
      .map(({ path }) => path);
  const theirsByFolded = new Map<string, string[]>();
  for (const path of keeps(theirs, ours)) {
    if (ours.has(path)) continue;
    const key = foldedPath(path);
    theirsByFolded.set(key, [...(theirsByFolded.get(key) ?? []), path]);
  }
  return keeps(ours, theirs).filter(
    (path) => !theirs.has(path) && theirsByFolded.has(foldedPath(path)),
  );
}
