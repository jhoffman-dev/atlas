import {
  automationsHandover,
  createVaultPath,
  CREATE_REPOSITORY_STEP,
  defaultBranchOf,
  enclosingRepositoryRefusal,
  existingOriginRefusal,
  GITIGNORE_PATH,
  ignoredByGitignoreWarning,
  isOwnRepository,
  isRepositoryName,
  leftOutWarnings,
  remoteUrlProblem,
  SYNC_KEY,
  SYNC_KEY_VALUE,
  syncSetUpMessage,
  VAULT_ROOT,
  VAULT_SETTINGS_PATH,
  withManagedIgnores,
  type SyncReport,
  type VaultPath,
} from '@atlas/domain';
import type { Clock } from '../ports.ts';
import type { SettingsWriter } from '../settings/index.ts';
import type { VaultFsPort } from '../vault/ports.ts';
import {
  commitAll,
  currentBranch,
  expectOk,
  firstLine,
  readStatus,
  repositoryPlace,
  SyncError,
  withPrograms,
} from './git-steps.ts';
import { leaveOut } from './leave-out.ts';
import type { GitFoldersPort, GitPort } from './ports.ts';
import { syncNow, type SyncPorts } from './sync-now.ts';

/** Where the vault's history goes: a new private GitHub repository, or one that already exists. */
export type SyncRemoteChoice =
  | { readonly kind: 'new-github'; readonly name: string }
  | { readonly kind: 'existing'; readonly url: string };

export interface SetUpSyncPorts extends SyncPorts {
  readonly folders: GitFoldersPort;
  readonly fs: SyncPorts['fs'] &
    Pick<VaultFsPort, 'listDirectory' | 'readTextFile' | 'writeTextFile' | 'createNote'>;
  readonly settings: SettingsWriter;
  /** The vault's settings as its settings note says them now. */
  readonly readSettings: () => Promise<Readonly<Record<string, unknown>>>;
  /** The settings a copy of the settings note says: the other side's, saved aside by a conflict. */
  readonly readSettingsCopy: (copy: VaultPath) => Promise<Readonly<Record<string, unknown>>>;
}

/** This Mac: its name, for commits and copies, and its id, which names it for the automations. */
export interface SetUpMac {
  readonly name: string;
  readonly id: string;
}

/**
 * Sets up sync for the open vault on this Mac (U-29): makes it a repository if
 * it is not one, writes the managed `.gitignore`, and connects it to GitHub —
 * a new private repository made with `gh`, or an existing one by its address,
 * whose default branch it then follows and whose notes are merged in like any
 * sync. Refused for a vault inside another repository's work tree, before
 * anything is written.
 *
 * Atlas's mark (`sync: github` in the settings) goes in once the vault is
 * connected — for a new repository, only once GitHub has it (issue #8), so a
 * repository that could not be made leaves nothing that reads as set up —
 * and the automations are given to this Mac only when no Mac has them: a
 * Mac connecting to a vault another set up never takes them over, even when
 * the first sync kept this vault's settings note and copied theirs aside.
 */
export async function setUpSync({
  ports,
  vaultRoot,
  remote,
  mac,
  clock,
}: {
  ports: SetUpSyncPorts;
  vaultRoot: string;
  remote: SyncRemoteChoice;
  mac: SetUpMac;
  clock: Pick<Clock, 'now' | 'localNow'>;
}): Promise<SyncReport> {
  let report: SyncReport;
  try {
    refuseChoice(remote);
    await withPrograms(() => prepareRepository({ ports, vaultRoot, remote }));
    if (remote.kind === 'existing') {
      await withPrograms(() => connectExisting(ports.git, remote.url));
      // Marked before the first sync: should it stop part-way, on a merge,
      // the vault still reads as set up, and its next sync finishes the merge.
      await markSetUp({ ports, mac, theirs: null, automations: false });
    } else {
      await withPrograms(() => createOnGitHub({ ports, mac: mac.name, name: remote.name }));
      // The first sync commits and pushes the mark.
      await markSetUp({ ports, mac, theirs: null, automations: true });
    }
    // The first sync: for an existing repository, the notes already in it are merged in.
    report = await syncNow({ ports, mac: mac.name, clock });
    if (remote.kind === 'existing') {
      const theirs = await settingsCopiedAside({ ports, report });
      await markSetUp({ ports, mac, theirs, automations: true });
    }
    warnIgnored(ports.activity, report);
  } catch (cause) {
    ports.activity.record({
      level: 'error',
      kind: 'sync',
      message: `Sync could not be set up: ${cause instanceof Error ? cause.message : String(cause)}`,
      subject: null,
    });
    throw cause;
  }
  ports.activity.record({
    level: 'info',
    kind: 'sync',
    message: 'Sync set up: this vault now syncs with its GitHub repository.',
    subject: null,
  });
  return report;
}

/**
 * Atlas's mark in the settings, and — once `automations` is asked for —
 * who runs the automations, when this vault's settings name no Mac yet.
 */
