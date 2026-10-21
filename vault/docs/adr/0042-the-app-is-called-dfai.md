---
type: adr
id: ADR-0042
title: The app is called DFAI, and its first launch moves what Atlas kept
status: accepted
date: 2026-10-20
---

# ADR-0042 — The app is called DFAI, and its first launch moves what Atlas kept

## Context

The app was called **Atlas**. That name is taken several times over in this
space: ChatGPT Atlas, Atlas Workspace, "Atlas: Write and Create" and "Atlas:
Second Brain" all ship notes or AI products under it. The maintainer decided on
2026-10-20 (#482) to rename the app **DFAI**, short for **Daily Flow AI**. He
owns `dailyflowai.com`, `dfaiapp.com` and `dfai-app.com`.

A Tauri app files everything it keeps on a Mac under its bundle identifier,
which was `dev.jhoffman.atlas`:

- `~/Library/Application Support/<identifier>`: the remembered vault
  (`vault.json`), the API's connection file (`api.json`, ADR-0016), the
  Activity log, the embedding model (ADR-0031) and the SQLite grants;
- `~/Library/WebKit/<identifier>`: the webview's `localStorage`, which holds
  this Mac's sync id, the theme, folded groups, the right sidebar's state and
  work a closing pane could not save. An unbundled build (`pnpm tauri:dev`) has
  no identifier, and WebKit files it under the executable's name instead;
- the login Keychain, under the service name `dev.jhoffman.atlas` (ADR-0017).

Changing the identifier without moving these would make the first launch look
like a new install: no vault, a new API token, every secret to type again, and
a new sync id for this Mac.

## Decision

**The product name is DFAI** everywhere a person reads it: the window, the
macOS menus and About (which Tauri takes from `productName`), Settings,
notices, errors, the guide, the README and docs, the MCP server's instructions
and tool descriptions, the API's messages and its user agent (`DFAI/<version>`).
"Daily Flow AI" is the long form, where a sentence wants it.

**The bundle identifier is `com.dailyflowai.dfai`**: reverse DNS on
`dailyflowai.com`, the domain that spells the name out. The Keychain service is
the identifier, as before.

**The first launch copies what Atlas kept** (`src-tauri/src/rename_migration.rs`),
first thing in `run`, before Tauri makes any folder or webview:

- Application Support and WebKit, `dev.jhoffman.atlas` → `com.dailyflowai.dfai`,
  and WebKit `atlas` → `dfai` for the unbundled build. A folder is copied whole,
  into a staging folder beside the new one that is then renamed into place, and
  only when the new folder does not exist. Nothing is merged into a folder DFAI
  already has: a folder is one program's state (an index and its write-ahead
  log, WebKit's salted storage), and half of each would be neither.
- Keychain items under the old service are copied to the new one, account for
  account, unless the new service already has that account. This is done in
  Rust, because values never reach the webview (ADR-0017). Once every item has
  been copied, a marker file (`migrated-from-atlas`) in the new Application
  Support folder records it, so the Keychain is read once: a secret removed in
  DFAI stays removed, and macOS's prompts for the old items are not shown
  again. An item that could not be read leaves no marker, and is tried again on
  the next launch.
- **Nothing is deleted** in this release. Atlas's folders and Keychain items
  stay as they were, so going back to Atlas still works. Removing them is a
  decision for a later release.

The migration is safe to run any number of times: a copied folder is found and
left alone, and a copied secret is found and not written over. It is tested
against temporary folders and in-memory stores only, never a real `~/Library`
or Keychain.

**The MCP server reads `com.dailyflowai.dfai/api.json` first, and falls back to
`dev.jhoffman.atlas/api.json`** when the new file does not exist, for one
release. Any other failure to read the new file is reported, not passed over.

**Some internal names keep "atlas", on purpose.** Each is read by something
other than this build — a vault synced to a Mac still running Atlas, another
tool, or a person's own configuration — and renaming it would break that reader:

- the vault folder **`.atlas/`**, and `.atlas-cache/`. Every vault has one, and
  a Mac still on Atlas syncs the same folder. Moving it to `.dfai/` would need
  both versions to read both names and agree on which wins, for as long as
  either runs. That is a separate decision; this one keeps `.atlas/` as an
  internal name.
- the `atlas-query` fence, the `atlas:` comment markers and the `atlas_*`
  frontmatter keys in notes, for the same reason;
- the `# >>> Atlas sync` lines that mark DFAI's block in a vault's
  `.gitignore`, found by those exact lines; and the `Atlas sync from …` subject
  of a sync's commits. Atlas reads only its own name back out of a commit, so
  DFAI keeps writing it, and reads either `Atlas` or `DFAI` so a later release
  can switch. The handled-ledger's note in an automation's log keeps its words,
  because the ledger is rewritten whole and two Macs would trade the words back
  and forth;
- the MCP tool names (`atlas_search`, …), the `ATLAS_*` environment variables,
  and the `/v1/atlas-query` route, which a person's MCP configuration, scripts
  and permission rules already name;
- the `atlas.*` `localStorage` keys, carried over as they are by the WebKit
  copy;
- code identifiers such as `AtlasQuery` and `isAtlasNote`. The package scope
  (`@atlas/*` → `@dfai/*`) and the Rust crate (`atlas` → `dfai`) are renamed,
  in a commit of their own.

The prompts DFAI ships say "DFAI" now. The words they had as Atlas are added to
each prompt's earlier versions, so an untouched copy in a vault is brought up to
date rather than taken for the person's own edit. The Google calendar DFAI makes
is called "DFAI blocks"; one Atlas made, "Atlas blocks", is still taken as the
app's own, so reconnecting never makes a second.

Earlier ADRs say "Atlas". They are records of decisions made under that name,
and are left as they were written; read "Atlas" there as DFAI.

**The GitHub repository** (`jhoffman-dev/atlas`) is renamed by the maintainer in
GitHub's settings. GitHub redirects the old URLs, so links in the repo keep
working until they are updated.

## Consequences

- The first launch of DFAI on a Mac that ran Atlas opens the same vault, with
  the same API token, secrets, sync id and preferences.
- macOS asks once for each old Keychain item, because DFAI is a different
  program from the one that made it. Choosing "Always Allow" ends it; denying
  leaves that secret to be typed again in Settings, or copied on a later
  launch.
- A Mac can run Atlas and DFAI side by side. After the first launch their
  per-Mac state is separate: a change made in one is not seen by the other.
- Running Atlas and DFAI's first launch at the same moment can copy a folder
  mid-write. Quit Atlas before opening DFAI for the first time.
- A vault stays readable by both: nothing in it changes name.
