---
type: adr
id: ADR-0007
title: A view is SQL, and you can read the SQL
status: accepted
date: 2026-09-21
---

# ADR-0007 — A view is SQL, and you can read the SQL

## Context

Notion's databases are limited by their formula language: simple things are easy
and anything else is impossible. The point of this project was to put SQL there
instead. That raises three problems worth deciding once.

Properties are stored as rows — path, key, value — because a note can have any
shape. Nobody wants to write the join that turns that back into columns.

A query has to come from somewhere. Filter and sort controls are what people use
day to day, but controls always run out, and an escape hatch that is a different
language from the controls is not an escape hatch.

And a query is text arriving from a file, so it must not be able to change
anything.

## Decision

**A SQL view per type.** `v_company` has one column per declared property,
pivoted out of the property table and typed by the property's kind — numbers from
`value_num`, dates from `value_date`. A property holding several values becomes a
comma-separated cell. The views are rebuilt whenever a type definition changes,
so adding a property makes a column appear.

**Controls compile to SQL, and the SQL is on screen.** Filters and sorts are data
in the view's frontmatter; one function turns them into a parameterised statement;
the table shows exactly what it ran. Values are always bound. Names cannot be
bound, so anything that is not a plain identifier is refused rather than escaped —
in TypeScript, and again in Rust.

**Queries run on a second connection opened read-only.** Not a statement
inspection, not a list of forbidden words: SQLite refuses the write because of how
the connection was opened. A row cap and a step budget stop a runaway query.

## Consequences

- A view is an ordinary note. It can be written by hand, kept in version control,
  and edited anywhere — and it shows up in the tree with everything else.
- Editing a cell writes that note's frontmatter. The index is never the thing being
  edited; it catches up because the file changed.
- Sorting a column edits the view note, because the view _is_ the note.
- A view's `type:` names what the view lists, not what the view is. A saved view
  therefore shows no properties panel of its own.
- The SQL escape hatch is the same SQL the controls produce, so moving from one to
  the other costs nothing.
