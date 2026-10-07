/**
 * Reads the listings git prints for a sync (A29-01): paths, the index, a
 * tree, and the large blobs a history holds. The host hands the text back
 * untouched; what it means is decided here.
 */

/** An entry of the index or of a tree: a file's mode, its blob, and where it is. */
export interface GitEntry {
  readonly mode: string;
  readonly oid: string;
  readonly path: string;
}

/** An index entry, with its stage: 0 when settled, 1 to 3 while a merge is in conflict. */
export interface IndexEntry extends GitEntry {
  readonly stage: number;
}

export class GitListingError extends Error {
  constructor(message: string) {
    super(`git's listing could not be read: ${message}`);
    this.name = 'GitListingError';
  }
}

/** The paths of a `-z` listing, one per NUL. */
export function parsePathList(raw: string): readonly string[] {
  return raw.split('\0').filter((path) => path !== '');
}

/** `ls-files -z --stage`: `<mode> <oid> <stage>\t<path>`. */
export function parseIndexEntries(raw: string): readonly IndexEntry[] {
  return parsePathList(raw).map((record) => {
    const match = /^(\d{6}) ([0-9a-f]{40,64}) ([0-3])\t(.+)$/s.exec(record);
    if (match === null) throw new GitListingError(`an index entry ${JSON.stringify(record)}`);
    const [, mode = '', oid = '', stage = '0', path = ''] = match;
    return { mode, oid, stage: Number(stage), path };
  });
}

/** `ls-tree -r -z`: `<mode> <type> <oid>\t<path>`, the files of a commit by path. */
export function parseTree(raw: string): ReadonlyMap<string, GitEntry> {
  const entries = new Map<string, GitEntry>();
  for (const record of parsePathList(raw)) {
    const match = /^(\d{6}) (\w+) ([0-9a-f]{40,64})\t(.+)$/s.exec(record);
    if (match === null) throw new GitListingError(`a tree entry ${JSON.stringify(record)}`);
    const [, mode = '', , oid = '', path = ''] = match;
    entries.set(path, { mode, oid, path });
  }
  return entries;
}

/** The blobs `rev-list --filter-print-omitted` left out, each on a line of its own after `~`. */
export function parseOmittedObjects(raw: string): ReadonlySet<string> {
  const omitted = new Set<string>();
  for (const line of raw.split('\n')) {
    const match = /^~([0-9a-f]{40,64})$/.exec(line.trim());
    if (match?.[1] !== undefined) omitted.add(match[1]);
  }
  return omitted;
}
