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

- **A REST API**, `https://public-api.granola.ai`, `Authorization: Bearer
grn_…`, on a Business or Enterprise plan. Its notes endpoints are GET-only.
  The REST API has no OAuth. A personal key is made in the desktop app
  (Settings → Connectors).
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
  `429` past it, applied **per user or per workspace** by the key's scope. The
  webhook workflow's fetches share the personal key's budget with every Mac.
- **Webhooks** (`note.generated`, `note.edited`, `note.access_granted`) are
  signed with Standard Webhooks and carry only a `note_id`. The URL must be
  public HTTPS; a private address is refused. Granola waits **15 seconds** for
  an answer and asks for a 2xx before any heavy work. It retries `408`, `429`,
  `5xx`, timeouts and network errors with backoff for four days (another 4xx
  is not retried), after which the endpoint is **disabled and what it missed
  is not replayed**. A desktop app cannot receive them.
- **Not documented**: the order of the list; whether a `429` carries
  `Retry-After`; how long a personal key lives (workspace keys are documented
  as not expiring, personal keys say nothing) and whether the app shows an
  expiry; whether `updated_at` changes when a note is shared with you, or when
  the summary is generated. There is no
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
  `model_http.rs` fix the endpoints, follow no redirect, and strike the
  credential from every answer. `google.rs` keeps its token in a Keychain item
  that is not a named secret (ADR-0030, "Where the tokens live");
  `model_http.rs` uses the named secret `anthropic` (ADR-0021). The Granola
  key follows `google.rs`.
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
Granola mapping names the speaker and turns each instant into a wall-clock
time in the vault's time zone, and writes `transcript_clock: wall`. A speaker
is, in order:

1. the turn's `name`, when Granola gives one, with any `*` or newline replaced
   (a speaker is `**Name**` in the file, and the grammar `readTranscript`
   reads, `/^\*\*([^*\n]+)\*\*/`, cannot hold either);
2. for `attribution: me`: `You` **only when the note's owner email is one of
   the vault person's own emails** (`selfEmails`), because Granola's `me`
   means the note's owner (OpenAPI `Speaker.attribution`) and a note shared
   with James was spoken from someone else's side; otherwise the owner's name;
3. `Unknown`.

Three mapping inputs that are not the note: the zone (`granola_time_zone`,
default `America/Los_Angeles`, n8n's default too), the address grouping
(`groupAddresses`, which changes which attendees are written as a group) and
`selfEmails`. Each is a **vault setting that the app reads**, never the Mac's
clock or locale; the n8n workflow's OPTIONS must be kept to the same values,
and its README says so.

**The watermark is per Mac and overlaps.** It is kept per vault in the
webview's `localStorage`, not in `.atlas/settings.md`, which syncs: a write on
every start would commit noise and conflict between Macs. The **first pull
(no watermark) and Sync now list every note**, with no `updated_after`;
listing is cheap, and an id the vault already holds is never fetched. That
closes the gap between the Notion export and the first pull, which no date
window would: meetings between the Notion export and the first pull are not
in the vault, and a bounded first listing would miss the oldest. The startup
pull and the 15-minute pull list from the watermark less 24 hours. The next
watermark is the largest `updated_at` among notes written or already held,
but **never past the smallest `updated_at` of a note that failed in
transport** (network, 5xx, `429` after its retries, a failed transcript
page), so that note is tried again. A `404` on Get means the note is gone or
still processing: it is skipped and **does not hold the watermark**. A note
the mapper **refuses** does not hold it either: that is deterministic, so it
is logged with its `web_url` and Sync now tries it again after a fix. The
list's order is undocumented, so every page is read before the watermark is
decided. Whether `updated_at` moves when the summary is generated is unknown;
a note that appeared in the list late with an old `updated_at` falls behind
the watermark, and Sync now (a full listing) is how it is found.

**Any Mac holding a key pulls, but only after a completed sync pull.** The
key in this Mac's Keychain is the opt-in; there is no `automationsHere` gate,
because James wants the meeting on the Mac in front of him. **The Granola pull
(startup, periodic, Sync now) runs only after a git sync pull has completed in
this app session** (P28-11 and P28-12 must enforce it). Byte-identity alone
does not make two writers safe: the import stamps, corrects and links the file
in place on the automations Mac, so a Mac that pulls Granola before its first
sync writes the raw file while another Mac's history holds the processed one.
Git then sees an add on both sides with different bytes, and `settleConflicts`
keeps the raw copy and moves the processed one to Sync conflicts. A completed
pull first means a meeting already imported is in the vault, so the dedupe on
`provider` + `external_id` skips it. Two Macs, or a Mac and n8n, writing the
same meeting **between two syncs** still produces the same bytes only while
every mapping input above (zone, `groupAddresses`, `selfEmails`) and the
mapper version agree; otherwise it is a conflict copy (see Consequences).

**The webhook path is n8n's, and it verifies before it fetches.** An n8n
workflow built from the same mapping folder checks the Standard Webhooks
signature (HMAC-SHA256 over `{id}.{timestamp}.{body}`, the secret
base64-decoded after `whsec_`, a timestamp older than five minutes refused),
fetches the note, maps it and commits it through P28-02's GitHub nodes. It answers `401` to a bad signature (Granola does not retry a 4xx) and
**`200` right after the signature is verified**, before it fetches, maps or
commits, as Granola asks and within its 15 seconds. Every later failure
(`404` because the note is still processing, a `401` from Granola for the key,
a `413` or slow transcript, a GitHub failure) is **emailed, not answered**,
and the pull catches the meeting. No answer of ours may spend the four-day
retry budget, since that ends in a disabled endpoint. It subscribes to `note.generated` and `note.access_granted`
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
note just stops being listed, and Atlas deletes nothing.

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
  `readTranscript` parse them again.** It needs no mapper change. It makes a
  speaker name holding `:` ambiguous, and ties the pull to a regex written for
  a layout Granola's API no longer sends. (A `*` or newline in a name cannot
  be saved either way; the mapping replaces them.)
