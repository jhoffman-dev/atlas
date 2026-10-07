---
atlas: view
type: task
layout: timeline
startKey: scheduled
endKey: due
columns: [scheduled, due, status, blocked_by, id]
filters: [{ key: status, operator: isNot, value: done }]
limit: 500
---

# Roadmap

The work still ahead, as bars. The chain picked out in red is the one that
decides the end date: shorten anything on it and the date moves, shorten
anything else and it does not.

Drag a bar to move that work — both dates shift together and are written into
the task's own file.
