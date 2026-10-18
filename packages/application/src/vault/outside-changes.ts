import { createVaultPath, parentVaultPath } from '@atlas/domain';
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
 * write left (`isEchoOf`), read now: one read of the notes, one listing per
 * folder for the rest. A save's temporary file is the app's own while a
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

/** What is at each judged path now: the notes' text in one read, the rest from their folders. */
async function foundNow(fs: Fs, judged: readonly Judged[]): Promise<Map<string, FoundVersion>> {
  const notes = judged.filter(({ left }) => left.kind === 'text').map(({ path }) => path);
  const entries = judged.filter(({ left }) => left.kind !== 'text').map(({ path }) => path);
  const [read, listed] = await Promise.all([readNow(fs, notes), listNow(fs, entries)]);
  return new Map([...read, ...listed]);
}

/** Each note as it reads now; one the host leaves out (gone, a folder, not text) is unknown. */
async function readNow(fs: Fs, paths: readonly string[]): Promise<[string, FoundVersion][]> {
  if (paths.length === 0) return [];
  // A read that fails tells nothing: every path in it stays unknown and is refreshed for.
  const files = await fs.readNotes(paths).catch(() => []);
  return files.map(({ path, text, modified }) => [path, { kind: 'text', text, modified }]);
}

/** Whether each path is a folder, a file or nothing now, from one listing of each folder holding one. */
async function listNow(fs: Fs, paths: readonly string[]): Promise<[string, FoundVersion][]> {
  const byFolder = new Map<string, string[]>();
  for (const path of paths) {
    const folder = folderOf(path);
    if (folder !== null) byFolder.set(folder, [...(byFolder.get(folder) ?? []), path]);
  }
  const listings = await Promise.all(
    [...byFolder].map(async ([folder, inIt]) => {
      // A folder that cannot be listed tells nothing: its paths stay unknown.
      const listed = await fs.listDirectory(createVaultPath(folder)).catch(() => null);
      if (listed === null) return [];
      return inIt.map((path): [string, FoundVersion] => {
        const entry = listed.find((each) => each.path === path);
        if (entry === undefined) return [path, { kind: 'absent' }];
        return [path, { kind: entry.kind === 'directory' ? 'directory' : 'file' }];
      });
    }),
  );
  return listings.flat();
}

/** The folder a path is in, or null for a path the vault cannot name. */
function folderOf(path: string): string | null {
  try {
    return parentVaultPath(createVaultPath(path));
  } catch {
    // Not a vault path: nothing the app wrote, so it stays unknown and is refreshed for.
    return null;
  }
}
