/**
 * What a sync leaves out of git, on this Mac only (A29-01), and says so:
 *
 * - a file over GitHub's size limit, which GitHub refuses, and which would
 *   stop every push after it: it stays on this Mac, unsynced;
 * - a folder that is a git repository of its own — a project cloned into
 *   the vault — which git would record as a bare pointer the other Mac
 *   cannot open.
 *
 * They are kept out through the vault's own excludes file, inside `.git`,
 * which never syncs: another Mac leaves out only what it has itself.
 */

/**
 * GitHub refuses a file of 100 MiB or more; a little under that is where
 * Atlas stops, so what it sends is never refused.
 */
export const LARGE_FILE_BYTES = 95 * 1024 * 1024;

export interface LeftOut {
  /** Files at or over {@link LARGE_FILE_BYTES}. */
  readonly large: readonly string[];
  /** Folders that are repositories of their own, each ending in `/`. */
  readonly nested: readonly string[];
}

export const NOTHING_LEFT_OUT: LeftOut = { large: [], nested: [] };

/** The folders among git's untracked paths that are repositories of their own. */
export function nestedRepositories(untracked: readonly string[]): readonly string[] {
  return untracked.filter((path) => path.endsWith('/'));
}

/** The files, by size, that are too large to sync. */
export function largeFiles(sizes: ReadonlyMap<string, number>): readonly string[] {
  return [...sizes].filter(([, size]) => size >= LARGE_FILE_BYTES).map(([path]) => path);
}

/**
 * A path as a gitignore pattern that matches it alone: anchored at the
 * vault's top, with every character git reads as a wildcard escaped.
 */
function exactPattern(path: string): string {
  const escaped = path.replace(/[\\*?[\]!#]/g, (character) => `\\${character}`);
  // Trailing spaces are dropped from a pattern unless escaped.
  return `/${escaped.replace(/ $/, '\\ ')}`;
}

const HEADER =
  '# Kept out of sync on this Mac by Atlas: files over GitHub’s size limit, and folders that are repositories of their own.';

/** The excludes file for what is left out. */
export function excludesText(leftOut: LeftOut): string {
  const paths = [...leftOut.nested, ...leftOut.large].sort();
  return [HEADER, ...paths.map(exactPattern), ''].join('\n');
}

/** What an excludes file Atlas wrote says is left out. */
export function parseExcludes(text: string | null): LeftOut {
  if (text === null) return NOTHING_LEFT_OUT;
  const paths = text
    .split('\n')
    .filter((line) => line.startsWith('/'))
    .map((line) => line.slice(1).replace(/\\(.)/g, '$1'));
  return {
    nested: paths.filter((path) => path.endsWith('/')),
    large: paths.filter((path) => !path.endsWith('/')),
  };
}

/** What is newly left out since last time, to warn about once rather than every sync. */
export function newlyLeftOut({ before, now }: { before: LeftOut; now: LeftOut }): LeftOut {
  return {
    large: now.large.filter((path) => !before.large.includes(path)),
    nested: now.nested.filter((path) => !before.nested.includes(path)),
  };
}

/** The Activity log's warning for what is newly left out, one line each. */
export function leftOutWarnings(leftOut: LeftOut): readonly string[] {
  return [
    ...leftOut.large.map(
      (path) =>
        `${path} is over GitHub’s 100 MB limit, so it isn’t synced. It stays on this Mac; to share it, make it smaller or keep it outside the vault.`,
    ),
    ...leftOut.nested.map(
      (folder) =>
        `${folder.replace(/\/$/, '')} is a git repository of its own, so only that folder isn’t synced: it stays on this Mac, and the rest of the vault still syncs. If it doesn’t belong in the vault, move it out.`,
    ),
  ];
}
