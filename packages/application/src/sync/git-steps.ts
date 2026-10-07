import {
  explainGitFailure,
  missingProgramMessage,
  parentFolderOf,
  parseGitStatus,
  parseIndexEntries,
  type GitStatus,
  type IndexEntry,
  type LeftOut,
  type RepositoryPlace,
} from '@atlas/domain';
import {
  ProgramMissingError,
  type GitFoldersPort,
  type GitIdentity,
  type GitPort,
  type GitResult,
} from './ports.ts';

/** Why a sync, or setting one up, stopped — in words to show the person as they are. */
export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/** The output of a step that must succeed; otherwise why it did not, explained. */
export function expectOk(step: string, result: GitResult): string {
  if (result.code === 0) return result.stdout;
  throw new SyncError(explainGitFailure({ step, stderr: result.stderr }));
}

/** Runs the work, saying how to install git or gh if the host found neither. */
export async function withPrograms<Result>(work: () => Promise<Result>): Promise<Result> {
  try {
    return await work();
  } catch (cause) {
    if (cause instanceof ProgramMissingError) {
      throw new SyncError(missingProgramMessage(cause.program));
    }
    throw cause;
  }
}

export async function readStatus(git: GitPort): Promise<GitStatus> {
  return parseGitStatus(expectOk('read the vault’s status', await git.status()));
}

export async function readIndex(git: GitPort): Promise<readonly IndexEntry[]> {
  return parseIndexEntries(expectOk('read the vault’s index', await git.indexEntries()));
}

/** The first line a step printed, trimmed; null when it failed or printed nothing. */
export function firstLine(result: GitResult): string | null {
  if (result.code !== 0) return null;
  const line = result.stdout.split('\n')[0]?.trim() ?? '';
  return line === '' ? null : line;
}

/** The blob id of a file's bytes as they are; null when there is no such file. */
export async function blobOf(git: GitPort, path: string): Promise<string | null> {
  return firstLine(await git.hashFile(path));
}

/** Where the vault sits in git: in a repository of its own, inside another, or in none. */
export async function repositoryPlace({
  git,
  folders,
  vaultRoot,
}: {
  git: GitPort;
  folders: GitFoldersPort;
  vaultRoot: string;
}): Promise<RepositoryPlace> {
  const [inVault, above] = await Promise.all([
    git.topLevel(),
    folders.topLevelOf(parentFolderOf(vaultRoot)),
  ]);
  return { topFromVault: firstLine(inVault), topFromParent: firstLine(above) };
}

/** The branch checked out, which is what is pushed and merged. */
export async function currentBranch(git: GitPort): Promise<string> {
  const branch = firstLine(await git.currentBranch());
  if (branch === null) {
    throw new SyncError('The vault’s repository isn’t on a branch, so Atlas won’t sync it.');
  }
  return branch;
}

/** Who commits: git's own identity when this Mac has one, otherwise this Mac. */
async function identityFor(git: GitPort, mac: string): Promise<GitIdentity | null> {
  const [name, email] = await Promise.all([git.config('user.name'), git.config('user.email')]);
  if (firstLine(name) !== null && firstLine(email) !== null) return null;
  const host =
    mac
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'mac';
  return { name: `Atlas on ${mac}`, email: `atlas@${host}.local` };
}

/**
 * Stages everything but what is left out of sync. Excludes keep an untracked
 * file out; one git already tracks, that has grown past GitHub's limit, is
 * staged by `add` all the same, so its change is taken back out: the last
 * version that synced stays the one every Mac has.
 */
export async function stageAll({
  git,
  leftOut,
}: {
  git: GitPort;
  leftOut: LeftOut;
}): Promise<void> {
  expectOk('stage the vault’s changes', await git.addAll());
  if (leftOut.large.length === 0) return;
  const staged = new Set((await readIndex(git)).map(({ path }) => path));
  for (const path of leftOut.large.filter((large) => staged.has(large))) {
    const unstaged = await git.unstage(path);
    // Without a commit yet there is no version to go back to: stop tracking it.
    if (unstaged.code !== 0) expectOk('leave a large file out', await git.untrack(path));
  }
}

/** Stages everything and commits it, when there is anything; says whether it did. */
export async function commitAll({
  git,
  mac,
  message,
  leftOut,
}: {
  git: GitPort;
  mac: string;
  message: string;
  leftOut: LeftOut;
}): Promise<boolean> {
  await stageAll({ git, leftOut });
  const status = await readStatus(git);
  if (status.staged.length === 0 && status.conflicts.length === 0) return false;
  await commitStaged({ git, mac, message });
  return true;
}

/** Commits what is staged, whatever it is: a merge being concluded may stage nothing new. */
export async function commitStaged({
  git,
  mac,
  message,
}: {
  git: GitPort;
  mac: string;
  message: string;
}): Promise<void> {
  const identity = await identityFor(git, mac);
  expectOk('commit', await git.commit({ message, identity }));
}
