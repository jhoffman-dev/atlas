import {
  conflictCopyPath,
  journalEntryFor,
  parsePathList,
  planConflictSteps,
  thisMacsFileAfterConflict,
  withUnreported,
  type ConflictCopy,
  type GitConflict,
  type JournalFile,
  type LeftOut,
  type SettleJournal,
} from '@atlas/domain';
import { blobOf, expectOk, firstLine, readIndex, stageAll, SyncError } from './git-steps.ts';
import { readJournal, writeJournal } from './journal.ts';
import type { GitPort, SyncFilesPort } from './ports.ts';

/** The commit a merge under way is bringing in; null with no merge under way. */
export async function mergeHeadOf(git: GitPort): Promise<string | null> {
  return firstLine(await git.mergeInProgress());
}

/**
 * Writes the journal for a merge that just stopped on conflicts (A29-01):
 * what git wrote into each file, before anything else can touch it. Only
 * then is typing into a file's markers told apart from the markers alone.
 */
export async function recordMerge({
  git,
  files,
  conflicts,
}: {
  git: GitPort;
  files: SyncFilesPort;
  conflicts: readonly GitConflict[];
}): Promise<void> {
  const mergeHead = await mergeHeadOf(git);
  if (mergeHead === null) return;
  const entries: JournalFile[] = [];
  for (const conflict of conflicts) {
    entries.push({
      path: conflict.path,
      merged: await blobOf(git, conflict.path),
      ours: conflict.ours?.oid ?? null,
      theirs: conflict.theirs?.oid ?? null,
      copy: null,
    });
  }
  const { unreported } = await readJournal(files);
  await writeJournal(files, { mergeHead, files: entries, unreported });
}

/**
 * Settles every file a merge left in conflict, so none is left holding
 * conflict markers (U-29, A29-01). This Mac's version stays in place; the
 * other's is saved as a copy beside it, byte for byte, from git's own copy
 * of it — never by reading the file as text, so an image, a file that is not
 * UTF-8 or one of any size is copied as exactly as a note.
 *
 * Every step can be run again after a quit: the copy's name is kept in the
 * journal, writing the copy never writes over a file, and this Mac's file is
 * written over with its own side only while it still holds exactly what the
 * merge wrote. Then everything is staged.
 */
export async function settleConflicts({
  git,
  files,
  conflicts,
  mac,
  leftOut,
}: {
  git: GitPort;
  files: SyncFilesPort;
  conflicts: readonly GitConflict[];
  mac: string;
  leftOut: LeftOut;
}): Promise<readonly ConflictCopy[]> {
  const journal = await planCopies({ git, files, conflicts, mac });
  const copies: ConflictCopy[] = [];
  for (const conflict of conflicts) {
    const entry = journal.files.find(({ path }) => path === conflict.path) ?? null;
    const copy = await settleOne({ git, files, conflict, entry, mac });
    if (copy !== null) copies.push({ path: conflict.path, copy, whose: 'theirs' });
  }
  await stageAll({ git, leftOut });
  return copies;
}

/**
 * The journal for these conflicts, with a copy's name for each file both
 * sides changed: the one it already holds, or a new one free of every name in
 * the vault. Written before any copy is made.
 */
async function planCopies({
  git,
  files,
  conflicts,
  mac,
}: {
  git: GitPort;
  files: SyncFilesPort;
  conflicts: readonly GitConflict[];
  mac: string;
}): Promise<SettleJournal> {
  const mergeHead = await mergeHeadOf(git);
  const journal = await readJournal(files);
  const steps = planConflictSteps({ conflicts, mac, existing: new Set() });
  const known = conflicts.map(
    (conflict): JournalFile =>
      journalEntryFor({ journal, mergeHead, conflict }) ?? {
        path: conflict.path,
        merged: null,
        ours: conflict.ours?.oid ?? null,
        theirs: conflict.theirs?.oid ?? null,
        copy: null,
      },
  );
  const copying = new Set(steps.filter((step) => step.kind === 'copy-theirs').map((s) => s.path));
  if (known.every((file) => !copying.has(file.path) || file.copy !== null)) {
    return { mergeHead, files: known, unreported: journal.unreported };
  }
  const taken = await namesInUse(git, known);
  const planned = known.map((file) => {
    if (!copying.has(file.path) || file.copy !== null) return file;
    const copy = conflictCopyPath({ path: file.path, mac, taken });
    taken.add(copy);
    return { ...file, copy };
  });
  const copies = planned.flatMap(({ path, copy }) =>
    copy === null ? [] : [{ path, copy, whose: 'theirs' as const }],
  );
  const next = withUnreported(
    { mergeHead, files: planned, unreported: journal.unreported },
    copies,
  );
  await writeJournal(files, next);
  return next;
}

