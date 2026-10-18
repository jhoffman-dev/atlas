import { createVaultPath, isMarkdownName, parentVaultPath } from '@atlas/domain';
import {
  isEchoOf,
  noteSavedThrough,
  type FoundVersion,
  type LeftVersion,
  type OwnWrites,
} from './own-writes.ts';
import type { VaultFsPort } from './ports.ts';

type Fs = Pick<VaultFsPort, 'readNotes' | 'listDirectory'>;

interface Judged {
  readonly path: string;
  readonly left: LeftVersion;
}

const UNKNOWN: FoundVersion = { kind: 'unknown' };

/**
 * The paths of a watcher report that still need a refresh (#254). A path is
 * the echo of the app's own write, and dropped, only when the app has
 * already refreshed for that write and what is there now is exactly what the
 * write left (`isEchoOf`), read now: one read of every path, and for a path
 * the app emptied, a listing of its folder while there are few (see
 * `emptiedNow`). A save's temporary file is the app's own while a
 * write of the app's to its note is kept — the save, or the move that took
 * the note on from there — and nothing reads it. Every other path, and any
 * path a read could not tell about, is kept: when in doubt, the app refreshes.
 */
export async function outsideChanges({
  fs,
  ownWrites,
  vault,
  paths,
}: {
  fs: Fs;
  ownWrites: OwnWrites;
  vault: string;
  paths: readonly string[];
}): Promise<readonly string[]> {
  const ours = (path: string) => {
    const note = noteSavedThrough(path);
    return note !== null && ownWrites.leftAt({ vault, path: note }) !== null;
  };
  const judged: Judged[] = [];
  for (const path of paths) {
    const left = ownWrites.refreshedAt({ vault, path });
    if (left !== null) judged.push({ path, left });
  }
  const found = await foundNow(fs, judged);
  const echoes = new Set(
    judged
      .filter(({ path, left }) => isEchoOf(left, found.get(path) ?? UNKNOWN))
      .map(({ path }) => path),
  );
  return paths.filter((path) => !echoes.has(path) && !ours(path));
}

/**
 * The most folders listed to tell whether a path the app emptied is still
 * empty. Past it, a refresh's one walk of the vault would cost less.
 */
const MOST_FOLDERS_LISTED = 2;

/**
 * What is at each judged path now: one read of them all, then, for a path the
 * app emptied that the read found no note at, whether anything else is there.
 */
async function foundNow(fs: Fs, judged: readonly Judged[]): Promise<Map<string, FoundVersion>> {
  const found = await readNow(
    fs,
    judged.map(({ path }) => path),
  );
  if (found === null) return new Map();
  const emptied = judged
    .filter(({ path, left }) => left.kind === 'absent' && !found.has(path))
    .map(({ path }) => path);
  for (const [path, version] of await emptiedNow(fs, emptied)) found.set(path, version);
  return found;
}

/** Each path the host reads as a note now, or null when the read failed and told nothing. */
async function readNow(
  fs: Fs,
  paths: readonly string[],
): Promise<Map<string, FoundVersion> | null> {
  if (paths.length === 0) return new Map();
  const files = await fs.readNotes(paths).catch(() => null);
  if (files === null) return null;
  return new Map(
    files.map(({ path, text, modified }) => [path, { kind: 'text', text, modified }] as const),
  );
}

/**
 * Whether each path the read found no note at is empty, a folder or another
 * file: from one listing of each folder holding one, while there are few
 * enough. Past that, a note's path the read found nothing at is taken as
 * empty, and any other path is unknown and refreshed for.
 */
async function emptiedNow(fs: Fs, paths: readonly string[]): Promise<[string, FoundVersion][]> {
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const folder = folderOf(path);
    if (folder !== null) byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
  }
  if (byFolder.size > MOST_FOLDERS_LISTED) {
    return paths.filter(isNotePath).map((path) => [path, { kind: 'absent' }]);
  }
  const listings = await Promise.all(
    [...byFolder].map(async ([folder, inIt]) => {
      // A folder that cannot be listed tells nothing: its paths stay unknown.
      const listed = await fs.listDirectory(createVaultPath(folder)).catch(() => null);
      if (listed === null) return [];
      const entries = new Map(listed.map((entry) => [entry.path as string, entry.kind]));
      return inIt.map((path): [string, FoundVersion] => {
        const kind = entries.get(path);
        if (kind === undefined) return [path, { kind: 'absent' }];
        return [path, { kind: kind === 'directory' ? 'directory' : 'file' }];
      });
    }),
  );
  return listings.flat();
}

const isNotePath = (path: string) => isMarkdownName(path.slice(path.lastIndexOf('/') + 1));

/** The folder a path is in, or null for a path the vault cannot name. */
function folderOf(path: string): string | null {
  try {
    return parentVaultPath(createVaultPath(path));
  } catch {
    // Not a vault path: nothing the app wrote, so it stays unknown and is refreshed for.
    return null;
  }
}
