import {
  caseCollisions,
  caseRenames,
  conflictCopyPath,
  parsePathList,
  parseTree,
  type ConflictCopy,
  type GitEntry,
  type GitStatus,
} from '@atlas/domain';
import type { VaultFsPort } from '../vault/ports.ts';
import { ensureFolderOf } from './ensure-folder.ts';
import { expectOk, firstLine, readIndex } from './git-steps.ts';
import { noteCopies } from './journal.ts';
import type { GitPort, SyncFilesPort } from './ports.ts';

/**
 * Records the notes renamed only in case on this Mac (A29-01), which git on
 * a case-insensitive disk misses: without it the new name never reaches
 * the other Macs.
 */
export async function followCaseRenames(git: GitPort, status: GitStatus): Promise<void> {
  const [index, exact] = await Promise.all([readIndex(git), git.untrackedExact()]);
  const renames = caseRenames({
    tracked: index.filter(({ stage }) => stage === 0).map(({ path }) => path),
    untrackedExact: parsePathList(expectOk('list the vault’s new files', exact)),
    untracked: status.untracked,
  });
  for (const { from, to } of renames) {
    expectOk('record a change of case', await git.move({ from, to }));
  }
}

async function treeOf(git: GitPort, rev: Parameters<GitPort['tree']>[0]) {
  return parseTree(expectOk('list what a commit holds', await git.tree(rev)));
}

/**
 * Moves this Mac's files aside that the merge would otherwise write another
 * Mac's over, because their names differ only in case (A29-01): each goes to
 * a copy named for this Mac, and the other Mac's takes the name. Says what
 * moved; the caller commits it before merging.
 */
export async function moveCaseCollisionsAside({
  git,
  branch,
  mac,
  untracked,
  fs,
  files,
}: {
  git: GitPort;
  branch: string;
  mac: string;
  untracked: readonly string[];
  fs: Pick<VaultFsPort, 'listDirectory' | 'createFolder'>;
  files: SyncFilesPort;
}): Promise<readonly ConflictCopy[]> {
  const [ours, theirs, base] = await Promise.all([
    treeOf(git, { kind: 'head' }),
    treeOf(git, { kind: 'remote', branch }),
    firstLine(await git.mergeBase(branch)),
  ]);
  const baseTree: ReadonlyMap<string, GitEntry> =
    base === null ? new Map() : await treeOf(git, { kind: 'commit', oid: base });
  const aside = caseCollisions({ base: baseTree, ours, theirs });
  const taken = new Set([...ours.keys(), ...theirs.keys(), ...untracked]);
  const moves = aside.map((path): ConflictCopy => {
    const copy = conflictCopyPath({ path, mac, taken });
    taken.add(copy);
    return { path, copy, whose: 'ours' };
  });
  // Noted before any is made: a sync the app quits part-way still says so.
  await noteCopies(files, moves);
  for (const { path, copy } of moves) {
    await ensureFolderOf(fs, copy);
    expectOk('keep this Mac’s file beside the other’s', await git.move({ from: path, to: copy }));
  }
  return moves;
}
