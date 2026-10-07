export { ProgramMissingError } from './ports.ts';
export type {
  ConflictSide,
  GitFoldersPort,
  GitHubPort,
  GitIdentity,
  GitPort,
  GitResult,
  SyncFileName,
  SyncFilesPort,
  ThisMacPort,
  TreeRev,
  UnsavedWorkPort,
} from './ports.ts';
export { SyncError } from './git-steps.ts';
export { syncNow } from './sync-now.ts';
export type { SyncPorts } from './sync-now.ts';
export { setUpSync } from './set-up-sync.ts';
export type { SetUpMac, SetUpSyncPorts, SyncRemoteChoice } from './set-up-sync.ts';
export { inspectSync } from './inspect-sync.ts';
export type { SyncSetup } from './inspect-sync.ts';
export { openVaultFromGitHub } from './open-from-github.ts';
export { loadSyncSettings, saveSyncSettings } from './sync-settings.ts';
export type { SyncSettings } from './sync-settings.ts';
export { checkRemote } from './check-remote.ts';
export { listGitHubRepositories } from './list-repositories.ts';
