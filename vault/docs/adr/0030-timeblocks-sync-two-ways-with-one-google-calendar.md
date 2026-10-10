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

## As built (P31-03, 2026-10-10)

The connection is built; syncing blocks (P31-04) is not. The host side is
`apps/desktop/src-tauri/src/google.rs` and `google/`; the rules are in
`packages/domain/src/google-calendar`; Settings → Google Calendar is the
card. Where the build went past or around the text above:

- **The flow.** RFC 8252 with PKCE (RFC 7636): a listener on `127.0.0.1`
  at a port the system picks, `S256` from a 32-byte verifier, and a 16-byte
  `state` compared in constant time. Only a redirect to `/` carrying this
  sign-in's `state` is acted on; any other request is answered with fixed
  text and ignored, so another program on the Mac can neither end the
  sign-in nor slip its own code into it. A redirect carrying an error and a
  code is a refusal. One sign-in waits at a time; it ends after five
  minutes or on Cancel. `access_type=offline&prompt=consent` is sent, or
  connecting again after a disconnect would bring back no refresh token.
- **The scope is `calendar.app.created`, not `calendar.events`.**
  `calendar.events` reaches every calendar on the account and cannot be
  narrowed to one. `calendar.app.created` lets Atlas make secondary
  calendars and change events on those alone — the "on that calendar only"
  the decision asks for — and Google lists it as non-sensitive. A consent
  screen lets the person untick a scope and still allow; a token without
  it is refused, revoked and not kept. Reading meetings for P31-05 will
  need a read scope added then, by incremental consent.
- **Where the tokens live, and where they may go.** The refresh token, with
  the client it was issued to and the scopes granted, is one Keychain item
  through the `SecretStore` every secret uses, scoped per vault as ADR-0017
  scopes secrets, at `<vault>:oauth/google`. It is deliberately not a
  named secret: a named secret can be filled into a source's request and
  rebound by the person in Settings → Secrets, and this token's
  destinations are the protocol's, not the person's. So the host pins them,
  the way `model_http` pins the Messages API: the refresh token goes only
  to `https://oauth2.googleapis.com` (`/token` to refresh, `/revoke` to
  revoke) — not `www.googleapis.com` as the decision says, because that is
  where Google's token endpoint is — and the access token, held in the
  host's memory only, goes only to `https://www.googleapis.com` under
  `/calendar/v3/`, checked after the path is parsed so `..` cannot climb
  out. No redirect is followed. The access token is renewed a minute
  before it expires, and a 401 renews it once.
- **The webview never sees a token.** It sees whether a sign-in is kept,
  its client and scopes, and a Calendar API answer with the access token
  struck from it. The PKCE verifier, the code, both tokens and any client
  secret stay in the host. A Rust test serializes every answer and failure
  the commands can hand back, with the API echoing its `Authorization`
  header, and finds none of them
  (`no_answer_or_failure_handed_to_the_webview_carries_a_token`); the IPC
  contract test pins the five Google commands.
- **Where the line is (ADR-0005).** The host holds the protocol and where a
  token may go: the endpoints, PKCE, `state`, the listener, the Keychain,
  and the token's lifetime. TypeScript decides the client, the scope, which
  Calendar calls to make and what their answers mean, which calendar holds
  blocks (one the person owns, never their main one), when to offer to make
  "Atlas blocks", and what each failure tells the person. The host reports
  a failure as a kind and Google's OAuth code; `explainGoogleFailure`
  words it.
- **The client ID is configuration.** Typed in Settings → Google Calendar
  and kept in the vault's settings (`google_client_id`), beside the chosen
  calendar (`google_calendar`), so both Macs use the same calendar; each
  Mac signs in for itself. No client ID is in this repository: James
  creates one in his own Google Cloud project (a Desktop app client, with
  the Calendar API enabled and the scope on its consent screen).
- **A client secret is optional, and never committed.** The task assumed a
  Desktop client with PKCE needs none. Google's documentation for installed
  apps says otherwise for the "Desktop app" client type: its token request
  lists `client_secret` as required, omitting it only for Android, iOS and
  Chrome-app clients, and says an installed app's secret is not treated as
  confidential. This could not be checked against Google here (the build
  talks only to a local fake), so Settings has a masked field for it, sent
  only when typed. It is kept in the Keychain item with the refresh token,
  never in the vault or the repo, and reused when connecting again with the
  same client. If Google accepts PKCE alone for the client, leave it empty.
- **Disconnect revokes and forgets.** RFC 7009 revocation of the refresh
  token, which ends its access tokens too; Google answering `invalid_token`
  (already revoked) counts as revoked. The Keychain item is removed even
  when Google cannot be told, and Settings then says to remove Atlas from
  the Google Account's third-party access.
- **An expired or revoked sign-in** comes back from the token endpoint as
  `invalid_grant`; Settings says to connect again, and that a sign-in which
  lapses every week means the Cloud project's consent screen is in Testing,
  where Google ends refresh tokens after seven days.
- **The local API and MCP expose status only**: whether Google Calendar is
  connected, never a token and no calendar call.
- **Still open — the spike the card asks for.** Whether James's Workspace
  allows a third-party client; whether this client needs its secret; and
  that `calendar.app.created` lists the calendars Atlas made through
  `calendarList`. Each is a configuration change or a one-line scope change
  if it turns out otherwise.
