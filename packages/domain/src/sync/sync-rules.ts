/**
 * The smaller rules of syncing a vault through GitHub (U-29): what its
 * settings say, which Mac runs the automations, what a commit is called,
 * which remotes are accepted, and when a vault may not be synced at all.
 */

import { hasManagedIgnores } from './sync-ignore.ts';

/** Settings keys, in the vault's settings note, so every Mac reads the same ones. */
export const SYNC_INTERVAL_KEY = 'syncInterval';
export const SYNC_PUSH_DELAY_KEY = 'syncPushDelay';
/** The Mac that runs the automations, by the id it keeps for itself (A29-01). */
export const AUTOMATIONS_MAC_KEY = 'automationsMac';
/** That Mac's name as it was when it was named, to show; never what decides. */
export const AUTOMATIONS_MAC_NAME_KEY = 'automationsMacName';
/**
 * Atlas's mark that it set this vault's sync up (A29-01): `sync: github` in
 * the settings note, beside its block in `.gitignore`. A repository without
 * both — a code project, a vault kept with obsidian-git — is never committed
 * or pushed until the person connects it in Settings → Sync.
 */
export const SYNC_KEY = 'sync';
export const SYNC_KEY_VALUE = 'github';

/** The Mac named in the settings, or null when they name none. */
export function automationsMacOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * The automations settings to write when sync is set up on this Mac: none
 * when this vault's settings already name a Mac; the Mac the other side's
 * settings name, when a first sync kept this vault's settings note and
 * copied theirs aside (issue #8) — that Mac set the vault up and keeps them,
 * and the shared settings go on naming it; otherwise this Mac.
 */
export function automationsHandover({
  ours,
  theirs,
  mac,
}: {
  ours: Readonly<Record<string, unknown>>;
  /** The other side's settings, when a conflict copied them aside; null when not. */
  theirs: Readonly<Record<string, unknown>> | null;
  mac: { readonly id: string; readonly name: string };
}): Record<string, unknown> {
  if (automationsMacOf(ours[AUTOMATIONS_MAC_KEY]) !== null) return {};
  const theirMac = automationsMacOf(theirs?.[AUTOMATIONS_MAC_KEY]);
  if (theirMac === null) {
    return { [AUTOMATIONS_MAC_KEY]: mac.id, [AUTOMATIONS_MAC_NAME_KEY]: mac.name };
  }
  const theirName = theirs?.[AUTOMATIONS_MAC_NAME_KEY];
  return typeof theirName === 'string' && theirName.trim() !== ''
    ? { [AUTOMATIONS_MAC_KEY]: theirMac, [AUTOMATIONS_MAC_NAME_KEY]: theirName }
    : { [AUTOMATIONS_MAC_KEY]: theirMac };
}

/**
 * Whether the clock runs this vault's automations on this Mac. Two Macs
 * running the same rule would each archive, rewrite and log it, and their
 * logs would then conflict; so a synced vault names one Mac, by the id it
 * keeps for itself — a Mac's name changes when it is renamed, and two Macs
 * can share one. A vault that names none runs them wherever it is open, as
 * it did before sync.
 */
export function runsAutomationsHere({
  automationsMac,
  thisMacId,
}: {
  automationsMac: string | null;
  thisMacId: string;
}): boolean {
  return automationsMac === null || automationsMac === thisMacId.trim();
}

/** Whether Atlas set this vault's sync up: its settings say so, and its `.gitignore` holds Atlas's block. */
export function isSetUpByAtlas({
  settings,
  gitignore,
}: {
  settings: Readonly<Record<string, unknown>>;
  gitignore: string | null;
}): boolean {
  return (
    settings[SYNC_KEY] === SYNC_KEY_VALUE && gitignore !== null && hasManagedIgnores(gitignore)
  );
}

/**
 * The branch a remote's HEAD points at, from `git ls-remote --symref origin
 * HEAD` (`ref: refs/heads/<branch>\tHEAD`); null for an empty repository.
 */
export function defaultBranchOf(listing: string): string | null {
  const match = /^ref: refs\/heads\/(.+)\tHEAD$/m.exec(listing);
  return match?.[1] ?? null;
}

/** What a sync's commit says: which Mac, and when on its wall clock (`YYYY-MM-DDTHH:MM:SS`). */
export function syncCommitMessage({ mac, localNow }: { mac: string; localNow: string }): string {
  return `Atlas sync from ${mac.trim() || 'a Mac'} ${localNow.slice(0, 16).replace('T', ' ')}`;
}

/** What the first commit of a vault's sync says: which Mac set it up. */
export function syncSetUpMessage(mac: string): string {
  return `Atlas sync set up on ${mac.trim() || 'a Mac'}`;
}

/**
 * The Mac a commit came from, read back out of what Atlas called it; null
 * for a commit Atlas did not make — one made by hand, or by another tool.
 */
export function macOfCommit(subject: string): string | null {
  const line = subject.trim();
  const synced = /^Atlas sync from (.+) \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.exec(line);
  const setUp = /^Atlas sync set up on (.+)$/.exec(line);
  const mac = (synced ?? setUp)?.[1]?.trim() ?? '';
  return mac === '' ? null : mac;
}

/**
 * Remotes Atlas connects a vault to: GitHub over HTTPS or SSH, another host
 * the same ways, or a bare repository on a disk. Never one that starts like an
 * option, holds spaces, or names a transport helper (`ext::`), which git would
 * run as a program.
 */
export function remoteUrlProblem(raw: string): string | null {
  const url = raw.trim();
  if (url === '') return 'Paste the repository’s address.';
  if (url.length > 2048) return 'That address is too long.';
  // eslint-disable-next-line no-control-regex -- control characters are what this refuses
  if (/[\s\0-\x1f\x7f]/.test(url) || url.startsWith('-') || url.includes('::')) {
    return 'That is not an address git can use.';
  }
  if (carriesALogin(url)) {
    return 'That address has a password or token in it. Use the plain address from GitHub’s Code button: this Mac’s own GitHub login is what signs in.';
  }
  const scpLike = /^[A-Za-z0-9._-]+@[A-Za-z0-9.][A-Za-z0-9.-]*:[^-]/.test(url);
  // The host, after any `user@`, never starts like an option: ssh would read it as one.
  const hosted = /^(https|ssh):\/\/([^@/]+@)?[^-/@]/.test(url);
  if (hosted || scpLike || url.startsWith('/')) return null;
  return 'Use an https:// or git@ address, like the one GitHub’s Code button shows.';
}

/**
 * Whether the address holds a password or a token before its host. Kept, it
 * would sit in `.git/config` in plain text and be shown back in Settings;
 * Atlas never holds a GitHub login (U-29, ADR-0017). An https address needs
 * no user at all, and an ssh one only a user name (`git@`).
 */
function carriesALogin(url: string): boolean {
  const authority = /^(https|ssh):\/\/([^/]*)/.exec(url);
  if (authority === null) return false;
  const at = authority[2]?.lastIndexOf('@') ?? -1;
  if (at === -1) return false;
  const user = authority[2]?.slice(0, at) ?? '';
  return authority[1] === 'https' || !/^[A-Za-z0-9._-]{1,39}$/.test(user);
}

/** The folder a clone lands in: the repository's name, from its address. */
export function repositoryNameOf(url: string): string {
  const last = url.trim().replace(/\/+$/, '').split(/[/:]/).pop() ?? '';
  // GitHub names run to 100 characters; this keeps any other host's within a folder name too.
  const name = last
    .replace(/\.git$/i, '')
    .replace(/[^A-Za-z0-9._ -]/g, '-')
    .slice(0, 100);
  return name === '' || name.startsWith('.') || name.startsWith('-') ? 'vault' : name;
}

/** A GitHub repository name for a vault: its folder's name, as GitHub accepts names. */
export function suggestedRepositoryName(vaultName: string): string {
  const name = vaultName
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '')
    .slice(0, 100);
  return name === '' ? 'atlas-vault' : name;
}