/** Every name a copy must not take: in the index, on disk untracked, and already planned. */
async function namesInUse(git: GitPort, known: readonly JournalFile[]): Promise<Set<string>> {
  const [index, untracked] = await Promise.all([readIndex(git), git.untrackedExact()]);
  return new Set([
    ...index.map(({ path }) => path),
    ...parsePathList(expectOk('list the vault’s new files', untracked)),
    ...known.flatMap(({ copy }) => (copy === null ? [] : [copy])),
  ]);
}

/** Settles one file; says where the other Mac's version was saved, if it was copied. */
async function settleOne({
  git,
  files,
  conflict,
  entry,
  mac,
}: {
  git: GitPort;
  files: SyncFilesPort;
  conflict: GitConflict;
  entry: JournalFile | null;
  mac: string;
}): Promise<string | null> {
  const { path, ours, theirs } = conflict;
  if (ours !== null && theirs !== null && entry !== null && entry.copy !== null) {
    const copy = await copyTheirs({ git, files, path, copy: entry.copy, theirs, mac });
    const current = await blobOf(git, path);
    const keep = thisMacsFileAfterConflict({ current, merged: entry.merged, ours: ours.oid });
    if (keep === 'ours') {
      expectOk('keep this Mac’s version', await git.checkout({ side: 'ours', path }));
    }
    return copy;
  }
  // Both sides deleted it (or both renamed it away): it goes from the index
  // by its exact name. Left to `add`, a disk that ignores case would find
  // the other name's file there and add it back under this one.
  if (ours === null && theirs === null) {
    expectOk('settle a file both Macs removed', await git.untrack(path));
    return null;
  }
  // Only one side has the file: that one is kept, since deleting a changed
  // file loses work. This Mac's is on disk already; the other's is written
  // if the file is not there.
  if (ours === null && theirs !== null && (await blobOf(git, path)) === null) {
    expectOk('keep the other Mac’s file', await git.checkout({ side: 'theirs', path }));
  }
  return null;
}

/**
 * Saves the other Mac's version at the copy's name the journal holds; says
 * where it went. A file already there that holds something else — a copy
 * made before a quit, that the person has since edited — is theirs now and
 * is kept: the other Mac's version goes to a new name (review A29-01).
 */
async function copyTheirs({
  git,
  files,
  path,
  copy,
  theirs,
  mac,
}: {
  git: GitPort;
  files: SyncFilesPort;
  path: string;
  copy: string;
  theirs: { mode: string; oid: string };
  mac: string;
}): Promise<string> {
  if (await writeCopy({ git, copy, theirs })) return copy;
  const journal = await readJournal(files);
  const another = conflictCopyPath({ path, mac, taken: await namesInUse(git, journal.files) });
  const moved = journal.files.map((file) =>
    file.path === path ? { ...file, copy: another } : file,
  );
  await writeJournal(
    files,
    withUnreported({ ...journal, files: moved }, [{ path, copy: another, whose: 'theirs' }]),
  );
  if (await writeCopy({ git, copy: another, theirs })) return another;
  throw new SyncError(`Git could not save the other Mac’s version of ${path}.`);
}

/**
 * Writes the other Mac's side at the copy's path: staged from git's own blob,
 * then written from the index — never over a file already there. Says
 * whether the file there now holds that side: false when something else is.
 */
async function writeCopy({
  git,
  copy,
  theirs,
}: {
  git: GitPort;
  copy: string;
  theirs: { mode: string; oid: string };
}): Promise<boolean> {
  expectOk(
    'save the other Mac’s version',
    await git.stageBlob({ mode: theirs.mode, oid: theirs.oid, path: copy }),
  );
  const written = await git.writeFromIndex(copy);
  return written.code === 0 || (await blobOf(git, copy)) === theirs.oid;
}
