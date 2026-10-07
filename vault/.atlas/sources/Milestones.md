---
atlas: source
format: ics
file: feeds/milestones.ics
into: Calendar
type: event
key: uid
name: summary
body: description
map:
  dtstart: date
  dtend: ends
interval: 0
---

# Milestones

This project's own dates, kept in an iCalendar file and read into `Calendar/` as
ordinary notes. Swap `file:` for a `url:` and it becomes a subscription to
someone else's calendar instead; nothing downstream changes, because what lands
is markdown either way.

Press **Refresh** to read it. The folder it writes into has to exist first —
creating a note never creates a folder, which is the guard that stops a path
escaping the vault.
