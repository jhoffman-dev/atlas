/**
 * Reads what `git status --porcelain=v2 --branch -z --untracked-files=all`
 * prints (U-29). The host hands the text back untouched; what it means is
 * decided here.
 */

/** How git marks a file both sides changed, as the two letters of an unmerged entry. */
export const CONFLICT_CODES = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'] as const;
export type ConflictCode = (typeof CONFLICT_CODES)[number];

/** One side of a conflicted file as the index holds it: its mode and blob. */
export interface ConflictSide {
  readonly mode: string;
  readonly oid: string;
}

export interface GitConflict {
  readonly path: string;
  readonly code: ConflictCode;
  /** The version both sides started from; null when both added the file. */
  readonly base: ConflictSide | null;
  /** This Mac's version (stage 2); null when this Mac deleted it. */
  readonly ours: ConflictSide | null;
  /** The other Macs' version (stage 3); null when they deleted it. */
  readonly theirs: ConflictSide | null;
}

export interface GitStatus {
  /** The branch checked out; null when HEAD is detached. */
  readonly branch: string | null;
  /** Whether the branch has a commit yet. */
  readonly born: boolean;
  /** The branch it tracks, e.g. `origin/main`; null when it tracks none. */
  readonly upstream: string | null;
  /** Commits here the upstream lacks, and there that are not here; 0 without an upstream. */
  readonly ahead: number;
  readonly behind: number;
  /**
   * Whether git compared the branch with its upstream. It cannot when the
   * upstream is not on the remote yet — a clone of an empty repository — and
   * then nothing here has reached the remote.
   */
  readonly compared: boolean;
  /** Paths with changes to commit, staged or not, untracked included. */
  readonly changed: readonly string[];
  /** Paths whose change is staged: what a commit now would hold. */
  readonly staged: readonly string[];
  /**
   * Paths git does not track. A folder that is a repository of its own is
   * one entry ending in `/`: git never looks inside it.
   */
  readonly untracked: readonly string[];
  /** Paths a merge left unresolved. */
  readonly conflicts: readonly GitConflict[];
}

export class GitStatusError extends Error {
  constructor(message: string) {
    super(`git status could not be read: ${message}`);
    this.name = 'GitStatusError';
  }
}

/** The fields before the path in each kind of entry. */
const FIELDS_BEFORE_PATH = { '1': 8, '2': 9, u: 10 } as const;

export function parseGitStatus(raw: string): GitStatus {
  const status = {
    branch: null as string | null,
    born: true,
    upstream: null as string | null,
    ahead: 0,
    behind: 0,
    compared: false,
    changed: [] as string[],
    staged: [] as string[],
    untracked: [] as string[],
    conflicts: [] as GitConflict[],
  };
  const records = raw.split('\0');
  for (let at = 0; at < records.length; at += 1) {
    const record = records[at] ?? '';
    if (record === '') continue;
    if (record.startsWith('# ')) readHeader(record.slice(2), status);
    else if (record.startsWith('? ')) {
      status.changed.push(record.slice(2));
      status.untracked.push(record.slice(2));
    } else if (record.startsWith('! ')) continue;
    else {
      const kind = record[0];
      if (kind !== '1' && kind !== '2' && kind !== 'u') {
        throw new GitStatusError(`an entry of an unknown kind: ${JSON.stringify(record)}`);
      }
      const fields = splitFields(record, FIELDS_BEFORE_PATH[kind]);
      if (kind === 'u') status.conflicts.push(conflictOf(record, fields));
      else {
        status.changed.push(fields.path);
        // `XY`: X is the index's side, `.` when nothing there is staged.
        if (fields.code[0] !== '.') status.staged.push(fields.path);
      }
      // A rename is followed by the path it came from, as a record of its own.
      if (kind === '2') at += 1;
    }
  }
  return status;
}

function readHeader(
  header: string,
  status: {
    branch: string | null;
    born: boolean;
    upstream: string | null;
    ahead: number;
    behind: number;
    compared: boolean;
  },
): void {
  const space = header.indexOf(' ');
  const key = space === -1 ? header : header.slice(0, space);
  const value = space === -1 ? '' : header.slice(space + 1);
  if (key === 'branch.oid') status.born = value !== '(initial)';
  else if (key === 'branch.head') status.branch = value === '(detached)' ? null : value;
  else if (key === 'branch.upstream') status.upstream = value;
  else if (key === 'branch.ab') {
    const match = /^\+(\d+) -(\d+)$/.exec(value);
    if (match === null) throw new GitStatusError(`ahead and behind as ${JSON.stringify(value)}`);
    status.ahead = Number(match[1]);
    status.behind = Number(match[2]);
    status.compared = true;
  }
}

/** The entry's code and its path, which may itself hold spaces. */
function splitFields(record: string, before: number): { code: string; path: string } {
  let from = 0;
  for (let field = 0; field < before; field += 1) {
    const space = record.indexOf(' ', from);
    if (space === -1) throw new GitStatusError(`a short entry: ${JSON.stringify(record)}`);
    from = space + 1;
  }
  const path = record.slice(from);
  if (path === '') throw new GitStatusError(`an entry without a path: ${JSON.stringify(record)}`);
  return { code: record.slice(2, 4), path };
}

/** A mode of zeros is git's way of saying that side has no file. */
const NO_FILE = /^0+$/;

/**
 * An unmerged entry — `u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>`
 * — with the modes and blobs of the base, this Mac's side and the other's.
 */
function conflictOf(record: string, { code, path }: { code: string; path: string }): GitConflict {
  if (!(CONFLICT_CODES as readonly string[]).includes(code)) {
    throw new GitStatusError(`an unmerged entry marked ${JSON.stringify(code)}`);
  }
  const [, , , m1, m2, m3, , h1, h2, h3] = record.split(' ');
  const side = (mode: string | undefined, oid: string | undefined): ConflictSide | null =>
    mode === undefined || oid === undefined || NO_FILE.test(mode) ? null : { mode, oid };
  return {
    path,
    code: code as ConflictCode,
    base: side(m1, h1),
    ours: side(m2, h2),
    theirs: side(m3, h3),
  };
}