- **Derive the watermark from the vault (the newest Granola meeting's date).**
  `updated_at` is not the meeting's date, so a note edited after the fact
  would be missed. That is tolerable only because edits are ignored anyway;
  a stored watermark is simpler to reason about, and the overlap costs
  nothing.
- **Gate the pull to the automations Mac.** It would remove the
  conflict-copy case in Consequences, and is kept as the fallback if that case turns
  out to happen: it is one boolean in the pull's hook. Not chosen, because
  the meeting would then wait for that Mac.
- **Granola's MCP server.** It needs a browser OAuth sign-in and has no key
  mode, so it is the OAuth surface ADR-0027 turned down. Out of scope.
- **Update an imported meeting when Granola edits it.** See above: it fights
  the corrections and citations. Not in v1.

## Consequences

- **Atlas holds a third-party credential** on every Mac that pulls, one more
  outbound site, and a second pinned host module (`granola.rs`) to keep right.
  The key's lifetime is unknown and Granola's app is not known to show an
  expiry, so Atlas cannot warn ahead. A `401` in the app is a **visible
  notice** as well as the card's state; a `401` in n8n is a `200` and an
  email. The key lives in **N+1 places** to rotate: each Mac's Keychain and
  the n8n credential.
- **ADR-0027's "no provider login, no provider-specific parser" is no longer
  true for Granola.** The parser is the domain's, shared with n8n; the login
  is the key.
- **The real Granola API is never hit in CI.** There is no sandbox. The note
  shape, `413` and paging behaviour are tested against fixtures written from
  the docs; the first real pull on a copy of James's vault is the integration
  test. A Granola API change reaches us as a refused or failed note.
- **Two writers must stay byte-identical, and nothing enforces it across
  machines.** They agree only while the app and the n8n workflow carry the
  same mapping and the same zone, `groupAddresses` and `selfEmails`. The workflow is generated and pasted
  into n8n by hand, so the two can be at different mapper versions. Bytes that
  differ become a sync conflict copy (ADR-0025) that the import never judges;
  Activity warns about it. The same happens when a note is edited in Granola
  between two Macs' fetches. Rare, accepted, and the gate to the automations
  Mac in "Alternatives considered" is the way out.
- **A meeting edited in Granola after import is stale in Atlas**, with no
  prompt, until the proposal route exists.
- **Losing the watermark is cheap and bounded**: clearing `localStorage`
  costs one full listing, and the dedupe makes the repeat harmless.
- **Several Macs and n8n share one key's rate limit** (burst 25 per 5
  seconds, 5 a second, per user or workspace by scope). The pull paces itself
  well under it.
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
