---
atlas: view
type: task
layout: list
columns: [due, status, phase]
filters:
  - key: due
    operator: lessThan
    value: '@tomorrow'
  - key: status
    operator: isNot
    value: done
sorts:
  - key: due
    direction: asc
limit: 100
---

# Today

Anything due today or already overdue, and not finished. `@tomorrow` is worked
out when the view runs, so this stays true tomorrow.
