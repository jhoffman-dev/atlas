import {
  createVaultPath,
  isSettingsFile,
  journalEntryFor,
  type GitConflict,
  type JournalFile,
} from '@atlas/domain';
import type { MarkdownPort } from '../notes/ports.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import { blobOf, firstLine } from './git-steps.ts';
import { readJournal } from './journal.ts';
import { mergeSettings } from './merge-settings.ts';
import type { GitPort, SyncFilesPort } from './ports.ts';

/** What merging a settings file by its keys needs: the vault's files, and frontmatter read and written. */
export interface SettingsMergePorts {
  readonly vault: Pick<VaultFsPort, 'readTextFile' | 'writeTextFile'>;
  readonly markdown: MarkdownPort;
}

/**
 * Merges each settings file of DFAI's own both Macs changed by its keys
 * (#233) — the records and types DFAI writes by itself as a vault opens
 * among them — and gives back the conflicts still to settle the usual way,
 * with a copy. A file is written only while it holds what git's merge wrote
 * into it, so typing into it since is never written over; a run after a quit
 * that finds the merge already written leaves it, and either way the sync's
 * staging takes it from there.
 */
export async function mergeSettingsConflicts({
  git,
  files,
  conflicts,
  settings,
}: {
  git: GitPort;
  files: SyncFilesPort;
  conflicts: readonly GitConflict[];
  settings: SettingsMergePorts;
}): Promise<readonly GitConflict[]> {
  const candidates = conflicts.flatMap((conflict) => {
    const { path, base, ours, theirs } = conflict;
    if (ours === null || theirs === null || !isSettingsFile(path)) return [];
    return [{ conflict, sides: { path, base, ours, theirs } }];
  });
  if (candidates.length === 0) return conflicts;
  const journal = await readJournal(files);
  const mergeHead = firstLine(await git.mergeInProgress());
  const merged = new Set<string>();
  for (const { conflict, sides } of candidates) {
    const entry = journalEntryFor({ journal, mergeHead, conflict });
    if (await mergeOne({ git, settings, conflict: sides, entry })) merged.add(conflict.path);
  }
  return conflicts.filter((conflict) => !merged.has(conflict.path));
}

/** A conflict both sides of which are there: a file each Mac still has. */
interface BothSides {
  readonly path: string;
  readonly base: ConflictBlob | null;
  readonly ours: ConflictBlob;
  readonly theirs: ConflictBlob;
}

type ConflictBlob = NonNullable<GitConflict['ours']>;

/**
 * Writes one file's merge; says whether it holds it now. Anything that goes
 * wrong on the way — a side git cannot hand over, frontmatter the reader
 * throws on (an alias to an anchor only the other side has), a write the
 * host refuses — leaves the file as git's merge wrote it, and the conflict
 * goes the usual way: this Mac's version kept, the other's copied, no markers
 * left. Giving up loses nothing, where stopping the sync would leave the
 * markers in place and every later sync stuck on them.
 */
async function mergeOne(request: {
  git: GitPort;
  settings: SettingsMergePorts;
  conflict: BothSides;
  entry: JournalFile | null;
}): Promise<boolean> {
  try {
    return await writeMerge(request);
  } catch {
    // Safe to ignore: nothing was written, and the copy keeps both versions (see above).
    return false;
  }
}

async function writeMerge({
  git,
  settings: { vault, markdown },
  conflict,
  entry,
}: {
  git: GitPort;
  settings: SettingsMergePorts;
  conflict: BothSides;
  entry: JournalFile | null;
}): Promise<boolean> {
  const versions = await versionsOf(git, conflict);
  const text = versions === null ? null : mergeSettings(markdown, versions);
  if (text === null) return false;
  const path = createVaultPath(conflict.path);
  const current = await vault.readTextFile(path);
  if (current.text === text) return true;
  // What git merged into the file is known only from the journal; without it, nothing is written.
  const merged = entry === null ? null : entry.merged;
  if (merged === null || (await blobOf(git, conflict.path)) !== merged) return false;
  await vault.writeTextFile({ path, contents: text, expectedModified: current.modified });
  return true;
}

/** The base, this Mac's and the other's versions as text; null when one cannot be read whole. */
async function versionsOf(git: GitPort, { path, base, ours, theirs }: BothSides) {
  const [baseText, oursText, theirsText] = await Promise.all([
    base === null ? null : blobText(git, base.oid),
    blobText(git, ours.oid),
    blobText(git, theirs.oid),
  ]);
  if (oursText === null || theirsText === null) return null;
  if (base !== null && baseText === null) return null;
  return { path, base: baseText, ours: oursText, theirs: theirsText };
}

/**
 * A blob as text; null when git did not hand it over whole and as UTF-8 —
 * a failed read, output the host cut short (it says so on stderr), or bytes
 * it had to replace. Such a file is not merged: it is kept on both sides,
 * with a copy, as any file both Macs changed.
 */
async function blobText(git: GitPort, oid: string): Promise<string | null> {
  const read = await git.readBlob(oid);
  if (read.code !== 0 || read.stderr !== '' || read.stdout.includes('\uFFFD')) return null;
  return read.stdout;
}
