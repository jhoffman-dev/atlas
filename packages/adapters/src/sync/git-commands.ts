import type { GitPort, GitResult, TreeRev } from '@atlas/application';

/** Runs git with these arguments, in the vault, as the host does. */
export type RunGit = (...args: string[]) => Promise<GitResult>;

const revOf = (rev: TreeRev): string =>
  rev.kind === 'head' ? 'HEAD' : rev.kind === 'remote' ? `origin/${rev.branch}` : rev.oid;

/**
 * The argument shapes of every git step a sync takes (U-29, A29-01), each
 * one the host holds fixed in `shapes.rs`: what the port's methods mean, as
 * git's own words. `gh` is not here; it has a host command of its own.
 */
export function gitCommands(git: RunGit): Omit<GitPort, 'createGitHubRepository'> {
  return {
    topLevel: () => git('rev-parse', '--show-toplevel'),
    init: () => git('init', '--quiet', '--initial-branch=main'),
    status: () => git('status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'),
    addAll: () => git('add', '--all'),
    commit: ({ message, identity }) =>
      identity === null
        ? git('commit', '--quiet', '--no-verify', '-m', message)
        : git(
            '-c',
            `user.name=${identity.name}`,
            '-c',
            `user.email=${identity.email}`,
            'commit',
            '--quiet',
            '--no-verify',
            '-m',
            message,
          ),
    fetch: () => git('fetch', '--quiet', 'origin'),
    merge: (branch) => git('merge', '--no-edit', '--allow-unrelated-histories', `origin/${branch}`),
    push: () => git('push', '--quiet', '--set-upstream', 'origin', 'HEAD'),
    remoteUrl: () => git('remote', 'get-url', 'origin'),
    setRemote: ({ url, exists }) => git('remote', exists ? 'set-url' : 'add', 'origin', url),
    currentBranch: () => git('symbolic-ref', '--quiet', '--short', 'HEAD'),
    head: () => git('log', '-1', '--format=%H%x00%ct'),
    mergeInProgress: () => git('rev-parse', '--verify', '--quiet', 'MERGE_HEAD'),
    remoteSubject: (branch) => git('log', '-1', '--format=%s', `origin/${branch}`, '--'),
    remoteBranchExists: (branch) => git('rev-parse', '--verify', '--quiet', `origin/${branch}`),
    checkout: ({ side, path }) => git('checkout', `--${side}`, '--', path),
    config: (key) => git('config', '--get', key),
    untrackedExact: () =>
      git('-c', 'core.ignoreCase=false', 'ls-files', '-z', '--others', '--exclude-standard'),
    indexEntries: () => git('ls-files', '-z', '--stage'),
    move: ({ from, to }) => git('mv', '--', from, to),
    tree: (rev) => git('ls-tree', '-r', '-z', revOf(rev)),
    mergeBase: (branch) => git('merge-base', 'HEAD', `origin/${branch}`),
    hashFile: (path) => git('hash-object', '--no-filters', '--', path),
    stageBlob: ({ mode, oid, path }) =>
      git('update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`),
    writeFromIndex: (path) => git('checkout-index', '--', path),
    untrack: (path) => git('rm', '--cached', '--quiet', '--', path),
    unstage: (path) => git('reset', '--quiet', '--', path),
    resetSoftTo: (branch) => git('reset', '--quiet', '--soft', `origin/${branch}`),
    largeUnpushed: (bytes) =>
      git(
        'rev-list',
        '--objects',
        `--filter=blob:limit=${bytes}`,
        '--filter-print-omitted',
        'HEAD',
        '--not',
        '--remotes=origin',
      ),
    remoteHead: () => git('ls-remote', '--symref', 'origin', 'HEAD'),
    renameBranch: (name) => git('branch', '-m', name),
  };
}
