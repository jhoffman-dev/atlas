# Atlas

A local-first macOS desktop app that replaces Notion and Obsidian: markdown notes, typed
objects, SQL-backed database views, tasks, calendar, projects and dashboards. Your notes stay
plain markdown files on disk; the SQLite index is a disposable cache built from them.

Tauri v2 · React · TypeScript · TipTap · SQLite.

- **[PLAN.md](PLAN.md)** — architecture, decisions, phases, risks.
- **[Field Guide](https://claude.ai/artifact/QXvTge2zPuY5YS5g7QYveH)** — how to use the app
  (James's private guide; the link is not public).
- **Tasks** — [GitHub Issues](https://github.com/jhoffman-dev/atlas/issues). The in-app
  board in the repo's `vault/` holds the history up to 2026-09-29.

## Prerequisites (fresh Mac, Apple silicon)

| Tool                     | Version                                  | Install                                                                                   |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Xcode Command Line Tools | any current                              | `xcode-select --install`                                                                  |
| Homebrew                 | any current                              | see [brew.sh](https://brew.sh)                                                            |
| Node                     | 22 or later (`engines`; CI uses 22)      | `brew install node@22` (or `brew install node` for the current release)                   |
| pnpm                     | 11 (CI uses 11)                          | `brew install pnpm`                                                                       |
| Rust                     | stable via rustup (crate minimum 1.77.2) | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` then accept the default |

That is everything Tauri v2 needs on macOS — the Command Line Tools supply the compiler,
linker and WebKit SDK; full Xcode is not required. The rustup default profile includes
`clippy` and `rustfmt`, which `pnpm gate` uses. There is no `rust-toolchain` file; any recent
stable works.

Use the rustup installer rather than `brew install rust`: it puts `cargo` in `~/.cargo/bin`,
which the `tauri:*` scripts add to `PATH` themselves (the `rust:*` scripts in `pnpm gate` need
it on your shell's `PATH`, which the installer sets up). `brew install node@22` is keg-only,
so follow the `echo 'export PATH=…' >> ~/.zshrc` line it prints. Corepack is not bundled with
Node 25+, so install pnpm from Homebrew.

## Get the code

```sh
git clone https://github.com/jhoffman-dev/atlas.git
cd atlas
pnpm install
```

## Run in development

```sh
pnpm tauri:dev
```

Starts Vite on `http://localhost:1420`, compiles the Rust host (a few minutes the first
time) and opens the Atlas window. The frontend hot-reloads.

- **First run:** Atlas shows **Open a vault** — choose any folder of markdown notes. Nothing
  is imported or moved; Atlas works on the files where they are and reopens the same vault
  next launch. The repo's own `vault/` is a real vault (the project board, tasks and docs).
- **Restart after Rust changes.** A change under `apps/desktop/src-tauri/` needs
  `pnpm tauri:dev` stopped and started again; TypeScript/CSS changes do not.
- **Stale dev cache.** If the window is blank or shows old code after a dependency or branch
  change, stop the dev server and run `rm -rf apps/desktop/node_modules/.vite`.

## Build a standalone app

```sh
pnpm --filter @atlas/desktop tauri:build
```

(`pnpm tauri build` at the root does not work — there is no root `tauri` script.) It builds
the frontend, then a release Rust binary (about 3 minutes from clean). Output, on Apple
silicon:

- `apps/desktop/src-tauri/target/release/bundle/macos/Atlas.app`
- `apps/desktop/src-tauri/target/release/bundle/dmg/Atlas_0.1.0_aarch64.dmg`

The DMG step scripts Finder to lay out the window, so it fails with
`error running bundle_dmg.sh` from a shell that cannot drive Finder (SSH, an agent, no
Automation permission). The `.app` is already built by then. To get a DMG anyway, prefix
`CI=true` (skips the Finder layout); to build only the app, add `--bundles app`:

```sh
CI=true pnpm --filter @atlas/desktop tauri:build
pnpm --filter @atlas/desktop tauri:build --bundles app
```

Drag `Atlas.app` to `/Applications`. The build is **unsigned**: the first time, right-click
it → **Open** → **Open** (or allow it in System Settings → Privacy & Security).

## Optional: Claude

**Claude in Atlas** (the chat, ⌘J) runs through Claude Code by default. Install
[Claude Code](https://docs.claude.com/en/docs/claude-code) and log in once with `claude`;
Atlas finds it in `~/.local/bin`, `~/.claude/local` or `/opt/homebrew/bin` and never sees
your login. Settings → Claude can use an Anthropic API key (kept in the Keychain) instead.

**The MCP server** lets Claude Code or Claude Desktop read and write your vault through the
running app. Turn on the API in Atlas (**Settings → Connections**), then:

```sh
pnpm --filter @atlas/mcp build   # → apps/mcp/dist/main.js (pnpm build at the root builds it too)
claude mcp add atlas -- node /abs/path/to/atlas/apps/mcp/dist/main.js
```

Claude Desktop config, tools and environment variables: [apps/mcp/README.md](apps/mcp/README.md).

## Development commands

```sh
pnpm gate            # format, typecheck, lint, tests + coverage, build, rust lint + tests (what CI runs)
pnpm test            # Vitest once; pnpm test:watch to watch
pnpm e2e             # build, then Playwright in WebKit (first: pnpm exec playwright install webkit)
pnpm format          # Prettier write; pnpm lint:fix for ESLint autofixes
pnpm rust:test       # cargo test for the Tauri host
pnpm smoke:api --vault <scratch>   # drive every MCP tool against the running app (scratch vault only)
pnpm shots           # screenshot the built app's surfaces to design/out/shots
pnpm design:refs     # render design/target mockups to design/out/refs (needs network)
pnpm design:compare  # mockup beside app, per surface, at design/out/compare/index.html
```

Contributor rules — layers, testing bar, the hand-off gate — are in [ENGINEERING.md](ENGINEERING.md);
repo specifics and the things that bite are in [CLAUDE.md](CLAUDE.md).

## Troubleshooting

- **Blank window or old UI in dev** — `rm -rf apps/desktop/node_modules/.vite`, then
  `pnpm tauri:dev` again.
- **Built app shows an old frontend** — the Rust binary embeds `dist/`, and Cargo does not
  notice a frontend-only change. After `pnpm build`, run
  `touch apps/desktop/src-tauri/src/lib.rs` before building again.
- **`node` / `pnpm: command not found`** (in scripts, agents or non-login shells) — Homebrew
  lives in `/opt/homebrew/bin`, which is not on every shell's `PATH`:
  `export PATH="/opt/homebrew/bin:$PATH"`.
- **`cargo: command not found`** (e.g. in `pnpm gate`) — open a new terminal after installing
  rustup, or run `source ~/.cargo/env`.

## Contributing

Issues and pull requests are welcome. Please follow [ENGINEERING.md](ENGINEERING.md) and run
`pnpm gate` before opening a PR. Only the maintainer, James Hoffman, merges to `main`.

## License

[MIT](LICENSE) © 2026 James Hoffman.
