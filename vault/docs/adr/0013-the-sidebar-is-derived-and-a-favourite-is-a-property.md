---
type: adr
status: accepted
date: 2026-09-21
---

# The sidebar is derived, and a favourite is a property

## Context

Atlas had one flat file tree. Everything the app could do — types, saved views,
dashboards — lived inside `.atlas`, findable only if you already knew the folder
layout. The app did considerably more than its sidebar admitted.

The obvious fix is a navigation model: a stored tree of sections with the views
and dashboards listed in it, and a favourites list beside it. That is how most
apps do it, and it is a second source of truth for things the vault already
knows.

## Decision

**Five sections — Favorites, Types, Views, Dashboards, User space — and every
one of them derived.**

Types come from the type definitions. Views are notes with `atlas: view`,
dashboards notes with `atlas: dashboard`, found through the same domain
predicates the rest of the app uses rather than by matching folder names. So a
view written by hand, anywhere in the vault, appears; and there is no list that
can drift out of step with what is on disk.

**A favourite is `favorite: true` in the note's frontmatter.** Not a row in the
index, not a file of app state. The same reasoning as a view being a note: it
diffs, it survives, it travels with the vault, and it is still there without
Atlas. Starring is an ordinary property write through the same use-case that
edits any other property.

**User space is the vault minus what another section already lists** — which is
`.atlas/views` and `.atlas/dashboards`, and nothing else. A subfolder no section
has claimed stays visible.

## Consequences

- Nothing has to be kept in step. Write a view in a text editor and it is in the
  sidebar; delete one and it is gone.
- Favourites are portable and greppable, and survive Atlas being uninstalled.
- **Five disclosures rather than one `role="tree"`**, which was decided by
  accessibility rather than taste: inside a tree, a star button nested in a tree
  item is folded into that item's accessible name, so the star and the section
  headings fight. As five sections nothing is bent. The cost is that arrow keys
  do not sweep across section boundaries — and the tree still has no roving
  tabindex at all, which predates this work and is tracked as P13-10.
- Only user space is virtualised. The other four are tens of rows; making every
  section pay the virtualiser's cost for one section's benefit is a bad trade,
  and it keeps the 2,000-note guarantee in the component that already had it.
- **The first draft of the rule was wrong and hid ten notes.** It said `.atlas`
  "is the other four sections", which is false — `.atlas` also holds the type
  definitions, the templates, the sources and `settings.md`. Hiding the whole
  folder left those with nowhere to be clicked. The rule now names what is
  hidden rather than assuming, and a new subfolder stays visible by default:
  a note you can reach and did not expect beats a note you cannot reach at all.
- A type row opens a **generated** table of that type's notes, built from the
  type rather than saved as a view note — so adding a property adds a column,
  with no second artefact. Sorting it lasts only while it is open; writing an
  order down is what a saved view is for.

## Addendum, 2026-10-04: a shut section keeps its place

The sections can be put in any order (P19-01), and until now a shut section
was gathered below the open ones (P19-02), so what was open stayed at the top.
That was right while each section scrolled on its own.

**Since issue #17 every section shares one scroller**, and Pages is as tall as
the vault. Below the open ones is then below every row of the tree: a heading
shut above Pages vanished from under the pointer that shut it, and getting it
back meant scrolling past the whole vault.

So **a section keeps the user's order whether it is open or shut.** Shutting or
opening one changes only its height; nothing moves past it, so nothing slides.
Moves are made in that one order, with no group for a section to be kept
inside. The rule is the domain's (`section-order.ts`), and the UI only draws it.
