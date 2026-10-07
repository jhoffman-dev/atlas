---
name: event
label: Event
properties:
  date: date
  ends: date
  atlas_source: text
  atlas_source_key: text
  atlas_source_missing: checkbox
---

# Event

Something with a date on it, usually written by a datasource rather than by hand.
`atlas_source` names the source note that produced it, `atlas_source_key` the
record it came from, and `atlas_source_missing` marks one whose record has left
the feed — a mark the next refresh takes off again if the record comes back.
