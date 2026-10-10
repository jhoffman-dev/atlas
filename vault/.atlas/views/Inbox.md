---
atlas: view
layout: list
query: |-
  FROM task, meeting
  WHERE status = inbox OR path STARTS WITH 'Inbox/' OR atlas_import_error IS NOT EMPTY
  SORT BY title
  SHOW status, source, atlas_import_error
  LIMIT 200
---

# Inbox

What has arrived and not been picked up. Captured tasks land here — Shift+Cmd+N
from anywhere in the app — and so do meetings: each one n8n commits into
`Inbox/Meetings/` shows here until it is filed, and a meeting file that breaks
the import contract shows here, wherever it is, with its import error beside
it. A second copy of a meeting is archived instead.
