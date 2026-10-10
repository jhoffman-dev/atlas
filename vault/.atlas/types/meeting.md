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
  atlas_import_outcome:
    kind: select
    options: [imported, duplicate, error]
    label: Import
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

Each meeting file the import handles gets one line, `atlas_import_outcome`,
saying how it was settled — written into the file and nothing else changed
(P28-04). A file without it is an arrival the import has not finished yet:

- `imported` — it follows the contract, and is the meeting.
- `duplicate` — a second copy of a meeting the vault already has (same
  `provider` + `external_id`): `atlas_duplicate_of` links the first, and the
  copy is archived. Unarchiving it brings it back, and it is left alone.
- `error` — it breaks the contract: `atlas_import_error` says why, with line
  numbers, and the file stays where it landed and shows in the Inbox. Fix it
  and save: Atlas checks it again, takes the error out and stamps it
  `imported`.

A stamped file is never judged again, so editing, renaming or moving a
meeting never brings the import back to it.

## What Atlas fills in

`people`, `companies` and `project` are links, filled in when the meeting is
linked to the vault — attendees to People, and the likely project — or by
hand.

## The body

`## Summary`, `## Notes`, `## Provider next steps` and `## Transcript`, in
that order. The transcript is one block per speaker turn, each with a block id
so any line can be cited: `**Mara Quill** [~00:09:44] Fine by me. ^t0003`.
