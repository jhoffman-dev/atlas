---
name: meeting
label: Meeting
icon: event
properties:
  title: text
  date: date
  start: text
  end: text
  kind: text
  provider: text
  external_id:
    kind: text
    label: Provider's id
  people:
    kind: relation
    target: person
    many: true
  companies:
    kind: relation
    target: company
    many: true
  project:
    kind: relation
    target: project
  atlas_import_error:
    kind: text
    label: Import error
  atlas_duplicate_of:
    kind: relation
    target: meeting
    label: Duplicate of
---

# Meeting

A meeting, written up by a notetaker (Google Meet's Notes by Gemini, Granola,
or whichever comes next) and brought into the vault under the meeting import
contract: `docs/contracts/meeting-import-v1.md` (ADR-0027). One note per
meeting, arriving in `Inbox/Meetings/`.

Meeting is built in: imported meetings are notes of it, so it cannot be
deleted. Its properties are yours to change.

## What the import writes

`title`, `date`, `start`, `end`, `kind`, `provider` and `external_id` come
from the notetaker, through the contract. `provider` + `external_id` is what
makes a second copy of the same meeting a duplicate.

`attendees` is in the file too, as a list of `{ name, email, group }` — a
group address (`platform-team@…`) is kept there with `group: true` and never
becomes a Person. It is not a property here, because no property kind holds a
list of records; `people` is the editable form of it.

## What the import writes

A meeting file that follows the contract is left exactly as it came. Two
keys are written only when something is wrong (P28-04):

- `atlas_import_error` — the file breaks the contract; it says why, with line
  numbers, and the file stays where it landed and shows in the Inbox. Fix the
  file and save it: Atlas checks it again and takes the key out.
- `atlas_duplicate_of` — a second copy of a meeting the vault already has
  (same `provider` + `external_id`); it links to the first, and the copy is
  archived. Unarchiving it brings it back, and it is left alone from then on.

## What Atlas fills in

`people`, `companies` and `project` are links, filled in when the meeting is
linked to the vault — attendees to People, and the likely project — or by
hand.

## The body

`## Summary`, `## Notes`, `## Provider next steps` and `## Transcript`, in
that order. The transcript is one block per speaker turn, each with a block id
so any line can be cited: `**Mara Quill** [~00:09:44] Fine by me. ^t0003`.
