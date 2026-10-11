---
name: decision
label: Decision
properties:
  title: text
  date: date
  meeting:
    kind: relation
    target: meeting
  project:
    kind: relation
    target: project
  people:
    kind: relation
    target: person
    many: true
  source:
    kind: text
    label: Cites
---

# Decision

Something decided — usually in a meeting — kept as its own note so a project or
a person's page can list the decisions about it (P29-02).

Decision is built in: accepting a decision proposal makes a note of it, so it
cannot be deleted. Its properties are yours to change.

`source` is the line it was decided on, as a block link into the meeting's
transcript: `[[2026-10-01 Standup#^t0003]]`.
