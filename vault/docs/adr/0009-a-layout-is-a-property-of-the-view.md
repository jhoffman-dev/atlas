---
type: adr
id: ADR-0009
title: A layout is a property of the view, not a different kind of thing
status: accepted
date: 2026-09-21
---

# ADR-0009 — A layout is a property of the view

## Context

Notion has databases, and a database has views: table, board, calendar, gallery.
The obvious way to build that is a component per kind, each with its own data
loading, its own filters and its own idea of what a row is. That is how they end
up behaving differently for no reason a user could explain.

## Decision

There is one query and one saved view. `layout:` says how to draw the results;
`groupBy:` and `dateKey:` say what a board and a calendar need to know. Nothing
else differs — the same SQL, the same rows, the same edits writing to the same
files.

A layout that cannot work falls back rather than showing something broken: a
board with nothing to group by, or a calendar with no date to place notes on,
draws as a table.

## Consequences

- Changing a view from a table to a board is one line in its frontmatter.
- Everything that works in one layout works in the others: an edit in a table
  cell, a card dropped in a column and an entry dragged to another day all take
  the same path and write frontmatter the same way.
- Layouts that need more than the query gives them — a week view with times, a
  gantt with dependencies — will need more than a `layout:` value. Phase 11 will
  say what.
- A note the layout cannot place is counted, not hidden. The calendar says how
  many notes have no date rather than quietly leaving them out.
- (P17-05) Every view has a Layout menu in its toolbar. Choosing a layout
  writes `layout:` into the view note — with `groupBy:`, `dateKey:` or
  `startKey:` when the view does not name one yet — and a layout the type
  cannot draw is listed, disabled, with what it needs. `feed` joined the
  layouts: the same query, newest first (by the file's modified time, which
  the index's type views now carry) unless the view sorts, with each note's
  body read from its file in capped batches, since the index keeps only words.
