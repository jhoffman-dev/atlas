---
type: adr
id: ADR-0030
title: Timeblocks sync two ways with one dedicated Google calendar
status: proposed
date: 2026-10-07
---

# ADR-0030 — Timeblocks sync two ways with one dedicated Google calendar

## Context

James timeblocks: a block on the calendar that small tasks are pushed into,
or one big task placed on the calendar itself, and a task split across
several blocks. Blocks must show on his real Google Calendar as busy, so
colleagues see them. Atlas reads ICS today (Phase 12) and writes nothing to
any calendar.

## Decision

**A `block` is a note** (`type: block`, `start`, `end`, `tasks` relation
many). It syncs to **one dedicated Google calendar** ("Atlas blocks"), made
by Atlas, as **busy** events whose title is the block's title. Atlas never
writes to any other calendar and never reads event bodies it did not write.

**OAuth lives in the host.** A desktop OAuth flow (loopback redirect, PKCE)
with the `calendar.events` scope on that calendar only where possible; the
refresh token is a Keychain secret (ADR-0017) bound to
`https://www.googleapis.com`. The webview never sees it.

**Identity is the event id, stored on the block** (`gcal_event_id`,
`gcal_etag`). Reconcile runs on a schedule and after each block write:
Atlas-side changes push; Google-side time changes pull into the block; a
change on both sides since the last sync keeps Google's time and records the
conflict in Activity. An event deleted in Google marks the block
`gcal_missing: true` (ADR-0012 style), never deletes the note. Sync is
incremental (`syncToken`), so a reconcile is one cheap request.

## Consequences

- One more secret and one more outbound site; the host's binding rules apply.
- Works with the Mac awake only; blocks made on another Mac sync from the
  automations Mac.
- Google Workspace admin policy may forbid a third-party OAuth client on a
  work account — an open question to check before building.

## As built (P31-01, 2026-10-08)

The block model and its scheduling rules, which sync builds on:

- **The Block type** has `start` and `end` (dates with a time, both
  required), `tasks` (a relation to tasks, many) and `gcal_event_id` and
  `gcal_etag`. It is built in — it cannot be deleted — and is written into a
  vault once its tasks follow GTD (its Task type's status is the eight), as it
  opens or as soon as the move to GTD lands, never over one that is there,
  and said in Activity. A vault on statuses of its own is left as it is:
  writing a type into every vault with tasks changed what small vaults show
  first (the dashboard sheet's first type) for no use. Undoing the move to GTD
  leaves the Block type, which the move did not write. A write is never
  cancelled by the types being read again: what it did is said once, a
  failure only when every write for the vault has settled and none landed,
  and a vault is tried once until it is opened again. `gcal_missing` comes
  with sync (P31-04).
- **A one-task block gives that task its whole length.** A block of several
  is a container: when its tasks need at least the whole block it is shared
  in proportion to what each has left of its estimate; when they need less,
  each gets what it has left and the rest is shared equally among the tasks
  with no estimate, or stays free. "What it has left" is its estimate, or
  nothing once finished — not its estimate less time scheduled elsewhere,
  which would make one block's shares depend on every other block. Shares are
  whole minutes that add up to the block, the odd minute to the largest
  remainder, then the earliest listed — worked in exact integers, a
  remainder being `length × weight mod sum`, so equal remainders are equal
  however large the estimates. An estimate longer than a hundred years is
  read as none.
- **Blocks count on their own.** A task in two blocks that overlap is given
  both, and so reads as over-scheduled, rather than merged into less than was
  set aside. Past blocks count as well as future ones: no rule reads the
  clock.
- **A block is its wall-clock length as written**, as the calendar draws it:
  a block across midnight runs into the next day, and one across a
  daylight-saving change is as long as the clock says (01:30–03:30 is two
  hours on the night the clocks go forward). Nothing converts between zones,
  so the answer is the same on every Mac. A block without a time at both ends,
  or ending no later than it starts, gives nothing; it is not refused, since
  sync may pull such an event from Google.
- **For P31-04: blocks hold local wall-clock times, with no offset.** `start`
  and `end` are written `2026-10-12T09:00`, read as the time where the person
  is. A zone or offset written after the time (`…T09:00Z`, `…T09:00+02:00`) is
  currently ignored, as the calendar ignores it (`readEventTime`), so it is
  read as the same clock time. Sync must therefore convert Google's RFC 3339
  times to local wall-clock before writing a block, and convert the block's
  local times to RFC 3339 with the Mac's zone before pushing — never copy an
  offset into the note.
- **A task shows estimate, scheduled and done** under its properties, and
  how far it is over. Done comes from the status the Task type is ticked with
  (`archive` for GTD): all of the estimate once finished, none before.
  **Follow-up:** checklist progress (P30-03, #22, built on a sibling branch)
  is not read yet. Once it lands, done for an open task should be its
  estimate × the share of its checklist ticked, and a container's "what it
  has left" should follow. An estimate is minutes; `2h` and
  `1h30m` are read too, for a vault that kept a text estimate, but a day or a
  week is not — a day's working minutes are the person's to say.
- **No write rule is added.** Scheduling is read from blocks, never stored on
  a task, so the write chokepoints (ADR-0029) are unchanged.
- **Read from the index**: the tasks asked about, and every block linking any
  of them with all its tasks. Blocks are read a page at a time in order of
  their paths; a page the row cap cut short drops its last, possibly partial,
  block and the next page starts after the last whole one. Only a single
  block linking more tasks than the cap returns is refused, never answered
  short. The API reads the same with `POST /v1/query` and
  `schedule: true` (ADR-0016's P31-01 amendment).

## As built (P31-02, 2026-10-10)

Planning the day by dragging tasks onto the calendar:

- **The tray stands beside a calendar of blocks** — a view of the Block type
  drawn as a week, three days or a day — and lists the next actions as the
  Next actions view reads them (deferred ones stay out until their day), the
  ones with no time set aside yet first. A new calendar view of blocks spans
  each from its `start` to its `end`; switching an existing view to Calendar
  does not, since a view edit cannot set an end.
- **Let go on empty time, a task becomes a block** from the quarter hour the
  pointer is in, as long as what the task still needs — its estimate less
  what blocks give it and what is done — at most a day, and half an hour when
  it has no estimate or needs nothing more. Dragging the same task again makes
  another block for what is left: that is splitting. The block is a new note
  made through `createNote`, from the Block type's template when there is one,
  at the top of the vault, named "<task> block" (numbered when taken), with
  `start` and `end` as wall-clock times with no offset.
- **Let go on a block, the task joins its `tasks`**, linked after the others,
  which are written back as they were; a block already linking it is left
  alone. The write goes through a pane holding the block, else
  `setNoteProperties` — the task-rule chokepoints — never to the file directly.
- **The keyboard has the same path**: Enter (or a click) on a task chooses it,
  focus goes to today's first hour, and Enter on an hour or a block places it;
  Escape lets it go. The pointer drag takes no keys, since a held task has no
  step on the clock to make.
- **The last drop can be undone.** A block it made goes to the Trash while it
  holds exactly what the drop wrote; one edited since is left and said. A
  task it linked is unlinked, the block's other links kept. The undo is kept
  for the vault the drop was made in only. A pane holding the new block with
  unsaved typing is not told before it goes to the Trash — the block was made
  a moment before, so this is left rather than threaded through the panes.
- **A drag near the clock's edge does not scroll it**: the tray is not inside
  the clock's scroller. Scroll to the part of the day first.
