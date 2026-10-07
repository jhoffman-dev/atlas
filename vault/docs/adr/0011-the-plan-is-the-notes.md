---
type: adr
status: accepted
date: 2026-09-20
---

# The plan is the notes

## Context

A Gantt chart usually comes with a project file: a separate store holding tasks,
durations, dependencies and a schedule, which the notes then link out to. That
store is where the plan lives, and it is the thing you lose when the tool goes
away.

Atlas already had the pieces of a plan scattered across the vault. A task note
has a `scheduled` date, a `due` date, and a `blocked_by` list naming the work it
waits for — written that way because that is how a person writes it, long before
anything drew a chart.

## Decision

A timeline is a layout, like a board or a calendar
([ADR-0009](0009-a-layout-is-a-property-of-the-view.md)). It reads `startKey` and
`endKey` off the view and draws the notes the query already returned. There is no
project file.

Three rules follow from the notes rather than from a scheduler:

- **A note with one date is a milestone.** "Ship on the 14th" is a real thing to
  put on a plan, and dropping it for want of a second date would lose it
  silently.
- **Dependencies are names, not links.** `blocked_by: [P11-02]` matches a task's
  `id`. A name that matches nothing is reported rather than treated as work that
  takes no time.
- **The critical path is computed, never stored.** It is the longest chain of
  blocking work by days — the run that decides the end date. Circular
  dependencies have no longest chain, so that is reported too instead of being
  answered arbitrarily.

Dragging a bar writes both dates back into the task's own file, as one edit.

## Consequences

- A plan is greppable, diffable and editable in any editor, like everything else
  in the vault. Deleting Atlas leaves the plan behind.
- Nothing has to be kept in step: the chart is derived from the notes every time
  it is drawn, so a date changed in a file, in a table or on the board is a date
  changed on the roadmap.
- Scheduling is not automatic. Atlas will not move a task because its blocker
  slipped; it will show you that the chain is now longer than the plan. Doing
  that arithmetic _for_ you means owning the schedule, and then the notes stop
  being the source of truth.
- Durations are calendar days, not working days. A plan that has to skip weekends
  will need this revisited.
