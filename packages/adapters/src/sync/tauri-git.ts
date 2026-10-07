import { invoke } from '@tauri-apps/api/core';
import {
  ProgramMissingError,
  type GitFoldersPort,
  type GitHubPort,
  type GitPort,
  type GitResult,
  type SyncFilesPort,
  type ThisMacPort,
  type VaultLocation,
} from '@atlas/application';
import { gitCommands } from './git-commands.ts';

/** How the host words a refusal to run because the program is not installed. */
const NOT_FOUND = 'not_found:';
/** How the host words the person's No to its question before a clone, a remote or a repository. */
const DECLINED = 'declined:';

/**
 * Git and gh, run by the host (`git_process.rs`, U-29) in the open vault's
 * folder. Each method is one of the argument shapes the host holds fixed; the
 * host refuses anything else before it runs, and hands the output back as git
 * printed it. What it means is decided in the use-cases.
 */
export function tauriGit(vault: string): GitPort {
  const git = (...args: string[]) => ran(invoke('git_run', { vault, args }), 'git');
  return {
    ...gitCommands(git),
    createGitHubRepository: (name) => ran(invoke('gh_repo_create', { vault, name }), 'gh'),
  };
}

/** GitHub through the Mac's own `gh` login, reading only: the person's repositories. */
export const tauriGitHub: GitHubPort = {
  listRepositories: () => ran(invoke('gh_repo_list'), 'gh'),
};

/** The sync's journal and excludes, which the host keeps in the vault's `.git/atlas-sync/`. */
export function tauriSyncFiles(vault: string): SyncFilesPort {
  return {
    read: (name) => invoke<string | null>('git_sync_file_read', { vault, name }),
    write: (name, contents) => invoke<void>('git_sync_file_write', { vault, name, contents }),
  };
}

/** Git outside any vault: where a folder sits, what a repository holds, and cloning into one. */
export const tauriGitFolders: GitFoldersPort = {
  pickCloneFolder: () => invoke<VaultLocation | null>('git_pick_clone_folder'),
  topLevelOf: (folder) =>
    ran(invoke('git_run_in', { folder, args: ['rev-parse', '--show-toplevel'] }), 'git'),
  clone: ({ url, folder, name }) =>
    ran(
      invoke('git_run_in', {
        folder,
        args: ['clone', '--quiet', '--origin', 'origin', '--', url, name],
      }),
      'git',
    ),
  branchesAt: ({ url, folder }) =>
    ran(invoke('git_run_in', { folder, args: ['ls-remote', '--heads', '--', url] }), 'git'),
  onDisk: (folder) => invoke<string>('git_folder_on_disk', { folder }),
};

/** This Mac's name, as Sharing settings shows it; its id is kept by the app, not the host. */
export const tauriMacName: Pick<ThisMacPort, 'name'> = {
  name: () => invoke<string>('this_mac_name'),
};

async function ran(call: Promise<unknown>, program: 'git' | 'gh'): Promise<GitResult> {
  try {
    return (await call) as GitResult;
  } catch (error) {
    if (typeof error === 'string' && error.startsWith(NOT_FOUND)) {
      throw new ProgramMissingError(program);
    }
    // The person said no in the host's own question; its sentence says so.
    if (typeof error === 'string' && error.startsWith(DECLINED)) {
      throw new Error(error.slice(DECLINED.length).trim(), { cause: error });
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}
