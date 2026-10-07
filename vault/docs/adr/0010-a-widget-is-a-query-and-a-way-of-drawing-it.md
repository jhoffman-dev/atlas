---
type: adr
status: accepted
date: 2026-09-20
---

# A widget is a query and a way of drawing it

## Context

Dashboards need numbers, lists, tables and charts that stay current. The obvious
shape is a widget system: each kind of tile with its own idea of where its data
comes from, its own configuration and its own code path to the database.

We already had a query engine — the one saved views use — and
[ADR-0009](0009-a-layout-is-a-property-of-the-view.md) had already established
that a layout is a property of a view rather than a separate kind of thing.

## Decision

A widget is a saved-view query plus a `kind` saying how to draw it. Nothing about
a widget reaches the database on its own.

Where a widget needs something a table does not — one number, or one row per
group — it asks the same compiler for a different _shape_:

```ts
compileViewQuery(query, { aggregate: { kind: 'sum', column: 'estimate' } });
compileViewQuery(query, { groupBy: 'status' });
```

The shape is data, not SQL text. The caller never hands the compiler a fragment
to splice in, so every column and table name goes on being checked by the one
function that has always checked them, and every value goes on being bound.

A dashboard is an ordinary note: `atlas: dashboard` in its frontmatter and a
`widgets:` list under it. It can be written by hand, kept in version control and
opened in any editor, exactly like a view.

## Consequences

- One query engine, four pictures of it. A filter improvement reaches charts and
  tables on the same day it reaches the board.
- The SQL behind every widget can still be read, which is the reason for building
  on SQL rather than formulas in the first place.
- A widget that cannot be read is dropped and a widget that fails is reported in
  its own tile, so one bad line costs a tile rather than the page.
- Dashboards are live for free: they re-run when the index moves, and the index
  moves whenever a file does. Nothing has to tell a dashboard to refresh.
- The aggregates are the five SQL has: count, sum, average, earliest, latest.
  Anything beyond them — a ratio, a running total — will need this decision
  revisited, most likely by letting a widget carry its own SQL.

## Addendum, 2026-09-22 (P16-05)

The `hero` widget needed one ratio — done of all — and got it without SQL of
its own: it asks the same compiler the same query three times (a count, a count
narrowed by its `progress` filters, a grouping) and the application divides.
The ratio is still two counts anyone can read in the "…" menu, so the decision
above stands. The `rank` widget and the bar chart's called-out bar, numeric key
order and "N without a phase" are rules over the grouped rows, in
`packages/domain/src/dashboard/groups.ts`, not SQL.

A dashboard written with neither `width` nor `span` on a widget now takes the
new default spans on the twelve-column grid — a number a quarter of the page, a
hero or a ranking a third, anything else half — so such a dashboard is laid out
differently from before P16-05. One with `width` keeps its layout (`width` still
reads as thirds); one with `span` gets exactly that.
