/**
 * What syncing a vault through GitHub needs from the host (U-29). The host
 * runs the Mac's own `git` — and `gh`, only to create a repository — with
 * argument shapes it holds fixed, in the open vault's folder, and hands the
 * output back untouched; what it means is decided above it. Atlas never holds
 * a GitHub login: git and gh use the one already on the Mac.
 */

import type { VaultLocation } from '../vault/ports.ts';

/** What one run of git or gh said. `code` is null when the host stopped it. */
export interface GitResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Which side of a conflicted file to write into the work tree. */
export type ConflictSide = 'ours' | 'theirs';

/** Git, in the open vault's folder. */
export interface GitPort {
  /** `rev-parse --show-toplevel`: the top of the work tree the vault is in. */
  topLevel(): Promise<GitResult>;
  /** `init` on the branch `main`. */
  init(): Promise<GitResult>;
  /** `status --porcelain=v2 --branch -z --untracked-files=all`. */
  status(): Promise<GitResult>;
  addAll(): Promise<GitResult>;
  /** Commits what is staged; `identity` is used only when git has none of its own. */
  commit(args: { message: string; identity: GitIdentity | null }): Promise<GitResult>;
  fetch(): Promise<GitResult>;
  /** Merges `origin/<branch>` — an ordinary merge, never a rebase. */
  merge(branch: string): Promise<GitResult>;
  /** Pushes the branch to `origin` and tracks it there. */
  push(): Promise<GitResult>;
  remoteUrl(): Promise<GitResult>;
  /** Points `origin` at the address, adding it when there is none. */
  setRemote(args: { url: string; exists: boolean }): Promise<GitResult>;
  currentBranch(): Promise<GitResult>;
  /** `log -1 --format=%H%x00%ct`: the commit checked out, and when it was made. */
  head(): Promise<GitResult>;
  /** `rev-parse --verify --quiet MERGE_HEAD`: succeeds while a merge waits to be committed. */
  mergeInProgress(): Promise<GitResult>;
  /** `log -1 --format=%s origin/<branch> --`: what the other Macs' last commit is called. */
  remoteSubject(branch: string): Promise<GitResult>;
  /** Whether `origin/<branch>` exists yet. */
  remoteBranchExists(branch: string): Promise<GitResult>;
  /** Writes one side of a conflicted file over the file. */
  checkout(args: { side: ConflictSide; path: string }): Promise<GitResult>;
  /** `config --get user.name` or `user.email`. */
  config(key: 'user.name' | 'user.email'): Promise<GitResult>;
  /** `gh repo create <name> --private --source=. --remote=origin --push`. */
  createGitHubRepository(name: string): Promise<GitResult>;
  /** `-c core.ignoreCase=false ls-files -z --others --exclude-standard`: untracked, by exact spelling. */
  untrackedExact(): Promise<GitResult>;
  /** `ls-files -z --stage`: the index. */
  indexEntries(): Promise<GitResult>;
  /** `mv -- <from> <to>`: moves a tracked file, on disk and in the index. */
  move(args: { from: string; to: string }): Promise<GitResult>;
  /** `ls-tree -r -z <rev>`: the files of `HEAD`, of `origin/<branch>`, or of a commit. */
  tree(rev: TreeRev): Promise<GitResult>;
  /** `merge-base HEAD origin/<branch>`. */
  mergeBase(branch: string): Promise<GitResult>;
  /** `hash-object --no-filters -- <path>`: the blob id of the file's bytes as they are. */
  hashFile(path: string): Promise<GitResult>;
  /** `update-index --add --cacheinfo <mode>,<oid>,<path>`: a blob already in git, staged under a path. */
  stageBlob(args: { mode: string; oid: string; path: string }): Promise<GitResult>;
  /** `checkout-index -- <path>`: writes the path from the index, never over a file already there. */
  writeFromIndex(path: string): Promise<GitResult>;
  /** `rm --cached --quiet -- <path>`: stops tracking the path, leaving the file. */
  untrack(path: string): Promise<GitResult>;
  /** `reset --quiet -- <path>`: the path's staged change taken back out. */
  unstage(path: string): Promise<GitResult>;
  /** `reset --quiet --soft origin/<branch>`: the commits not pushed yet undone, their changes staged. */
  resetSoftTo(branch: string): Promise<GitResult>;
  /** The blobs of at least `bytes` in commits not on the remote, each `~<oid>`. */
  largeUnpushed(bytes: number): Promise<GitResult>;
  /** `ls-remote --symref origin HEAD`: the remote's default branch. */
  remoteHead(): Promise<GitResult>;
  /** `branch -m <name>`: renames the branch checked out. */
  renameBranch(name: string): Promise<GitResult>;
}

/** What `tree` lists: this Mac's last commit, the other Macs' branch, or a commit by id. */
export type TreeRev =
  | { readonly kind: 'head' }
  | { readonly kind: 'remote'; readonly branch: string }
  | { readonly kind: 'commit'; readonly oid: string };

/**
 * The files a sync keeps in the vault's `.git/atlas-sync/` (A29-01): its
 * journal, and the excludes of what it leaves out. Neither ever syncs.
 */
export type SyncFileName = 'journal.json' | 'exclude';

export interface SyncFilesPort {
  /** The file's text; null when it is not there. */
  read(name: SyncFileName): Promise<string | null>;
  /** Writes it whole, or removes it for null. */
  write(name: SyncFileName, contents: string | null): Promise<void>;
}

/** GitHub, through the Mac's own `gh` login: reading only. */
export interface GitHubPort {
  /** `gh repo list --json name,nameWithOwner,defaultBranchRef,visibility,url --limit 1000`. */
  listRepositories(): Promise<GitResult>;
}

/** Who a commit is by, when git on this Mac has not been told. */
export interface GitIdentity {
  readonly name: string;
  readonly email: string;
}

/**
 * Git, outside any vault: asking where a folder sits, and cloning into one.
 * The host only does either in a folder the person chose through
 * `pickCloneFolder`, or (asking) the folder above the open vault.
 */
export interface GitFoldersPort {
  /** Asks the person, in the host's own folder dialog, where a vault from GitHub goes; null when dismissed. */
  pickCloneFolder(): Promise<VaultLocation | null>;
  topLevelOf(folder: string): Promise<GitResult>;
  /** Clones into a new folder `name` inside `folder`, which the host refuses if it exists. */
  clone(args: { url: string; folder: string; name: string }): Promise<GitResult>;
  /** `ls-remote --heads -- <url>`, run in `folder`: the repository's branches, none when it is empty. */
  branchesAt(args: { url: string; folder: string }): Promise<GitResult>;
  /**
   * The folder as the disk spells it — every link resolved, `/var` as
   * `/private/var` — for the open vault or a folder picked in the host's
   * dialog only; the host refuses any other. It resolves; comparing is the
   * use-case's (ADR-0005).
   */
  onDisk(folder: string): Promise<string>;
}

/** This Mac: the name it shows in Sharing settings, and an id it keeps for itself. */
export interface ThisMacPort {
  name(): Promise<string>;
  /** Made once and kept in this Mac's app data: a rename, or a second Mac of the same name, does not change it. */
  id(): Promise<string>;
}

/** Unsaved typing in the panes, written before anything is committed. */
export interface UnsavedWorkPort {
  flushAll(): Promise<void>;
}

/**
 * The host could not run the program at all: it is not installed where it is
 * looked for. Adapters throw this so the use-case can say how to install it.
 */
export class ProgramMissingError extends Error {
  constructor(readonly program: 'git' | 'gh') {
    super(`${program} is not installed`);
    this.name = 'ProgramMissingError';
  }
}
