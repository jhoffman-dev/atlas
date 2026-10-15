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
2. **Archive is a value for PARA notes.** `para: archive` puts a Project note
   out of the way where it stands: it leaves views over projects (unless
   archived notes are asked for), query blocks over projects, relation
   pickers, a board's project groups, the sidebar's Project count and the
   weekly review's projects. Setting `para` back brings it back. The page
   menu's Archive and Unarchive on a Project note set the value (Unarchive
   sets `project`); the file does not move. Every other note keeps the file
   move of U-22.
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
   gets `type: project` and `para`, or `para: archive` alone, through the
   byte-preserving frontmatter write, with the host's refusal to write over a
   file changed since it was read; a note with unsaved typing is left and
   said so. No file moves, no property the person added is removed, and a
   second run finds nothing to do. The run is one line in Activity, plus one
   per note left as it was. The Project type gains PARA in the same run when
   it lacks it.
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
  property change with no file move and no broken links.
- "Archived" now has two meanings. The Archive folder still holds every
  non-PARA note put away, and is what search, the graph, `[[` suggestions
  and the Archive page read; a Project set to `archive` is out of views,
  pickers, counts and the weekly review, but is still found by search and
  shown on the graph, and is not listed on the Archive page. A follow-up can
  widen what reads `para`, rule by rule.
- A Project note already in `Archive/` is still unarchived by moving it out
  (its menu says Unarchive); once out, its `para: archive` keeps it out of
  the way until set back.
- Unarchive sets `project`, not the value the note had before it was
  archived: nothing records that value, and adding a key for it would write
  more than the person asked for.
- The ⌘K palette's Archive and a Pages row's Archive still move the file,
  for a Project note as for any other; the page menu is the PARA control.
- A project's or an area's linked page still decides its sections by its
  type: an area that is a Project note shows a project's sections.
- The weekly review's Archive on a stalled project moves the file.
- The local API and MCP are unchanged by this record (ADR-0016): a client
  sets `para` like any property. Whether they get an archive-by-value route
  is for their keeper.