async function markSetUp({
  ports,
  mac,
  theirs,
  automations,
}: {
  ports: SetUpSyncPorts;
  mac: SetUpMac;
  /** The other side's settings, when the first sync copied them aside. */
  theirs: Readonly<Record<string, unknown>> | null;
  automations: boolean;
}) {
  const settings = await ports.readSettings();
  const changes: Record<string, unknown> = automations
    ? automationsHandover({ ours: settings, theirs, mac })
    : {};
  if (settings[SYNC_KEY] !== SYNC_KEY_VALUE) changes[SYNC_KEY] = SYNC_KEY_VALUE;
  if (Object.keys(changes).length > 0) await ports.settings.save(changes);
}

/** The other side's settings, when both had a settings note and the first sync kept this one's. */
async function settingsCopiedAside({
  ports,
  report,
}: {
  ports: SetUpSyncPorts;
  report: SyncReport;
}): Promise<Readonly<Record<string, unknown>> | null> {
  const copied = report.conflicts.find(
    ({ path, whose }) => path === VAULT_SETTINGS_PATH && whose === 'theirs',
  );
  return copied === undefined ? null : ports.readSettingsCopy(createVaultPath(copied.copy));
}

/** Says, once at set-up, what of Atlas's own the vault's `.gitignore` keeps out (issue #8). */
function warnIgnored(activity: SetUpSyncPorts['activity'], report: SyncReport): void {
  for (const path of report.ignored) {
    activity.record({
      level: 'warning',
      kind: 'sync',
      message: ignoredByGitignoreWarning(path),
      subject: null,
    });
  }
}

/**
 * The first commit, and the new repository made from it. What is left out
 * of sync — a file over GitHub's limit, a folder that is a repository of its
 * own — is left out of this commit too (review A29-01): GitHub would refuse
 * the push, and every sync after it.
 */
async function createOnGitHub({
  ports: { git, fs, files, activity },
  mac,
  name,
}: {
  ports: SetUpSyncPorts;
  mac: string;
  name: string;
}) {
  const { leftOut, newly } = await leaveOut({ git, fs, files });
  for (const message of leftOutWarnings(newly)) {
    activity.record({ level: 'warning', kind: 'sync', message, subject: null });
  }
  await commitAll({ git, mac, message: syncSetUpMessage(mac), leftOut });
  expectOk(CREATE_REPOSITORY_STEP, await git.createGitHubRepository(name));
}

function refuseChoice(remote: SyncRemoteChoice): void {
  if (remote.kind === 'new-github' && !isRepositoryName(remote.name)) {
    throw new SyncError(
      'A GitHub repository name uses letters, numbers, dots, dashes and underscores.',
    );
  }
  const problem = remote.kind === 'existing' ? remoteUrlProblem(remote.url) : null;
  if (problem !== null) throw new SyncError(problem);
}

async function prepareRepository({
  ports,
  vaultRoot,
  remote,
}: {
  ports: SetUpSyncPorts;
  vaultRoot: string;
  remote: SyncRemoteChoice;
}): Promise<void> {
  const place = await repositoryPlace({ git: ports.git, folders: ports.folders, vaultRoot });
  const refusal = enclosingRepositoryRefusal(place);
  if (refusal !== null) throw new SyncError(refusal);
  if (!isOwnRepository(place)) expectOk('start a repository', await ports.git.init());
  else {
    if ((await readStatus(ports.git)).conflicts.length > 0) {
      throw new SyncError(
        'The vault’s repository is in the middle of a merge. Finish it, then set up sync.',
      );
    }
    // Refused before anything is written (issue #8): gh would make the
    // repository on GitHub, then fail to add an origin the vault already has.
    const origin = remote.kind === 'new-github' ? firstLine(await ports.git.remoteUrl()) : null;
    if (origin !== null) throw new SyncError(existingOriginRefusal(origin));
  }
  await writeIgnores(ports.fs);
}

/** Writes the managed block into `.gitignore`, keeping every line the person wrote. */
async function writeIgnores(fs: SetUpSyncPorts['fs']): Promise<void> {
  const path = createVaultPath(GITIGNORE_PATH);
  const root = await fs.listDirectory(VAULT_ROOT);
  if (!root.some((entry) => entry.path === path)) {
    await fs.createNote({ path, contents: withManagedIgnores(null) });
    return;
  }
  const current = await fs.readTextFile(path);
  const next = withManagedIgnores(current.text);
  if (next === current.text) return;
  await fs.writeTextFile({ path, contents: next, expectedModified: current.modified });
}

/**
 * Points `origin` at the repository (the host asks the person first), and
 * checks out its default branch: a vault started on `main` connected to a
 * repository on `master` takes `master`, so the two never split.
 */
async function connectExisting(git: GitPort, url: string): Promise<void> {
  const exists = (await git.remoteUrl()).code === 0;
  expectOk('connect the repository', await git.setRemote({ url: url.trim(), exists }));
  const listing = expectOk('ask GitHub for the repository’s branch', await git.remoteHead());
  const wanted = defaultBranchOf(listing);
  if (wanted === null || wanted === (await currentBranch(git))) return;
  expectOk(`use the repository’s branch ${wanted}`, await git.renameBranch(wanted));
}
