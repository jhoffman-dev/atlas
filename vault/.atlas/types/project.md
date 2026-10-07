---
name: project
label: Project
icon: board
properties:
  status:
    kind: select
    options: [planned, active, paused, done]
  owner:
    kind: relation
    target: person
  due: date
  description:
    kind: text
    label: Summary
  project_tasks:
    kind: relation
    label: Tasks
    target: task
    many: true
---

# Project

A body of work that tasks belong to. A task's `project` points at one, so a
board can be grouped by project and a view filtered to one.
