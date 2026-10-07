---
atlas: dashboard
description: Every task on the Atlas board, by phase and status
widgets:
  - title: Tasks
    kind: hero
    type: task
    groupBy: phase
    progress:
      label: done
      filters: [{ key: status, operator: is, value: done }]
    span: 4
  - title: Work per phase
    kind: bar
    type: task
    groupBy: phase
    span: 8
  - title: By status
    kind: donut
    type: task
    groupBy: status
    span: 5
  - title: Largest phases
    kind: rank
    type: task
    groupBy: phase
    limit: 4
    span: 4
  - title: In flight
    kind: number
    type: task
    filters: [{ key: status, operator: is, value: doing }]
    icon: bolt
    span: 3
  - title: Waiting in backlog
    kind: number
    type: task
    filters: [{ key: status, operator: is, value: backlog }]
    icon: inbox
    span: 3
---

# Progress

This project's own dashboard, inside the app it is building. Every widget is a
query against the same index the board reads, so moving a card changes these
numbers without anything having to be told to refresh.
