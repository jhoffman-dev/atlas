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

- **What is finished is kept outside every folder copied**, in
  `~/Library/Application Support/.dfai-rename-migration.json`: each folder pair
  done, by a key that names its place under `~/Library`
  (`WebKit/com.dailyflowai.dfai`), never an absolute path, so a renamed home
  folder finds its pairs finished; and each Keychain account done, still being
  tried, or given up. It is never judged from whether a new folder exists:
  WebKit makes its folder as the webview starts, and a launch whose copy
  failed would otherwise leave a folder that looks finished. It is saved
  durably: a temporary file flushed with `F_FULLFSYNC`, renamed into place,
  and the folder flushed.
- **A damaged state file** (unreadable, or not one this build wrote) is kept,
  renamed to `.dfai-rename-migration.json.damaged-<n>`, and the launch works
  from what it can see: a new folder already there is taken as DFAI's own and
  kept (it cannot be known to be stale, so it is not set aside), and a missing
  one is copied into. Keychain items are copied where DFAI has none under the
  account. That can bring back a secret the person removed in DFAI — a risk
  accepted only in this case, since the record of what was removed is what was
  lost. When the damaged file cannot even be renamed aside, the launch stops
  rather than write over it.
- **Folders:** Application Support and WebKit, `dev.jhoffman.atlas` →
  `com.dailyflowai.dfai`, and WebKit `atlas` → `dfai` for the unbundled build.
  A pair not yet done is copied whole, into a staging folder beside the new one
  that is then renamed into place. Nothing is merged: a folder is one program's
  state (an index and its write-ahead log, WebKit's salted storage), and half
  of each would be neither. A new folder already there for a pair not done was
  made by something else, so it is moved aside to `<folder>.pre-dfai-<n>`, the
  first number free, and never deleted. An old folder that is itself a link is
  followed and its contents copied, so the new folder is never a link into
  Atlas's data. A file that vanishes while the copy walks is skipped and noted.
  A staging folder left by a crash is made writable and removed first.
- **A folder that cannot be copied stops the launch.** DFAI shows a native
  alert ("DFAI couldn't move your Atlas data: … Quit Atlas and open DFAI
  again.") and quits before Tauri starts, because starting would make the new
  folders empty. The Keychain step waits for the folders.
- **Not while Atlas runs.** While a folder is still to be copied, a running
  Atlas (its bundled executable, or a development build's `target/*/atlas`)
  stops the launch with "Quit Atlas, then open DFAI again." An exclusive lock
  beside the state file, held for the whole migration, makes a second DFAI
  launch wait for the first; a lock that cannot be taken stops the launch like a
  failed copy. Only the person's own processes count as a running Atlas.
- **Keychain:** items under the old service are copied to the new one, account
  for account, unless the new service already has that account. This is done
  in Rust, because values never reach the webview (ADR-0017). Each account is
  recorded as done once copied, so a secret removed in DFAI is never copied
  back. An account that cannot be read — the person denied macOS's prompt — is
  asked for again on the next launch, at most three launches; then it is given
  up, and the person is told once, in an alert naming it, to set it again in
  Settings → Secrets.
- **A report:** every line the migration wrote, launch after launch, is left in
  `com.dailyflowai.dfai/migration-from-atlas.log`, so a release build says what
  moved, what was set aside and what failed. Accounts and paths only, never a
  value.
- **Nothing is deleted** in this release. Atlas's folders and Keychain items
  stay as they were, so going back to Atlas still works. Removing them is a
  decision for a later release.

The migration is safe to run any number of times. It is tested against
temporary folders and in-memory stores only, never a real `~/Library` or
Keychain.

**The MCP server reads `com.dailyflowai.dfai/api.json` first, and falls back to
`dev.jhoffman.atlas/api.json`** when the new file does not exist, for one
release. Any other failure to read the new file is reported, not passed over.

The MCP package keeps an **`atlas-mcp` bin** beside `dfai-mcp`, pointing at
the same file, for one release, so a client configuration that runs it by name
keeps working.

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

**The GitHub repository** was renamed by the maintainer from `jhoffman-dev/atlas`
to `jhoffman-dev/dfai`; GitHub redirects the old URLs. Links in the repo name
the new one, except in the records left as written. The private history repo,
`jhoffman-dev/atlas-archive`, keeps its name.

## Consequences

- The first launch of DFAI on a Mac that ran Atlas opens the same vault, with
  the same API token, secrets, sync id and preferences.
- macOS asks once for each old Keychain item, because DFAI is a different
  program from the one that made it. Choosing "Always Allow" ends it; denying
  leaves that secret to be typed again in Settings, or copied on a later
  launch.
- A Mac can run Atlas and DFAI side by side. After the first launch their
  per-Mac state is separate: a change made in one is not seen by the other.
- DFAI will not start its first launch while Atlas is running: it asks for
  Atlas to be quit, so no folder is copied mid-write.
- A launch that cannot copy a folder does not open; the alert says why, and
  the next launch tries again.
- A vault stays readable by both: nothing in it changes name.
