---
type: adr
id: ADR-0034
title: Atlas pulls Granola through a pinned host module
status: proposed
date: 2026-10-13
---

# ADR-0034 — Atlas pulls Granola through a pinned host module

## Context

James records ad-hoc meetings in Granola. They reach Atlas only as a one-time
Notion import (P28-07): the n8n flow (P28-02) reads Gemini's emails and never
sees Granola. He wants a Granola meeting in Atlas when it happens, caught up
when Atlas starts, and recoverable by hand when one is missing. Everything
after a meeting file exists is built: the contract, the mapping, the dedupe
on `provider` + `external_id`, the import, the linking, the correction.

ADR-0027 weighed three ways in and **rejected "Atlas polls the provider"**,
for Gmail: "a second OAuth surface and provider parsing inside Atlas". It
chose n8n committing a file into the sync repository, and that stands for
Gemini.

What Granola offers (docs.granola.ai, read 2026-10-13; the API changelog was
at v1.6.0):

- **A read-only REST API**, `https://public-api.granola.ai`, `Authorization:
Bearer grn_…`, on a Business or Enterprise plan. The REST API has no OAuth.
  A personal key is made in the desktop app (Settings → Connectors).
- **`GET /v1/notes`** takes `updated_after`, a cursor and a `page_size` of
  1–30. **`GET /v1/notes/{id}?include=transcript`** returns the note, its
  `web_url`, its attendees, its summary as markdown, the owner's own notes,
  and the transcript as structured turns: `speaker` (`source`, `attribution`
  `me` or `them`, a `name` when known), `text`, and `start_time` and
  `end_time` as RFC 3339 instants (the OpenAPI spec). A transcript too large
  to return inline is a `413` and is read from `/v1/notes/{id}/transcript`, a
  page at a time.
- **Only a note with a generated summary and transcript is visible.** One
  still processing is missing from the list and a `404` on Get.
- **Limits**: a burst of 25 requests per 5 seconds, 5 a second sustained,
  `429` past it.
- **Webhooks** (`note.generated`, `note.edited`, `note.access_granted`) are
  signed with Standard Webhooks and carry only a `note_id`. The URL must be
  public HTTPS; a private address is refused. A failing delivery is retried
  with backoff for four days, after which the endpoint is **disabled and what
  it missed is not replayed**. A desktop app cannot receive them.
- **Not documented**: the order of the list; whether a `429` carries
  `Retry-After`; how long a personal key lives (the docs imply it expires);
  whether `updated_at` changes when a note is shared with you. There is no
  sandbox.

What is already true here (2026-10-13):

- **`mapMeeting` is the one writer of contract files.** The mapping folder
  (`packages/domain/src/meetings/mapping/`) is compiled into n8n's Code nodes
  and imports only itself. `receiveMeeting` maps, validates, checks whether the
  vault already holds the meeting (by the index and by both paths) and creates
  the file exclusively.
- **Meetings imported from Notion carry the Granola note id as `external_id`**
  (`not_…`), as observed in the maintainer's vault. A pull that uses the
  note's `id` as `external_id` is recognised against them with no date floor.
- **The host already has a pinned-module pattern**: `google.rs` and
  `model_http.rs` fix the endpoints, keep a token in a Keychain item that is
  not a named secret, follow no redirect, and strike the token from every
  answer (ADR-0030, "Where the tokens live").
- **Import, linking and correction run only on the automations Mac**
  (`sync.automationsHere`). A file written elsewhere shows in
  `Inbox/Meetings/` at once and is settled when sync reaches that Mac.

## Decision

**Atlas pulls Granola's new meetings itself, through a host module pinned to
Granola's API, and writes each one only through `receiveMeeting`.** Webhooks
are a fast lane beside it, not the way it works.

**This amends ADR-0027's rejection, for Granola only.** Both of its counts
fall away here: Granola's REST API is a bearer key, so there is no OAuth
surface; and the parsing is a pure domain function in the mapping folder that
the n8n path compiles in too, so it is written once. Gmail stays rejected,
Gemini stays on n8n, and a further provider that Atlas should poll needs its
own record. Everything else in ADR-0027 stands: the contract, the file's
place, and idempotence by `provider` + `external_id`.

