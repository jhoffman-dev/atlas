---
type: adr
id: ADR-0023
title: A type owns its views, and each view keeps its own place
status: accepted
date: 2026-10-04
---

# ADR-0023 — A type owns its views, and each view keeps its own place

## Context

Issue #11. Types and views were two separate things in the sidebar. Clicking a
type opened a generated table of its notes and nothing else; its saved views
were only reachable by name, from the Views section. James: "I should just
click on a type and see the views and be able to edit / delete / add views",
and "I need a way to drag and reorder the view tabs."

A view already said which type it lists (`type:`, ADR-0007), and a view's page
already showed the other views of that type as tabs, ordered by layout and then
name. What was missing was the type being the way in, the tabs being able to
change anything, and an order a person chooses.

## Decision

**A view belongs to the type its `type:` names, and a type's page is its views.**
Clicking a type opens one of its views in the focused pane: the one last open
for that type on this Mac, else its first tab. That pane _is_ the type's page —
the sidebar marks the type, and the tabs are the type's views. Opening a view
any other way (a link, search, the Views section) lands on the same page with
that tab selected, because it is the same page. Nothing about a view's file
changes for this; the rule is `typeViews`/`landingView` in the domain.

**A type with no views shows a default table that is virtual until the tabs
change.** It is the generated table ADR-0013 describes (every declared column,
sorted by title), shown under one tab named for the file it would become —
"Task table". It becomes a file the moment the tabs are changed: a view added
beside it (so adding a board does not take the table away), or it renamed or
copied. It cannot be deleted, because there is nothing to delete. Writing it on
first open was rejected: a click that only looks should not write to a synced
vault, and a generated table keeps ADR-0013's promise that a new property is a
new column.

**A view's place is an `order:` number in its own frontmatter.** Placed views
read first by `order`; a view with none — every view written before this, or by
hand — reads after them, in the old layout-then-name order. So a vault nobody
has reordered looks exactly as it did, and no file is rewritten until someone
changes the tabs.

Rejected: an ordered list in the type file, or in `.atlas/settings.md`. One
list means one file every reorder on every machine writes — a sync conflict
waiting to happen — and a list of names that a rename, a hand-deleted view or a
view whose `type:` changed silently leaves stale. With the order in each view,
a reorder on two machines touches different files, a view carries its place
when it is copied elsewhere, and there is nothing to keep in step.

A move writes the moved view alone wherever it can (`movedViewOrder`): one
less than the first tab to go first, one more than the last placed tab to go
last, and between two tabs a whole number between them if there is one, else
halfway. Only when a tab lands after views nobody placed are those placed —
the ones before it, not the ones after — and only when two neighbours share an
order, or the numbers are too large for a float to step past (2^53 and up,
hand-written), are the tabs renumbered from one. Adding a tab writes that one
file.

**Renaming a tab writes `title:`, not the file name.** Users never have to know
what a view's file is called, a rename cannot collide with another file, and
links to the view keep working. Views made from the tabs are named for the type
and layout ("Task board", "Task board 2"); copies for what they copy. Renaming
the default table writes it under the name typed, kept as typed — the same as
renaming a written tab — so "Q1/Q2", a name over a disk's 255 bytes, or one
already taken is the title, and the file takes the nearest name a disk holds:
a dash for each character no disk accepts, no leading dot, cut by whole
characters to fit, numbered past what is taken.

**A copy is the whole file.** Duplicating a tab copies the view's file byte for
byte (ADR-0003) — comments, flow-style settings, the words under them, its line
endings — and changes only its title, favourite star and place.

**Deleting a tab goes through the app's usual question**, to the Trash, and the
page lands on the next tab (else the previous; the default table when it was
the last).

**Views not owned by one type stay where they were.** A query view (ADR-0019),
a SQL view and a dashboard have no single type: they keep their own pages and
the Views and Dashboards sections, and a query view's tabs remain the shelf of
saved queries, which cannot be reordered. A type's own page (its definition,
and its default table) is still `openType`; Back to it shows the type's views
as tabs, none selected, over the table.

## Consequences

- Every rule — which views a type owns, their order, where a click lands, what
  a move writes, the default view and its name — is in
  `packages/domain/src/sidebar/type-views.ts`; the writes are use-cases in
  `packages/application/src/query/type-views.ts`. The tabs only ask.
- The last tab per type is remembered in `localStorage` (per Mac, like a folded
  group), never in the vault: where this screen was is not a fact about the views.
- Edit type moves from a click on the type to a gear at the end of the type's
  tabs, the type's menu in the sidebar (right-click, or Shift+F10), and "Edit
  Task type" in the search palette, since a type with views no longer opens on
  its definition.
- The tabs show a move at once and hold that order until the files are read
  again; the app writes one tab change at a time, each against the tabs as
  shown, so a second move or "+" made before the index catches up is asked of
  the views as they now are.
- The index's sidebar query now carries `order` and `title`, so a view kept
  outside `.atlas` sorts and is named the same as one inside it.
- The API and MCP can already read a view's frontmatter; listing a type's views
  in order and moving them is follow-up work for the API/MCP keeper.
