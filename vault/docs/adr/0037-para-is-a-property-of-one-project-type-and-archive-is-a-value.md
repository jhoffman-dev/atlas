---
type: adr
id: ADR-0037
title: PARA is a property of one Project type, and archiving a PARA note is a value
status: proposed
date: 2026-10-14
---

# ADR-0037 — PARA is a property of one Project type, and archiving a PARA note is a value

## Context

The maintainer's request (#213): "After I create a new project in the app,
how do I add it to PARA? It looks like I have to create an area, project, or
resource specifically instead of creating a project and then just [setting]
what PARA type it is in a property, which then makes it easy to move to
archive or take something back out of archive."

What was true before this record:

- **Project, Area and Resource were three built-in types** (P30-01, #20).
  Moving a note between them meant changing its `type`. A vault with a
  Project type had Area and Resource written in when it opened, and neither
  could be deleted.
- **Archive was a file move** to `Archive/<path>` (U-22), stamped
  `archived` and `archivedFrom`. Taking a project out of the Archive and back
  moved its file twice.
- **The guide said a project has "the area it's part of"**, and the Project
  type Atlas wrote had an `area` relation to the Area type, but a vault whose
  Project type predates it has none, and nothing offered it.
- **Relations and pickers** pointing at `[project, area]` listed notes of
  both types, under a Project and an Area heading.

## Decision

1. **One type, one property.** The built-in Project type carries `para`, a
   select labelled **PARA** with the values `project`, `area`, `resource` and
   `archive`. A new project starts as `project`; a Project note with no
   `para`, or one Atlas cannot read, is read as `project`. The rules are in
   the domain (`para-value.ts`).
2. **Archive is a value for PARA notes, and every Archive agrees.** `para:
archive` puts a Project note out of the way where it stands: it leaves
   views over projects (unless archived notes are asked for), query blocks
   over projects, relation pickers, a board's project groups, the sidebar's
   Project count, the weekly review's projects, the open projects a meeting
   is linked to, and what Inbox notes may be filed under; the Archive page
   lists it. Setting `para` back brings it back. Every Archive in the app —
   page menu, ⌘K palette, a Pages row, a view's selection, the weekly review
   — goes through one use case (`archiveNotesWithPara`): a PARA note — a
   Project, or a note of the old Area or Resource type — is archived by its
   value and the file does not move; every other note keeps the file move of
   U-22.
   - **Archiving keeps what PARA was** in `para_before_archive` (written and
     cleared by Atlas, never required). **Unarchive gives it back** —
     `project` when nothing readable was kept — and takes the key off.
   - **Unarchive is one step** whatever archived the note: a note in
     `Archive/` is moved out, and a Project's `para` is restored in the same
     write that takes the stamp off.
   - **An old Area or Resource note becomes a Project when archived**
     (`type: project`, `para: archive`, `para_before_archive: area`), the
     one-note form of decision 5: `archive` only means something on the
     Project type. In a vault with no Project type it is moved instead.
   - **A `para` that is the person's own** — none of the four values, or a
     list or a map — is never written over: that note is archived by moving
     it, and the move onto the Project type leaves it as it is.
3. **A project may belong to an area.** Project has an optional `area`
   relation whose target is `area`. Nothing becomes required.
4. **PARA targets resolve to the Project type.** A relation target of
   `project`, `area` or `resource` names a PARA value: the picker offers the
   Project notes whose `para` it names — grouped Projects, Areas, Resources —
   and never an archived one. A task's Project (`[project, area]`) therefore
   lists projects and areas and no resources. A link to a Project note is
   never called the wrong type by such a relation. "New area…" makes a
   Project note with `para: area` when the Project type declares PARA.
   Notes of the Area and Resource types a vault still has are offered as the
   value their type names.
5. **The change to existing notes is offered, never done.** On the Inbox
   page, beside the existing type offer, a box lists every Area and Resource
   note — and every Project note in `Archive/` without `para: archive` — and
   what it becomes. Nothing is written until **Move N notes**. Each note
   gets `type: project` and `para`, or `para: archive` alone; one archived
   (in `Archive/`, or an old Area/Resource note with `para: archive`) also
   gets `para_before_archive` naming what it was, so its kind survives
   Unarchive. A note holding a `para` of the person's own is listed as left
   as it is, with why, and never written. **What the preview showed is what
   is written:** the preview keeps each note as it read it, and the run
   writes that note only if the file still reads the same, through the
   byte-preserving frontmatter write and the host's refusal to write over a
   file changed since the preview read it; a changed note, or one with
   unsaved typing, is left and said so. No file moves, no property the
   person added is removed, and a second run finds nothing to do — nor does
   a run after notes were archived by their value. The run is one line in
   Activity, plus one per note left as it was. The Project type gains PARA
   in the same run when it lacks it.
6. **Area and Resource stop being Atlas's types.** They are no longer
   written into a vault, offered, or refused deletion. A vault's existing
   type files stay until the person removes them. The Project type's own
   `para` and `area` are offered on the Inbox like any other change to the
   vault's types (P30-01's offer); nothing is written to a type without a
   yes.

This supersedes, from P30-01: Area and Resource as built-in types, and
writing them into a vault that has a Project type. It amends U-22: a PARA
note is archived by its value, not by a move.

## Consequences

- Moving a project to an area, a resource or the Archive, and back, is one
  property change with no file move and no broken links — and back to the
  value it had, not to `project`.
- "Archived" now has two meanings. The Archive folder still holds every
  non-PARA note put away, and is what search, the graph and `[[`
  suggestions read; a Project set to `archive` is out of views, pickers,
  counts, the weekly review, meeting links and Inbox filing, and is listed on
  the Archive page, but is still found by search and shown on the graph. A
  follow-up can widen what reads `para`, rule by rule.
- `para_before_archive` is one more key Atlas writes into a person's note.
  It is only ever written alongside `para: archive` and taken off on
  Unarchive, and nothing requires it.
- The ⌘K palette and a Pages row offer Unarchive only for a note in the
  Archive folder: they do not read a note's properties, so a Project archived
  where it stands is brought back from its page menu or the Archive page.
  Their Archive on such a note says it is already archived.
- Archiving an old Area or Resource note changes its `type`, which the
  person did not ask for in so many words; it is the move they would be
  offered anyway, for that note only, and it is what keeps the note's kind.
- A project's or an area's linked page still decides its sections by its
  type: an area that is a Project note shows a project's sections.
- The local API and MCP, and an automation's Archive, still move the file
  (ADR-0016): a client sets `para` like any property. An automation's undo is
  recorded as file moves, so it keeps them. Whether they get an
  archive-by-value route is for their keeper.
