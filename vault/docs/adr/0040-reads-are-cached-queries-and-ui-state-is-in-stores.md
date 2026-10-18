---
type: adr
id: ADR-0040
title: Reads are cached queries, and the window's state is in stores
status: proposed
date: 2026-10-17
---

# ADR-0040 — Reads are cached queries, and the window's state is in stores

## Context

The maintainer (#238, 2026-10-16): "Anything less than Obsidian performance,
and this app is sunk." Speed comes before features until this epic is done.

Measured on `main` at 3fb9c74a, on the 2,008-note fixture vault: one
`vault-changed` event cost 110–180 host calls, 2.3–4.5 MB of IPC and 33–53
React commits. That one event is every autosave, every status change, every
board drag and every Inbox decision. The causes, all measured:

- The watcher refreshed the index on the app's own writes, so each write was
  refreshed twice: once by the app's `onChanged`, once by its echo.
- Each refresh set a global status to `working`, then to `ready:N`, so the
  `indexKey` that about 30 readers in `app.tsx` re-read on flipped twice per
  refresh.
- The graph, about ten settings readers and the type definitions were read
  again on every flip, whether anything they read had changed or not.
- `index_open` reopened the SQLite database on every refresh.
- All of the window's state lived in `App`, so every one of those changes drew
  the whole window again.

Performance 3 (#239) measured the first step on the same fixture with the
work-budget harness of Performance 2. Keeping the index ready, opening it once
and coalescing refreshes took one autosave and its echo from 56 to 35 commits
and from 85 to 55 host calls, and `index_open` from once per refresh to once
per vault.

## Decision

1. **Everything read from the vault, the index or the host is a query.** This
   is TanStack Query, keyed by the open vault, with `staleTime: Infinity`. A
   query is read again only when it is invalidated. Nothing in it is
   re-derived because something unrelated in the window changed.
2. **What invalidates a query is what changed.** That is the change feed's
   paths (`NoteChanges`, P28-03) and the watcher's paths. It is not a global
   key. A query names the paths or the kinds of path it depends on (a type
   definition, a template, a setting, the notes of a type). The SQL views are
   rebuilt only when a type definition changed.
3. **The app recognises its own writes.** A write the app made is refreshed
   once. The app keeps each of its writes for a few seconds: the path and
   what the write left there (the note's text and time, or nothing after a
   move or a trash). The watcher's report of a path is judged once the
   refreshes already asked have run, and dropped only when a refresh that
   began after the write read it into the index and the path still holds
   exactly what the write left. Anything else is refreshed for, so a change
   another program made is not lost unless it restored the same bytes and
   the same time: one in the same millisecond, or on a disk whose clock keeps
   seconds, leaves other bytes. A new note or folder is never taken as an
   echo. A write the app does not refresh for itself (the editor's autosave)
   is refreshed by its echo. The rule is in `packages/application`
   (`own-writes.ts`, `outside-changes.ts`, the index syncer); the host
   decides nothing (Performance 4, #254).
4. **The index stays ready.** It says `building` only for a vault's first sync
   after it opens and for a rebuild. A refresh never takes it out of `ready`,
   so nothing that waits on ready pauses or blanks for one. At most one sync
   of a vault runs, with at most one waiting behind it that every later ask
   joins. The index is opened once per vault (Performance 3).
5. **Row actions are optimistic.** Ticking a task, deciding an Inbox row or
   dragging a card moves the row at once. The same use-cases run, with the
   same stale-row guards, and a refusal puts the row back (Performance 6).
6. **The window's own state is in Zustand stores.** That covers the panes, the
   overlays and search, the shell, the index status and the sync status. A
   component subscribes to the slice it draws through a selector. An object
   selector goes through `useShallow`, because a new object per call loops
   `useSyncExternalStore`.
7. **Both live in the composition root only.** Queries and stores live in
   `apps/desktop`. `packages/domain` and `packages/application` are
   unchanged: the use-cases and ports stay as they are, and a query calls
   them. `packages/ui` stays prop-driven. ESLint forbids `zustand` and
   `@tanstack/react-query` in all four packages.
8. **Each step is held by a work budget.** The budgets are counts of commits,
   renders and host calls per action, in `tools/perf/budgets.json`, held in
   CI. A step may lower a budget; it never raises one without the
   maintainer's agreement.

## Consequences

- An edit costs work in proportion to what it changed, not to how many
  readers the window has.
- `indexKey` is kept, derived from the index-status store, while readers move
  off it one by one (Performances 5 to 10). It is deleted in Performance 11,
  when this ADR is accepted.
- Readers no longer blank or pause while a refresh runs. A reader that runs
  during a refresh sees each row either as it was or as it now is, never half
  written: the index writes whole notes.
- The sync schedule counts an edit when the index's key moves, which now
  happens when a refresh settles rather than when it starts. A watcher event
  for anything the index does not hold (a template, a view, a dashboard, an
  attachment, a folder) asks for a loud refresh, so its readers and the push
  schedule still hear of it. A refresh that fails still moves the key.
- Query keys must name the vault, or one vault's answer could be shown in the
  next. A query's invalidation must name everything it reads, or it shows a
  stale answer until something else invalidates it. A review checks both.
- There are two new dependencies, in one place, with one way of using each.
  Each is less code than the hand-written caches and effects it replaces.

## Alternatives considered

- **Memoise harder in `App`.** This was tried in Performance 1 (#236). It
  helped at the edges, but the state still lives in one component, so every
  change still draws the whole window and re-runs every effect keyed on it.
- **React context per concern.** Every consumer of a context draws again on
  every change of its value. A context would need selectors to help, and
  selectors are what a store already is.
- **Hand-written caches in each hook.** That is roughly what there was: about
  30 effects re-running on one key, each with its own idea of staleness and
  its own vault check. It is the code that produced the measurements above.
- **Push the reads into Rust.** That would make each call cheaper, but it would
  still make every call, and it moves decisions into the host, which ADR-0005
  rules out. Moving Rust file commands off the main thread is listed as later
  work in #238 and is not an alternative to this.
- **Redux Toolkit, or Jotai.** Redux brings more machinery than the window
  needs. Atoms fit fine-grained state, but the window's state is a few
  coherent slices. Zustand is a small store with selectors and nothing more.
