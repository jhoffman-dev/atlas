---
type: adr
id: ADR-0044
title: Kindle sync reads Amazon's notebook page in a session of its own, off by default
status: proposed
date: 2026-10-21
---

# ADR-0044 — Kindle sync reads Amazon's notebook page in a session of its own, off by default

**Draft.** Proposed with the first part of #508 (the parser, the session and the
sync use-case). The note format it writes into is #503's, decided in that
issue's own ADR; this one does not decide it.

## Context

Kindle highlights, underlines and typed notes are meant to arrive in the vault
by themselves (#508), one source note per book (#503, ADR-0038's sources home
folder). Amazon has no public highlights API. What it has is the Kindle
notebook, `read.amazon.com/notebook`: a page, for a signed-in person, listing
the books with annotations and, per book, its highlights and notes. Readwise
and the open-source notebook readers all read that page. The manual routes —
`My Clippings.txt` over USB, a per-book "Export notebook" email — are not
something anyone does every day.

Reading the page means holding an Amazon session. That session is a set of
cookies that, in the wrong place, sign anyone in as the person: it must not
reach the main webview (where any script in a note or an artifact runs), the
vault (which syncs, and is text in Git), a log, or an IPC payload. That is
ADR-0017's rule for secrets, applied to cookies.

## Decision

### A session of its own

- **Connect Kindle** opens a DFAI window on the notebook, which sends a
  signed-out person to Amazon's sign-in and back. The window is a bare
  `WKWebView` made by the host (`kindle/session_macos.rs`), as the PDF export's
  is: no Tauri IPC, no `tauri://` scheme, nothing of the app injected into
  Amazon's pages. It may only load Amazon over https (`amazon.com` and its
  subdomains) and cannot open windows of its own.
- The window's WebKit **data store is persistent and DFAI's own**: a fixed
  identifier used by nothing else (`dataStoreForIdentifier:`). The main window
  keeps the default store, so no Amazon cookie is ever in it, and it has no
  way to open this one. Disconnect deletes the store and every cookie in it.
- That needs **macOS 14**. On an older Mac WebKit offers only the default
  store (Tauri's `data_store_identifier` silently falls back to it), so the
  host refuses Kindle sync there rather than put the session where the main
  window lives.

### The host fetches; it decides nothing

- A sync asks the host for one notebook page at a time
  (`kindle_fetch_notebook`, a URL). The host refuses any URL not on the
  notebook's origin at `/notebook` or `/kp/notebook` (scheme, host, port, no
  user info, no fragment), reads the cookies from the session's store just
  then, sends those RFC 6265 says go to that URL, and hands back the page:
  its status, its HTML, and — for a redirect off the notebook — where it
  pointed, origin and path only. It follows a redirect only to another
  notebook page. Any cookie value of credential length that the page echoes
  is struck from it. The cookies are then dropped; DFAI never stores them.
- With no cookie for the notebook in the store, nothing is sent at all
  (`not_connected`): a sync that was never connected never reaches Amazon.
- What the page means is TypeScript's (ADR-0005): the domain parses it into
  `KindleBook` and `KindleHighlight` values (`domain/kindle`), and tells a
  library, a sign-in (a redirect to `/ap/`, the robot check, or the sign-in
  form itself), an error status and a page of another shape apart. The
  application's `syncKindle` reads each book whole — every page, following the
  notebook's token — before anything of it is handed to the
  `KindleHighlightSink`, the seam #503's source notes implement.

### What a sync writes, and when it says no

- A highlight's identity is Amazon's annotation id, else the book, the
  location and a hash of the words. The sink is told only highlights it has
  not recorded; it adds them and never rewrites, reorders or removes what the
  note holds (ADR-0003). A highlight deleted on the Kindle stays in the note.
- A book any of whose pages cannot be read is not written at all: never part
  of a book. A sign-in stops the sync where it is ("Kindle sync needs you to
  sign in again"). A library, or every book, in a shape the parser does not
  know is the page having changed, said as that ("Couldn't read Amazon's
  page"), never as "nothing new".

### Off by default

Nothing runs until the person connects. Connecting is the opt-in, for their
own highlights. The Settings card (a follow-up to this first part) says what
it does and the limits below before the person connects.

## Consequences and risks

- **Publishers' export cap.** Amazon shows only part of a book's highlights —
  roughly 10–20%, set per publisher — and truncates past it. Every tool that
  reads the notebook has the same cap. DFAI is to say so in Settings; whether the
  page marks a truncated book (the `contentLimitState` input suggests it may)
  is to be checked against a real page.
- **Amazon may change the page.** The parser keys on element ids and classes
  (`kp-notebook-library`, `kp-notebook-annotations`, `#highlight`, `#note`,
  the next-page and content-limit inputs) that open-source readers have used
  for years, but nothing promises them. When they change, sync stops loudly
  until the parser is updated. The fixtures are hand-made in that shape and
  **must be checked against a saved, scrubbed real page** before this is
  turned on for anyone.
- **Terms of service.** Automated reading of the notebook is a grey area in
  Amazon's terms. It is opt-in, reads only the person's own highlights, at the
  pace of a person (one page at a time, a few syncs a day), and never their
  books.
- **Region.** Only `read.amazon.com` (the US store) is allowed. Other stores'
  notebooks (`read.amazon.co.uk`, …) would each be added to the host's
  allowlist and the sign-in window's, deliberately.
- **The store lives under the app's bundle identifier** in `~/Library/WebKit`.
  A future identifier change (as ADR-0042's was) leaves the session behind;
  the person connects again.
- The sign-in window is AppKit and WebKit on the main thread and has no
  automated test; the fetch, the URL check, the cookie rules and the striking
  are tested against a fake notebook on 127.0.0.1 serving the fixtures. No test
  or CI run contacts Amazon.