/** Whether a name is one `gh repo create` is handed. */
export function isRepositoryName(name: string): boolean {
  return /^[A-Za-z0-9_.-]{1,100}$/.test(name) && !/^[-.]/.test(name);
}

/** How a vault sits in git, as `rev-parse --show-toplevel` answered in it and in the folder above it. */
export interface RepositoryPlace {
  /** The top of the work tree the vault is in; null when it is in none. */
  readonly topFromVault: string | null;
  /** The top of the work tree the folder above the vault is in; null when that is in none. */
  readonly topFromParent: string | null;
}

/**
 * Why a vault cannot be synced where it is, or null when it can. A vault in
 * another repository's work tree — the Atlas code repository, say — would
 * have its notes committed into that project, or that project's files into the
 * vault's history. The folder above is what is asked, not the vault: a vault
 * that is a repository of its own answers with itself, and git prints paths
 * with symlinks resolved, so comparing its answer with the vault's own path
 * would misjudge a vault reached through a link.
 */
export function enclosingRepositoryRefusal(place: RepositoryPlace): string | null {
  const outer = place.topFromParent;
  if (outer === null) return null;
  return `This vault is inside another git repository (${nameOf(outer)}), so Atlas won’t sync it: its notes would be mixed into that project. Move the vault out of that folder first.`;
}