**The host holds the protocol and the key, and decides nothing else**
(ADR-0005). `granola.rs` fixes the origin (`https://public-api.granola.ai`),
requires the path to start `/v1/` (checked after it is parsed, so `..` cannot
climb out), allows GET only and follows no redirect. The key is a Keychain
item at `<vault>:apikey/granola`, deliberately not a named secret, as ADR-0030
does for Google's. The webview sends the key once and can never read it
back: it learns `{ hasKey, lastRefusal }`. Every answer and failure is struck
of the key, and a Rust test serialises each of them with a fake Granola
echoing `Authorization`, as ADR-0030's does. What to fetch, when, and what a
note means is TypeScript's.

**Granola's turns reach the mapper structured.** `MeetingFields` gains
`turns` (speaker, time, whether it is approximate, words), `clock`
(`elapsed` or `wall`) and `url`, which is written as the frontmatter key
`source_url`. Given `turns`, the mapper does not read a transcript text. The
Granola mapping names the speaker (`name`, else `attribution: me` as `You`,
else `Unknown`), turns each instant into a wall-clock time in the vault's time
zone and writes `transcript_clock: wall`. The zone is a **vault setting**
(`granola_time_zone`, default `America/Los_Angeles`, which is n8n's default
too) and never the Mac's clock.

**The watermark is per Mac and overlaps.** It is kept per vault in the
webview's `localStorage`, not in `.atlas/settings.md`, which syncs: a write on
every start would commit noise and conflict between Macs. A start-up pull
lists from the watermark less 24 hours; **Sync now** lists the last 30 days
whatever the watermark says, and so does the first pull ever. Ids listed are
checked against the vault before any note is fetched, so the overlap costs
list calls only. The next watermark is the largest `updated_at` among notes
written or already held, but **never past the smallest `updated_at` of a note
that failed in transport** (network, 5xx, `429` after its retries, a failed
transcript page), so that note is tried again. A note the mapper **refuses**
does not hold it back: that is deterministic, so it is logged with its
`web_url` and Sync now tries it again after a fix. The list's order is
undocumented, so every page is read before the watermark is decided.

**Any Mac holding a key pulls.** The key in this Mac's Keychain is the opt-in;
there is no `automationsHere` gate, because James wants the meeting on the Mac
in front of him. Two Macs, or a Mac and n8n, writing the same meeting is safe
because the file is **byte-identical**: the same note through the same pure
functions with the same `granola_time_zone`. Git merges an identical add on
both sides cleanly, and ADR-0027's duplicate rule settles any copy left.

**The webhook path is n8n's, and it verifies before it fetches.** An n8n
workflow built from the same mapping folder checks the Standard Webhooks
signature (HMAC-SHA256 over `{id}.{timestamp}.{body}`, the secret
base64-decoded after `whsec_`, a timestamp older than five minutes refused),
fetches the note, maps it and commits it through P28-02's GitHub nodes. It
answers `401` to a bad signature (Granola does not retry a 4xx), **`503` when
Granola answers `404`** (the note is still processing, so Granola retries),
and `200` once the note was read, whatever GitHub then does: a GitHub failure
is emailed and the pull catches the meeting, and must not spend the four-day
retry budget. It subscribes to `note.generated` and `note.access_granted`
only. The payload holds no content, so a forged webhook can at most make n8n
fetch a note James already has access to; the signature protects the rate
limit and the mailbox, not the vault, and is still required. Which n8n
instance runs it is James's call, and the pull does not depend on it.

**An edited note is left as Atlas has it.** `note.edited` is not subscribed
and a listed note the vault already holds is not touched. An imported meeting
has been corrected, linked, cited by proposals' block links (`^tNNNN`) and
perhaps edited by James; rewriting its Summary would break the citations and
the record of the correction, for a change he may not want. `source_url` lets
him open the current version in Granola. Surfacing "Granola changed the
summary" as a proposal (P29) is later work.

**A deleted note does nothing.** A personal key never sees `deleted_at`; the
note just stops being listed, and Atlas deletes nothing (ADR-0012).

## Alternatives considered

