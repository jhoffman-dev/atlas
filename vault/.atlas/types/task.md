---
name: task
label: Task
properties:
  status:
    kind: select
    options: [backlog, next, doing, review, done]
    done: done
    required: true
  phase: number
  estimate: text
  id: text
  blocked_by:
    kind: text
    many: true
  source: text
  due: date
  scheduled: date
  recurrence: text
  project:
    kind: relation
    target: project
---

# Task

The type this project's own board uses. Every file in `vault/tasks` declares it,
so the properties panel edits the board directly.

## Done option

`done: <option>` on a single-choice property names the option that means
finished. Every layout draws a checkbox beside a note of this type; ticking it
sets that property to the done option, and unticking puts back what it held
before (or the first option, when the app has not seen it ticked this
session). A type without a `done:` still gets checkboxes when one of its
single-choice properties has an option named `done` or `complete` — the first
such property is used. The type editor sets it as "Done option".