/**
 * Why a new GitHub repository is not made for a vault that already sends
 * to one (issue #8). `gh repo create --remote=origin` makes the repository
 * and only then finds it cannot add the origin, so the refusal comes first,
 * before anything is written, with the two ways on.
 */
export function existingOriginRefusal(url: string): string {
  return `This vault already sends to ${url.trim()}, so Atlas won’t make a new repository for it. To sync with that one, use Connect existing repo with its address. To use a new one instead, remove the old origin first: in Terminal, in the vault’s folder, run \`git remote remove origin\`.`;
}

/** Whether `ls-remote --heads` listed any branch: a repository with none is empty. */
export function hasBranches(listing: string): boolean {
  return listing.split('\n').some((line) => line.trim() !== '');
}

/**
 * Why an empty repository is not opened as a vault (issue #8): there is no
 * vault in it, and opening it would trade the open vault for an empty one.
 * Putting the open vault into it is what Settings → Sync does.
 */
export function emptyRepositoryRefusal(): string {
  return 'This repository is empty — there’s no vault in it to open. To put the vault you have open in it, use Settings → Sync and connect it there.';
}

/**
 * Why a vault from GitHub cannot be copied into the folder picked for it, or
 * null when it can (issue #8). Copied into the open vault, the copy became a
 * folder of it — a repository inside the vault — and opening it left the
 * person's own notes behind. A person picking their open vault means to sync
 * it, which Settings → Sync does in place. Compared case-folded, as macOS's
 * own disks are.
 */
export function cloneFolderRefusal({
  picked,
  openVault,
}: {
  picked: string;
  openVault: string | null;
}): string | null {
  if (openVault === null) return null;
  const vault = folded(openVault);
  const folder = folded(picked);
  if (folder !== vault && !folder.startsWith(`${vault}/`)) return null;
  const where =
    folder === vault
      ? `${nameOf(openVault)} is the vault you have open`
      : `That folder is inside ${nameOf(openVault)}, the vault you have open`;
  return `${where}, so the copy would land inside it and Atlas would open the copy instead of your notes. To sync this vault with a GitHub repository, use Settings → Sync and connect it there. To open a vault from GitHub, choose a folder outside this one.`;
}

function folded(path: string): string {
  return trimSlash(path).normalize('NFC').toLowerCase();
}

/** Whether the vault is already a repository of its own, and not inside another. */
export function isOwnRepository(place: RepositoryPlace): boolean {
  return place.topFromVault !== null && place.topFromParent === null;
}

/** The folder above a vault's root, as an absolute path. */
export function parentFolderOf(root: string): string {
  const trimmed = trimSlash(root);
  const slash = trimmed.lastIndexOf('/');
  return slash <= 0 ? '/' : trimmed.slice(0, slash);
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function nameOf(path: string): string {
  return trimSlash(path).split('/').pop() ?? path;
}
