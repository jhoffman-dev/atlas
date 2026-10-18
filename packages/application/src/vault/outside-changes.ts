import { createVaultPath, isMarkdownName, parentVaultPath, type VaultEntry } from '@atlas/domain';
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
  const found = await foundNow(fs, judged, (path) => ownWrites.refreshedAt({ vault, path }));
  const echoes = new Set(
    judged
      .filter(({ path, left }) => isEchoOf(left, found.get(path) ?? UNKNOWN))
      .map(({ path }) => path),
  );
  return paths.filter((path) => !echoes.has(path) && !ours(path));
}

/**
 * The most folders listed to tell a report apart: the folders the app made,
 * and those holding a path it emptied. Past it, a refresh's one walk of the
 * vault would cost less.
 */
const MOST_FOLDERS_LISTED = 4;

/** The app's held write at a path, if any: what a folder's contents are checked against. */
type HeldAt = (path: string) => LeftVersion | null;

/**
 * What is at each judged path now. The folders the app made are listed
 * first, so the notes in them are read with the rest in one read; then, for a
 * path the app emptied that the read found no note at, whether anything else
 * is there.
 */
async function foundNow(
  fs: Fs,
  judged: readonly Judged[],
  heldAt: HeldAt,
): Promise<Map<string, FoundVersion>> {
  const made = judged.filter(({ left }) => left.kind === 'folder').map(({ path }) => path);
  const emptied = judged.filter(({ left }) => left.kind === 'absent').map(({ path }) => path);
  const listable = made.length + foldersOf(emptied).size <= MOST_FOLDERS_LISTED;
  const contents = listable ? await listedNow(fs, made) : new Map<string, VaultEntry[]>();
  const inMade = [...contents.values()].flat().map((entry) => entry.path as string);
  const found = await readNow(fs, [...judged.map(({ path }) => path), ...inMade]);
  if (found === null) return new Map();
  const result = new Map(found);
  const ours = ownEntries({ found, heldAt, contents });
  for (const folder of contents.keys()) {
    result.set(folder, { kind: 'directory', ownContents: ours(folder) });
  }
  const unread = emptied.filter((path) => !found.has(path));
  const emptiedFound = listable ? await emptiedNow(fs, unread) : takenAsEmpty(unread);
  for (const [path, version] of emptiedFound) result.set(path, version);
  return result;
}

/**
 * Whether all a listed folder holds is the app's own: each note one whose
 * held write it still is, read now, and each folder one the app made whose
 * own listing is the app's own in turn — as a filing makes `Tasks/2026/10`.
 */
function ownEntries({
  found,
  heldAt,
  contents,
}: {
  found: ReadonlyMap<string, FoundVersion>;
  heldAt: HeldAt;
  contents: ReadonlyMap<string, readonly VaultEntry[]>;
}): (folder: string) => boolean {
  const own = (folder: string): boolean =>
    contents.get(folder)?.every(({ kind, path }) => {
      const left = heldAt(path);
      if (left === null) return false;
      if (kind === 'directory') return left.kind === 'folder' && own(path);
      return isEchoOf(left, found.get(path) ?? UNKNOWN);
    }) ?? false;
  return own;
}

/** Each folder's entries, by folder; one that cannot be listed is left out, and so unknown. */
async function listedNow(fs: Fs, folders: readonly string[]): Promise<Map<string, VaultEntry[]>> {
  const listed = await Promise.all(
    folders.map(async (folder) => {
      const entries = await fs.listDirectory(createVaultPath(folder)).catch(() => null);
      return [folder, entries] as const;
    }),
  );
  return new Map(
    listed.flatMap(([folder, entries]) => (entries === null ? [] : [[folder, [...entries]]])),
  );
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

/** The folders holding these paths, each with the paths in it. */
function foldersOf(paths: readonly string[]): Map<string, string[]> {
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const folder = folderOf(path);
    if (folder !== null) byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
  }
  return byFolder;
}

/**
 * Past what is listed, a note's path the read found no note at is taken as
 * empty, and any other path is unknown and refreshed for.
 */
const takenAsEmpty = (paths: readonly string[]): [string, FoundVersion][] =>
  paths.filter(isNotePath).map((path) => [path, { kind: 'absent' }]);

/** Whether each path the read found no note at is empty, a folder or another file, from its folder's listing. */
async function emptiedNow(fs: Fs, paths: readonly string[]): Promise<[string, FoundVersion][]> {
  const byFolder = foldersOf(paths);
  const listings = await listedNow(fs, [...byFolder.keys()]);
  return [...byFolder].flatMap(([folder, inIt]) => {
    const listed = listings.get(folder);
    // A folder that cannot be listed tells nothing: its paths stay unknown.
    if (listed === undefined) return [];
    const kinds = new Map(listed.map((entry) => [entry.path as string, entry.kind]));
    return inIt.map((path): [string, FoundVersion] => {
      const kind = kinds.get(path);
      if (kind === undefined) return [path, { kind: 'absent' }];
      return [
        path,
        kind === 'directory' ? { kind: 'directory', ownContents: false } : { kind: 'file' },
      ];
    });
  });
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
