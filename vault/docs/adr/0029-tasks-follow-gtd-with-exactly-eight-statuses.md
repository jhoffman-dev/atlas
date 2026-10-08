---
type: adr
id: ADR-0029
title: Tasks follow GTD, with exactly eight statuses, and old statuses are migrated once
status: proposed
date: 2026-10-07
---

# ADR-0029 — Tasks follow GTD, with exactly eight statuses, and old statuses are migrated once

## Context

James has run GTD for years: Inbox, Backlog, Next Action, In Progress,
Waiting, Someday, Longterm, Archive. Backlog exists because Next Action
became chaos; In Progress because tasks span days. Atlas's task type today
has `backlog, next, doing, review, done` (this repository's own board), and
James's vault may hold others. Changing a select's options without moving
the notes would strand their values.

## Decision

**The built-in Task type's `status` has exactly these options, in this
order: `inbox, backlog, next-action, in-progress, waiting, someday,
longterm, archive`, labelled as James writes them.** New tasks are `inbox`.
`waiting` requires a `waiting_on` relation to a Person. Tasks also gain
`contexts` (multi-select), `defer`, `due`, `estimate` (minutes), `source`
(a block link) and `project` (relation to Project / Area).

**"Done" is not a status.** A ticked task is `archive` with `completed:`
set to the day (the type's `done:` option is `archive`), so finished work
leaves every list in one move and the Archive (Phase 23) can take it later.

**Old statuses are migrated once, by a previewed rewrite** — a dry-run table
of every task, old → new (`backlog→backlog`, `next→next-action`,
`doing→in-progress`, `review→in-progress`, `done→archive` with `completed`
from the file's last change; anything unknown → `inbox`), then one write per
note through the byte-preserving save, recorded as one undoable run. The
mapping is a pure domain table, editable before running. It is built on the
type editor's existing `renameOption` note migration
(`domain/types/note-migration.ts`, `application/types/migrate-notes.ts`),
extended from one rename to a many-to-one mapping plus a set `completed`.

## Consequences

- Task is already a built-in type (`BUILT_IN_TYPES`), but nothing writes a
  built-in's file into a vault. An "ensure built-in types" step, which adds
  missing properties and never removes James's, lands with this change.

- Views and automations that filter on old values are rewritten in the same
  run, or listed for James if they cannot be.
- This repository's dev vault keeps its own `phase` workflow only if it is
  migrated too; it is the first test vault.
- Checklist lines (`- [ ]`) in a task body are the subtask model; In
  Progress plus a progress bar replaces a status per step.

## As built (P30-02, 2026-10-08)

Where the build differs from, or settles, what is written above:

- **The migration is its own use-case, not `renameOption` extended.** A
  rename goes through `migrateNotes`, which keeps no record of what a note
  held, so it cannot be undone byte for byte. The GTD migration
  (`application/gtd`) reads every file it will change, writes a record of each
  one's frontmatter as it was and as it will be to
  `.atlas/migrations/task-statuses.md` **before** changing anything, then
  writes each file once — frontmatter only, refused by the host if the file
  moved on since it was read. Undo puts back the recorded frontmatter wherever
  the file still says what the migration wrote, so a run, then an undo, gives
  every file back byte for byte; a file edited since is left and named.
- **It is resumable and idempotent.** A GTD status maps to itself whatever the
  mapping says, so a second run finds nothing to do. A run cut off partway is
  run again from a fresh preview of what is left, and its record is merged
  into the first, keeping each file's original bytes, so one undo covers both.
- **Unknown includes none.** A task with no status goes to `inbox`, as an
  unknown one does. A status spelled another way (`Next Action`,
  `in_progress`) is read as the status it names.
- **The Task type keeps what the vault has.** Its `status` becomes the eight;
  every other GTD property it has no key for is added; a key it has is left as
  it is, even where GTD would have made it another kind (this repository's
  `estimate` stays text).
- **Templates of type task are migrated with the tasks**, so a new task from
  one never starts on a status that no longer exists. Capture then sets
  `inbox` when the Task type has it.
- **Views and automations** are those in `.atlas/views` and
  `.atlas/automations`. An Atlas query's status values are rewritten in place,
  by their span, for `=` and `!=`; a table view's `filters:` for `is` and
  `isNot`. Any other comparison with an old status, and any SQL view that
  reads `status`, is listed instead. A dashboard's widgets are not read.
- **The GTD views** — Inbox, Next actions, Waiting, Someday and Longterm — are
  query views written into `.atlas/views` by the same run, never over a view
  of the same name.
- **The rules hold everywhere a task is written** — a pane, a view, the type
  table, the API — through one wrapper, `withTaskRules`, worked out against
  the frontmatter as each write reads it.
