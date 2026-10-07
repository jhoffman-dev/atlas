---
type: adr
status: accepted
date: 2026-09-20
---

# External data arrives as notes

## Context

Subscribing to a calendar, a CSV or a JSON endpoint is the point where a
local-first app usually stops being local-first. The obvious shape is a side
table: fetched rows land in SQLite, a "sources" pane lists them, and the views
learn to read from two places — your notes, and the synced stuff.

Every feature after that has to be built twice. A board that groups your tasks
does not group your calendar. A dashboard counting notes does not count rows.
And the moment Atlas is gone, so is everything it fetched, because the only copy
was in a database that
[ADR-0005](0005-the-index-decides-nothing.md) already says is disposable.

## Decision

A refresh **writes markdown notes into the vault**, and nothing else.

A source is itself a note — `atlas: source` in its frontmatter, saying where to
read from (`url:` or a `file:` inside the vault, one or the other and never both),
which folder the notes land in,
which type they declare, and which field becomes which property. What comes back
is parsed into plain records, and each record becomes a file:

```yaml
type: event
title: Phase 13 — Migration and polish
atlas_source: .atlas/sources/Milestones.md
atlas_source_key: atlas-phase-13
atlas_source_digest: 4f2a91c0
date: 2026-10-01
```

Three keys of bookkeeping, in the file, where everything else already is, all
under an `atlas_` namespace so that none of them is a name a vault might already
be using for its own meaning. The index learns about these notes the way it
learns about any others: the file changed.

**A note a source produced is still your note.** `atlas_source_digest` is a digest of
the body Atlas last wrote. On the next refresh, a body that still hashes to it is
Atlas's to replace; a body that does not is yours, and only the properties the
source owns are rewritten. The digest is FNV-1a — not a security hash, and not
meant to be. It answers one question, has to give the same answer on every
machine, and so cannot be seeded.

**A record that leaves the feed is marked, never deleted.** `atlas_source_missing:
true` goes on the note and the note stays. A calendar that drops an event you wrote
three paragraphs under is not permission to delete those paragraphs. The mark comes
off again by itself: a record that returns to the feed has the key removed from its
note on the next refresh, or a view filtering on it would hide the note for good.

The fetch itself is the only new thing in Rust: `http_get` takes a URL and returns
text. It refuses anything that is not `http:` or `https:` — `file:` in particular,
which would step around the vault's scoped access — caps the response, times out,
sends a plain user agent, and will not follow a redirect that changes scheme. It
decides nothing else; which format the text is, and what to write because of it,
is TypeScript's, as always.

## Consequences

- Every view, board, calendar, dashboard and timeline already works on fetched
  data, because fetched data is notes. The dogfood source in this vault is drawn
  by the ordinary calendar view, and no calendar code knows it came from a file.
- Delete Atlas and the data stays. It is markdown in folders, greppable, in Git.
- Refreshing is a write, so it is bounded like one: at most 2000 notes in a
  refresh, and the destination folder has to exist, because creating a note never
  creates a folder — that is the check that stops a path escaping the vault.
- A refresh is not a sync. It is one-way. Editing a note does not push anything
  back to the feed, and the next refresh will overwrite the fields the feed owns.
- The bookkeeping keys are namespaced and reserved. `atlas_source` rather than
  `source`, because this vault already writes `source: you` on the tasks James
  added by hand, and a name a vault uses for its own meaning is not one a refresh
  may take. A source cannot map a field onto the namespaced names either.
- Timers live in the app, not in the rules: `interval:` refreshes while the note
  is open and stops when it is closed. Nothing refreshes in the background, and
  nothing writes to your vault while you are not looking at it.

## What is left out, and why

- **Secrets.** A source is a public URL or a local file. There is nowhere safe to
  put a token yet: that needs a keychain binding on the Rust side (`keyring` or
  Tauri Stronghold) and the entitlements to go with it. Putting a token in
  frontmatter would put it in Git, which is worse than not having the feature.
  Tracked as `P12-06`, and settled in
  [ADR-0017](0017-secrets-stay-in-the-host-and-foreign-databases-are-read-immutable.md).
- **Attaching a foreign SQLite file.** `ATTACH`-ing someone else's database means
  deciding what read-only means when the file is not ours, and what happens when
  it is locked, or written underneath us, or is not the schema it was last time.
  It is a phase of its own rather than a corner of this one. Also `P12-06`, and
  also ADR-0017.
- **Writing back.** Two-way sync needs conflict rules, and those rules would have
  to live somewhere that is not the file. Not now, possibly not ever.
