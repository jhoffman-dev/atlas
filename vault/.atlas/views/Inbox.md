---
atlas: view
type: task
layout: list
columns: [status, source]
filters:
  - key: status
    operator: is
    value: backlog
sorts:
  - key: title
    direction: asc
limit: 200
---

# Inbox

What has arrived and not been picked up. Captured tasks land here — Shift+Cmd+N
from anywhere in the app.
