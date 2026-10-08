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
  the file still says what the migration wrote, so a run, then an undo, with
  nothing edited between, gives every file back byte for byte. A file whose
  frontmatter was edited since is left and named; one whose body alone was
  edited gets its frontmatter back and keeps the new body.
- **It is resumable and idempotent.** A GTD status maps to itself whatever the
  mapping says, so a second run finds nothing to do. A run cut off partway is
  run again from a fresh preview of what is left, and its record is merged
  into the first, so one undo covers both. A file in both keeps what it was
  before the first run only while it still held what the first run wrote;
  otherwise — the first never wrote it, or it was edited or synced since —
  undo gives back what the second run found, and the edit is kept. A file
  the second run made afresh — the first run's was deleted since — is
  recorded as made by the second, so undo takes it away while still as made.
  The record also says whether its last run got to the end, and which files
  it left; a run writes it unfinished before changing anything and marks it
  finished once it has tried every file.
- **Unknown includes none.** A task with no status goes to `inbox`, as an
  unknown one does. A status spelled another way (`Next Action`,
  `in_progress`) is read as the status it names, and one written as a
  one-item list (`[next-action]`) is written back as that status.
- **A status is what the index reads.** The rules, the migration and the
  views read a status trimmed, a one-item list as its item, as the index
  stores it: `waiting `, `[waiting]` and `waiting` are all Waiting to the
  rule, and a list of blank names in `waiting_on` is nobody. A GTD status set
  in another spelling is written as the status itself, so the files stay in
  the one spelling a tick and a board compare with.
- **The migration never makes what the rules refuse.** Waiting stays a
  mapping target, but a task it would send to Waiting with nobody in
  `waiting_on` goes to the Inbox instead, and the preview says why beside it.
  (Refusing Waiting as a target was rejected: a vault's own `blocked` whose
  tasks do say who they wait on should go there.)
- **The Task type keeps what the vault has.** Its `status` becomes the eight;
  every other GTD property it has no key for is added; a key it has is left as
  it is, even where GTD would have made it another kind (this repository's
  `estimate` stays text).
- **Templates of type task are migrated with the tasks**, so a new task from
  one never starts on a status that no longer exists. Capture then sets
  `inbox` when the Task type has it.
- **Views and automations** are those in `.atlas/views` and
  `.atlas/automations`. Only a query of tasks alone is rewritten — a project's
  `done` is not a task's — in place, by the value's span; a table view's
  `filters:` likewise. Picking a status (`=`, `is`) is carried over. Leaving
  one out (`!=`, `isNot`, `=` under `NOT`) is carried only when no other old
  status becomes the same one and no task already holds it, and a status
  nobody knew is never carried to the Inbox. Everything else that names an old status is listed instead: a
  query over tasks and another type, those comparisons, any other operator,
  any SQL view that reads `status`, and an automation that would set a status
  on mixed types, an unknown status, or Waiting. A dashboard's widgets are not
  read.
- **The GTD views** — Inbox, Next actions, Waiting, Someday and Longterm — are
  query views written into `.atlas/views` by the same run, never over a view
  of the same name.
- **The rules hold where every write ends up**, not at call sites: in
  `setNoteProperties` (every write of a note no pane holds — views, the type
  table, the API, automations' set and undo, the type editor's note
  migration), in `saveNote` (a pane's write), in `createNote` (every new
  note: capture, quick-add, "+" on a board or table, POST /v1/notes, a related
  note, a template) and in chat's proposals. `taskRuleChanges` judges the note
  a change leaves, so a type change that makes a Waiting note a task is
  refused too. A refusal is each path's own error: `invalid` from the API, the
  view's or pane's message in the app, a line in an automation's log. Not
  held, by design: Atlas's own files (types, settings), a chat's transcript,
  today's note, notes a source writes from outside data (ADR-0012), and the
  migration and its undo, which write recorded frontmatter.
- **Unticking after a restart reopens a task as Next Action.** What a task
  held before it was ticked is remembered for the session only. With nothing
  remembered, unticking — and a repeating task rolling on — puts it at Next
  Action, not the Inbox: it was something to do. Persisting the earlier
  status in a frontmatter key was rejected: every finished task would carry a
  key nobody asked for, which syncs and outlives its use.
- **The Inbox does not read every task on every open.** A quick look says
  yes — and the tasks are read — while the Task type is not yet GTD's, the
  record says its last run stopped partway or left files, a GTD view the move
  adds is missing, the index holds a task whose status is not one of the eight
  (or none), or a task is Waiting with nobody to wait on. It never says no
  while a preview has work, except for a status written as a one-item list,
  which the index flattens: the rules already read it as its item, and the
  next write of its status rewrites it.
