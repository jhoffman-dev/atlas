---
type: adr
id: ADR-0025
title: Sync sets up the open vault in place and never switches it
status: accepted
date: 2026-10-04
---

# ADR-0025 — Sync sets up the open vault in place and never switches it

## Context

Sync (U-29) keeps a vault in a GitHub repository through the Mac's own `git`
and `gh`. No ADR said what setting it up may do to the vault, and issue atlas-archive#8
showed what that cost. James set up sync for `~/Atlas Vault` and the app
cloned the new, empty repository into `~/Atlas Vault/pkm-space`, then
switched the open vault to it. His types, views and dashboards seemed to
disappear, and nothing synced. The notes were all still in `~/Atlas Vault`.

The attack on the first fix (`set-up.adversarial.test.ts`) found more ways
to the same result:

- A vault with an `origin` of its own was marked set up before `gh` ran. When
  `gh` failed, the vault read as set up and synced to the old remote.
- That failure was explained as the repository name being taken.
- An empty repository could be opened as an empty vault.
- The open vault could be picked through a symlink.
- A `.gitignore` line excluding `.atlas` was obeyed without a word.
- A Mac connecting to a vault another Mac set up took its automations.

## Decision

### Setting up happens in place, and nothing switches the vault

Settings → Sync works on the open vault's own folder. It runs `git init`
there if the folder is not a repository yet, writes the managed block into
`.gitignore`, and connects the folder to GitHub in one of two ways:

- **New repository**: `gh repo create --source=. --remote=origin --push`
  makes a private repository from the folder.
- **Connect existing repo**: the folder's `origin` is pointed at the
  repository's address, the folder follows the repository's default branch,
  and the first sync merges the repository's notes into the vault's. Nothing
  is replaced.

Setting up sync never clones anything and never changes which vault is open.
The only flow that switches vaults is "Open a vault from GitHub", and it is
refused wherever it could replace the open vault (see below).

### The mark goes in only when the vault is really connected

A vault reads as set up (`inspectSync`) only when all three hold:

- it is a repository of its own with an `origin`;
- its `.gitignore` has Atlas's managed block;
- its settings note says `sync: github`.

The mark is the last of these to be written:

- **New repository**: the mark and the automations Mac are written only
  after `gh` has made the repository and pushed to it. The first sync then
  commits and pushes them. If `gh` fails, the mark is never written and the
  vault reads as not set up. The managed `.gitignore`, a `git init` and the
  set-up commit may stay behind. On their own they make nothing sync, and
  trying again reuses them.
- **Connect existing repo**: the mark is written once `origin` is connected
  and before the first sync. If that sync stops partway through a merge, the
  next sync finishes the merge.

### Refusals, each made before anything is written or cloned

- **A new repository for a vault that already has an origin** (an
  obsidian-git vault, or a code project) is refused. The message says where
  the vault sends now ("This vault already sends to <url>…") and gives two
  ways on: connect that repository by its address, or remove the origin
  first. `gh` would otherwise create the repository on GitHub and then fail
  to add an origin that already exists. If `gh` does fail with "remote
  origin already exists", the message says that. It is never reported as a
  taken name.
- **A vault inside another repository's work tree** is refused, as before,
  so the vault's notes never end up in someone's code project.
- **Open a vault from GitHub into the open vault, or into a folder inside
  it**, is refused, and the message points to Settings → Sync. The two
  folders are compared as the disk spells them. The host resolves the
  folder picked in its own dialog and the open vault, and refuses to resolve
  anything else, so this reveals nothing else about the disk. TypeScript
  compares the two, case-folded as macOS disks are. A symlink to the vault,
  or `/var` for `/private/var`, cannot hide the open vault. Under ADR-0005
  the host only resolves; it does not decide.
- **Opening an empty repository from GitHub** is refused before cloning.
  `git ls-remote --heads -- <url>`, a fixed folder shape on the host, lists
  no branches. An empty repository holds no vault to open. The person meant
  to put the open vault in it, which is what Settings → Sync does. Nothing
  has been cloned at that point, so there is no folder to clean up.

### Settings on first connect: this vault's copy wins

When both sides have `.atlas/settings.md` and they differ, the first sync
treats it like any conflict. This Mac's file stays in place, and the other
side's is saved under `Sync conflicts/atlas/` (for example
`Sync conflicts/atlas/settings (conflict from Studio).md`). A copy of
anything under `.atlas` goes there rather than beside the original, where
it would be read as a second live rule or view. The person can open the
copy and merge in whatever they want to keep.

### The automations stay with the Mac that has them

Automations run on one Mac, named by its id (`automationsMac`), because two
Macs running the same rule would each act on it, and their logs would
conflict. At set-up:

- If this vault's settings already name a Mac, nothing changes.
- If not, and the first sync copied the other side's settings aside, the
  Mac those settings name keeps the automations. Its id and name are copied
  into this vault's settings, so the shared settings go on naming it.
- Otherwise, this Mac takes the automations.

A Mac connecting to a vault never takes the automations from another Mac.
Settings → Sync can still move them to this Mac when the person asks.

### What is never synced

- **Atlas's managed `.gitignore` block**, each line with its reason:
  - `.atlas-cache/`, the index, which each Mac rebuilds;
  - `.DS_Store`;
  - Obsidian's per-Mac `workspace*.json`;
  - Obsidian's `.trash/`.
- **What Atlas leaves out on this Mac only.** These are listed in the
  vault's own excludes file, `.git/atlas-sync/exclude`, which never syncs:
  - files over GitHub's size limit;
  - folders that are git repositories of their own. Only that folder stays
    behind; the rest of the vault still syncs.
- **The sync's own journal**, `.git/atlas-sync/journal.json`.
- **Things that are not in the vault at all**: secrets (in the Keychain,
  ADR-0017), the Activity log and window state.

Everything else in the vault syncs, `.atlas` and `Chats/` included.

**The person's own `.gitignore` lines are theirs.** Atlas never edits or
overrides them. But a line that keeps something of `.atlas` out of git is
reported:

- each sync's report names it, as a file directly in `.atlas` or as its
  folder there (`.atlas/types/`);
- Settings → Sync lists it under "Staying on this Mac, not synced";
- set-up writes a warning to the Activity log.

Atlas offers no automatic fix. Removing the line is the person's call.

## Consequences

- An Atlas bug can no longer make set-up switch the vault: nothing in it
  writes the vault location.
- A failed "new repository" can leave a set-up commit and the managed
  `.gitignore` in a vault that does not sync. Both are harmless, and trying
  again reuses them. If `gh` had already added its origin, the retry is
  refused, naming that repository. The person can then connect it by its
  address.
- The host gained one folder shape (`ls-remote --heads -- <url>`) and one
  command (`git_folder_on_disk`). Both are limited to folders the host was
  handed.
- Recovery for issue atlas-archive#8's case: delete the empty clone folder inside the
  vault (`pkm-space`), open the real vault, then go to Settings → Sync →
  Connect existing repo with the repository's address. The remote's set-up
  commit merges into the vault. Its `.atlas/settings.md` conflicts with the
  vault's, so the vault's copy stays and the remote's is saved under
  `Sync conflicts/atlas/`. The automations stay with the Mac that copy
  names. If the vault already has Atlas's own `.gitignore` block, it stays
  as it is; if it does not, the block is added.
