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