- **Webhooks only, through n8n, as ADR-0027 would have it.** The nearest to
  the accepted design, and it costs Atlas nothing. It is kept as the fast
  lane. It cannot be the only way: Granola does not replay what an endpoint
  missed while disabled, the relay is a third party, and it gives James no
  way to recover a meeting he can see is missing.
- **A tunnel (Cloudflare Tunnel) to the n8n on the Mac, so the existing flow
  receives webhooks.** The Mac sleeps and the tunnel drops; four days of that
  and Granola disables the endpoint and what it missed is lost, which is the
  failure the pull exists to cover. It gains nothing over a public n8n.
- **A relay of our own (a Worker or queue the app pulls from).** One more
  hosted thing to run and keep up, for what the pull already does.
- **Render Granola's turns to the legacy `**[hh:mm:ss] You:**` text and let
  `readTranscript` parse them again.** It needs no mapper change. It is lossy
  for a speaker name holding `:` or `*`, and ties the pull to a regex written
  for a layout Granola's API no longer sends.
- **Derive the watermark from the vault (the newest Granola meeting's date).**
  `updated_at` is not the meeting's date, so a note edited after the fact
  would be missed. That is tolerable only because edits are ignored anyway;
  a stored watermark is simpler to reason about, and the overlap costs
  nothing.
- **Gate the pull to the automations Mac.** It would remove the
  conflict-copy case below, and is kept as the fallback if that case turns
  out to happen: it is one boolean in the pull's hook. Not chosen, because
  the meeting would then wait for that Mac.
- **Granola's MCP server.** It needs a browser OAuth sign-in and has no key
  mode, so it is the OAuth surface ADR-0027 turned down. Out of scope.
- **Update an imported meeting when Granola edits it.** See above: it fights
  the corrections and citations. Not in v1.

## Consequences

- **Atlas holds a third-party credential** on every Mac that pulls, one more
  outbound site, and a second pinned host module (`granola.rs`) to keep right.
  The key's lifetime is unknown, so the card says what to do when Granola
  refuses it; James reads the expiry off Granola's settings.
- **ADR-0027's "no provider login, no provider-specific parser" is no longer
  true for Granola.** The parser is the domain's, shared with n8n; the login
  is the key.
- **The real Granola API is never hit in CI.** There is no sandbox. The note
  shape, `413` and paging behaviour are tested against fixtures written from
  the docs; the first real pull on a copy of James's vault is the integration
  test. A Granola API change reaches us as a refused or failed note.
- **Two writers must stay byte-identical, and nothing enforces it across
  machines.** They agree only while the app and the n8n workflow carry the
  same mapping and the same time zone. The workflow is generated and pasted
  into n8n by hand, so the two can be at different mapper versions. Bytes that
  differ become a sync conflict copy (ADR-0025) that the import never judges;
  Activity warns about it. The same happens when a note is edited in Granola
  between two Macs' fetches. Rare, accepted, and the gate to the automations
  Mac above is the way out.
- **A meeting edited in Granola after import is stale in Atlas**, with no
  prompt, until the proposal route exists.
- **Losing the watermark is cheap and bounded**: clearing `localStorage`
  costs one 30-day listing, and the dedupe makes the repeat harmless. Older
  meetings are already a Notion import.
- **Several Macs share one key's rate limit** (burst 25 per 5 seconds, 5 a
  second). The pull paces itself well under it.
- **A note shared with James may arrive only by webhook**, since it is not
  known whether sharing changes `updated_at`; the README of the n8n workflow
  says so. With the endpoint disabled such a note is missed.
- **Cheap to reverse.** The pull is additive: removing it deletes a module, a
  card and a setting, and leaves the files it wrote, which are ordinary
  contract files. `turns`, `clock` and `url` stay in `MeetingFields`, and the
  contract stays v1, because `source_url` is a key v1 already allowed.
- **Unknown, to be settled in the tickets**: whether n8n Cloud's Code node can
  use `crypto` for the signature check (a spike in P28-14; if not, the check
  weakens to the timestamp and the key-gated fetch, and the README says so);
  how large a transcript the inline route returns before a `413`.
- **Status.** Proposed; accepted when the pull lands (P28-11).
