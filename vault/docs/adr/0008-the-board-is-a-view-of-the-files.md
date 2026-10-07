---
type: adr
id: ADR-0008
title: The board is a view of the files, and lives in the app
status: accepted
date: 2026-09-21
---

# ADR-0008 — The board is a view of the files

## Context

This project has been tracked on a kanban since before it could open a file:
`tools/board.mjs`, a hundred lines of Node serving `vault/tasks/*.md` over HTTP.
It worked because it was small, and because the tasks were always markdown.

Phase 7 was meant to retire it. Retiring a tool that is in daily use is only
honest if the replacement does everything the tool did, and the board did two
things: it showed the cards, and it made new ones.

## Decision

The board is a saved view — `.atlas/views/Board.md` — with `layout: board` and
`groupBy: status`. Nothing about it is special: it is the same query engine as a
table, drawn as columns, grouped by a property.

Dropping a card writes the grouping property into that note's frontmatter.
Adding a card creates a note of the view's type already carrying the column it
was added to. Renaming a note was built in this phase too, because a card created
in the app would otherwise be stuck as "New task" — which would have made the
replacement worse than the thing it replaced.

`tools/board.mjs` is deleted.

## Consequences

- One less thing to run, and the board is in the vault rather than beside it.
- Columns follow the order the type declares its options in, so the board reads
  the way the workflow does. A status the type does not declare still gets a
  column: the file is the truth, and hiding a card would lose work.
- Quick capture is a step slower than the old form — add, then name. Phase 8
  brings a capture shortcut; until then, a task can still be written as a file.
- The dragged card is held in a ref rather than state. A drop handler reads what
  dragstart set, and a state update is only visible to a handler from a later
  render; when no render happens in between, the card silently does not move.
