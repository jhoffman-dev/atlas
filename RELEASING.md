# Releasing

The app uses **semantic versioning** (`vMAJOR.MINOR.PATCH`), starting at **v0.1.0**
(issue #481). Before 1.0, a minor bump is new features or anything that changes how a
vault is read or written; a patch is fixes only.

Only James cuts releases. Agents never push a tag or publish a release.

## One version, many files

The root `package.json` is the source of truth. These copy it, and must agree:

- every workspace package's `package.json` (`apps/*`, `packages/*`);
- `apps/desktop/src-tauri/tauri.conf.json` — what the app reports at runtime;
- `apps/desktop/src-tauri/Cargo.toml` and the app's entry in `Cargo.lock`.

```sh
pnpm version:set 0.2.0     # an exact version, which must come after the current one
pnpm version:set patch     # or a bump: major, minor, patch
pnpm version:check         # fails, naming each file that disagrees
```

`version:set` changes the version line and nothing else in each file. `version:check`
runs in the gate (`static` job) and in `pnpm gate`, so a hand edit that misses a file
fails CI. The rules live in `tools/release/versions.ts`.

The running app shows its version, and the commit it was built from, in
**Settings → About**. The local API reports both from `GET /v1/status` (`version`,
`build`), and the MCP server reports the version as its own.

## Cutting a release

1. Update `CHANGELOG.md`: move what is under **Unreleased** to a heading for the new
   version, with today's date.
2. Bump the version on a branch and merge it through a pull request as usual:

   ```sh
   pnpm version:set minor
   git commit -am "Release v0.2.0"
   ```

3. Once it is on `main`, tag that commit and push the tag:

   ```sh
   git switch main && git pull
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

4. The **release** workflow (`.github/workflows/release.yml`) then:
   - checks every version file agrees and that the tag names that version;
   - runs the whole gate (it calls `gate.yml`);
   - builds the `.app` and `.dmg` for Apple silicon with `pnpm tauri build`, in a `build`
     job that can only read the repository;
   - in a separate `publish` job — the only one that can write, and it installs and runs
     nothing from the repository — makes a **draft** GitHub Release named after the tag,
     with notes generated from the pull requests merged since the last release, and
     attaches the build. A tag with a `-` in it (`v0.2.0-rc.1`) is marked as a
     pre-release.

5. Read the draft on GitHub, edit the notes if needed, and publish it.

A rerun of the workflow for the same tag finds the existing draft and replaces its files
rather than making a second one. If the tag's release is already published, `publish`
fails instead of touching it.

Every action the workflows use is pinned to a commit SHA, with its version in a comment;
Dependabot (`.github/dependabot.yml`) proposes updates weekly.

## Dry run

**Actions → release → Run workflow**, on any branch, with **dry_run** ticked (the
default). It runs the gate and builds the `.dmg`, kept as the run's
`macos-aarch64-apple-darwin` artifact for 14 days, and makes no release. Unticking
**dry_run** makes a release only when the workflow is run on a tag; on a branch it still
builds only.

## Signing and notarisation

Off until James has an Apple Developer account. The workflow signs and notarises only
when all six `APPLE_*` secrets below are set; with some but not all of them it fails,
naming the missing ones. Until then it builds an
**ad-hoc signed** app (identity `-`), and the release notes say how to open it the first
time: System Settings → Privacy & Security → **Open Anyway** (right-click → **Open** on
macOS 14 and earlier), or `xattr -dr com.apple.quarantine "/Applications/<app>.app"`.
The install notes are in `.github/release/`.

To turn signing on (James):

1. Join the Apple Developer Program, and create a **Developer ID Application**
   certificate in Xcode or on developer.apple.com.
2. Export it from Keychain Access as a `.p12` with a password.
3. Make an app-specific password for the Apple ID at appleid.apple.com.
4. Add these repository secrets (Settings → Secrets and variables → Actions):

   | Secret                       | What it is                                                   |
   | ---------------------------- | ------------------------------------------------------------ |
   | `APPLE_CERTIFICATE`          | The `.p12`, base64: `base64 -i cert.p12 \| pbcopy`           |
   | `APPLE_CERTIFICATE_PASSWORD` | The `.p12`'s password                                        |
   | `APPLE_SIGNING_IDENTITY`     | `Developer ID Application: <name> (<team id>)`               |
   | `APPLE_ID`                   | The Apple ID's email address                                 |
   | `APPLE_PASSWORD`             | The app-specific password, not the account password          |
   | `APPLE_TEAM_ID`              | The ten-character team id, from the developer account's page |

The next tag builds signed and notarised, and its notes drop the quarantine step.

## Auto-update

Tauri's updater plugin is wired in but **off**. It is an optional Cargo feature,
`updater`, so a normal build does not include it, and the workflow builds with it only
once `tauri.conf.json` carries the updater's public key. Turn it on after signing works:
an update to an app macOS will not open is no update.

1. Make the updater's key pair, on James's Mac, and keep the private key out of the repo:

   ```sh
   pnpm --filter @atlas/desktop tauri signer generate -w ~/.tauri/updater.key
   ```

2. Add the repository secrets `TAURI_SIGNING_PRIVATE_KEY` (the contents of
   `~/.tauri/updater.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (its password).
3. In a pull request, add the **public** key (`~/.tauri/updater.key.pub`) and the update
   address to `apps/desktop/src-tauri/tauri.conf.json`:

   ```json
   "bundle": { "createUpdaterArtifacts": true },
   "plugins": {
     "updater": {
       "pubkey": "<contents of updater.key.pub>",
       "endpoints": ["https://github.com/jhoffman-dev/atlas/releases/latest/download/latest.json"]
     }
   }
   ```

   and grant `updater:default` in `apps/desktop/src-tauri/capabilities/default.json`.
   For a local `pnpm tauri build`, pass `--features updater` too.

4. Add the check itself: `@tauri-apps/plugin-updater`'s `check()` behind a port, and a
   "Check for updates" control in Settings → About. That is a feature of its own, with
   its tests, in its own pull request.

From then on the `build` job signs the update bundle (`<app>.app.tar.gz` and its `.sig`)
and the `publish` job attaches both to the release. The signing key reaches the build
only while the updater is on. The workflow fails if the public key is in
`tauri.conf.json` but `createUpdaterArtifacts` is not `true`, or the private key secret
is missing.

**`latest.json` is still to add.** The updater reads it to learn of a new version.
`publish` will write it, before uploading, from what is already in hand — no build, no
secret:

```sh
jq -n --arg version "${TAG#v}" --arg sig "$(cat build/*.app.tar.gz.sig)" \
  --arg url "https://github.com/$GITHUB_REPOSITORY/releases/download/$TAG/<app>.app.tar.gz" \
  --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{version: $version, pub_date: $date,
    platforms: {"darwin-aarch64": {signature: $sig, url: $url}}}' > build/latest.json
```

That lands with the updater's own pull request (step 4), where it can be tried end to end. The updater reads `latest.json` from the **latest
published** release, so a draft reaches nobody until it is published.

## Intel Macs

The build is Apple silicon only. A universal build (`--target universal-apple-darwin`,
with the `x86_64-apple-darwin` Rust target added) compiles the Rust twice, the embedding
model's crates included, roughly doubling the release job. Add it if an Intel Mac ever
needs the app.
