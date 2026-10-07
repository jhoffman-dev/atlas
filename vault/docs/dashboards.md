---
type: doc
---

# Dashboards

A dashboard is a note marked `atlas: dashboard` in `.atlas/dashboards/`. New ones
are made from `.atlas/templates/Dashboard.md`, whose body is only what a new
dashboard starts with; this is the reference it used to carry.

**Customize**, beside the title, arranges the dashboard: drag a widget by its
grip to move it, drag its right edge to make it wider or narrower on the
twelve-column grid, and add one from the card at the end. From the keyboard,
Space on a grip picks the widget up, the arrows move it, Shift with Left and
Right resizes it, Space drops it and Escape puts it back. Cmd+Z undoes the last
change while arranging. Every widget's "…" menu edits or removes it, in a sheet
that previews the widget as you change it.

The order of `widgets:` is the order on the grid, and resizing writes `span`.
Only the widget you changed is rewritten; the others keep their text, and keys
a widget does not read are kept through an edit.

Each entry under `widgets:` is a query and a `kind` saying how to draw it. They
take the same `type`, `filters`, `sorts`, `columns` and `limit` a saved view
takes, and sit on a twelve-column grid.

| `kind`   | Draws                                                       | Needs     |
| -------- | ----------------------------------------------------------- | --------- |
| `number` | One number on a small tile (`aggregate`, `of`, `icon`)      |           |
| `hero`   | The navy lead card: total, progress ring, sparkline         |           |
| `bar`    | Upright bars, one called out                                | `groupBy` |
| `donut`  | A ring with a legend of shares; a select lists every option | `groupBy` |
| `line`   | A smooth line along the keys                                | `groupBy` |
| `rank`   | The largest groups, with how much of the whole they hold    | `groupBy` |
| `list`   | Links to the matching notes                                 |           |
| `table`  | The matching notes, one column per `columns` entry          |           |

Every widget also takes:

- `span` — grid columns, 1 to 12. Defaults: `number` 3, `hero` and `rank` 4,
  everything else 6. The older `width: 1 | 2 | 3` still reads as thirds.
- `highlight` (`bar`, `rank`, `hero`) — which group is called out: `last` (the
  last key), `max` (the largest), `none`, or a value such as `15`. Left out, a
  numeric grouping such as a phase calls out its last key and anything else its
  largest group.

A number key groups in number order — 2 before 10 — and notes with no value are
kept off a bar chart's axis and counted beside its title ("7 without a phase").

A `hero` takes an optional `groupBy` for its sparkline and footer, and an
optional `progress` for its ring — filters that narrow its own query:

```yaml
- title: Tasks
  kind: hero
  type: task
  groupBy: phase
  progress:
    label: done # optional; `status is done` is already read as "done"
    filters: [{ key: status, operator: is, value: done }]
```

A `rank` shows its `limit` largest groups — 5 unless told, at most 20. A
`number` tile's `icon` is one of `bolt`, `inbox`, `check`, `chart`, `hash`,
`star` or `task`.

The SQL behind any widget is in its "…" menu.
