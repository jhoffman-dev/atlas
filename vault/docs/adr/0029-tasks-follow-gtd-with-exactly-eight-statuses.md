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
