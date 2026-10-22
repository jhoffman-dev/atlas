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
  That is **local**: it forgets the session on this Mac and does not sign the
  person out on Amazon, whose own session (and any other device's) stays.
- That needs **macOS 14**. On an older Mac WebKit offers only the default
  store (Tauri's `data_store_identifier` silently falls back to it), so the
  host refuses Kindle sync there rather than put the session where the main
  window lives.

### The host fetches, through a window; it decides nothing

- A second **hidden `WKWebView`** — never shown, never in a window, in the
  same dedicated data store, with no Tauri IPC and no script handlers (the
  same bare view as the sign-in window) — loads `https://read.amazon.com/notebook`.
  **Every navigation and every response** in it is policed by the pure
  `is_notebook_page` rule (`decidePolicyForNavigationAction` and
  `…Response`): the notebook's origin — scheme, host and port — at
  `/notebook` or `/kp/notebook`, no user info, no fragment. Anything else, a
  redirect to Amazon's sign-in above all, is cancelled where it begins and
  reported as where it pointed (origin and path only, and only for an
  `http:` or `https:` address: any other — `mailto:`, `data:`, `blob:`,
  `javascript:`, `about:` — is reported as nothing, since its "path" is its
  contents). A window with no
  session therefore never loads a sign-in page unseen.
- A sync asks the host for one notebook page at a time
  (`kindle_fetch_notebook`, a URL). The host refuses any URL not on the
  notebook's origin at those paths, then runs one constant script in the
  hidden window — in the app's own script world, out of the page's reach, the
  target set as a JSON string — a same-origin `fetch('/notebook?…')`, and
  returns the text: status, HTML, and where a redirect off the notebook
  pointed. A failed `fetch` (a cross-origin redirect to the sign-in cannot be
  read by a script) is asked of the window's own policed navigation instead.
- **Cookies never become Rust strings.** The session stays inside WebKit; the
  host reads no cookie, strikes none, and logs none. There is no HTTP client of
  the host's own in the module either, so a page travels the way the window's
  traffic does (system proxy settings, certificate trust), not around them.
  Tests guard both (`kindle::tests`).
- With no data store (Connect Kindle never done, or undone) nothing is
  loaded at all and the host answers `not_connected`; a Mac before macOS 14
  or not a Mac answers `unsupported`. The hidden window is let go a minute
  after the last fetch, on Disconnect, and after Connect.
- What the page means is TypeScript's (ADR-0005): the domain parses it into
  `KindleBook` and `KindleHighlight` values (`domain/kindle`), and tells a
  library, a sign-in (a redirect to `/ap/` or the sign-in form), a **robot
  check** (a redirect to or form for `validateCaptcha`), **another store's
  notebook** (`read.amazon.co.uk`, …, named), an error status and a page of
  another shape apart. Each annotation row reads only its own passage,
  note, header and location: a row nested inside it is a row of its own, and
  the page is read in one walk, in time linear in its size. The
  application's sync (`createKindleSync`) reads each book
  whole — every page, following the notebook's token — before anything of it
  is handed to the `KindleHighlightSink`, the seam #503's source notes
  implement.

### What a sync writes, and when it says no

- A highlight's identity is Amazon's annotation id, else the book, the
  location and a hash of the words (invisible characters stripped first —
  soft hyphen, zero-width spaces and joiners, word joiner, BOM, direction
  marks, embeddings and isolates — then NFC-normalised, so an invisible
  between a letter and its accent cannot keep them from composing). The sink is told only highlights it has not recorded; it adds
  them and never rewrites, reorders or removes what the note holds
  (ADR-0003). A highlight deleted on the Kindle stays in the note.
- **A note typed on a passage is an entry of its own**, keyed
  `amazon:<id>:note:<hash of the note>` and marked `commentOn` the passage's
  key, added after the passage as a follow-up comment. A note typed on a
  highlight after it was synced therefore still arrives; an edited note is a
  further comment, never a second copy of the highlight. A note-only
  annotation is one entry keyed the same way, `amazon:<id>:note:<hash of the
note>`, so an edited one arrives as a new entry and an unedited one is
  never added twice.
- **No migration for the old note-only key.** Before PR #511's verification
  round a note-only annotation was keyed `amazon:<id>` alone, and an edit to
  it was never seen. Nothing was ever written under that key: the sink is
  #503's source notes, which had not shipped. So no reading of the old key is
  kept. Were a note holding one found, its unedited note-only entries would
  arrive once more under the new key; the key cannot tell an unedited note
  from an edited one, and missing every later edit would be worse.
- A book any of whose pages cannot be read is not written at all: never part
  of a book. Two different passages claiming one annotation id (on a page or
  across a book's pages), or a page nested deeper than any notebook page, are
  such pages.
- A sync **stops where it is**, keeping the books already added in its
  report, for a sign-in (401), a robot check, Amazon saying it is asked too
  often (403 or 429 on any fetch: `rate_limited`, its own message), a Kindle that is not connected, a Mac
  that cannot keep the session apart, another store's notebook, and a host
  that can no longer reach Amazon (`unreachable` or `timeout` on any fetch,
  reported as unavailable with the books done before) — each with its own
  message. A 5xx (or other 4xx) for one book is that book's alone; the sync
  goes on — until three books in a row answer a 5xx
  (`KINDLE_MAX_SERVER_ERRORS_IN_A_ROW`), when Amazon is taken as down and the
  sync stops as `unavailable`, keeping the books done. "Unavailable … will
  try again later" is said only for an unreachable host, a timeout or a 5xx. A library, or every book, in a shape
  the parser does not know is the page having changed, said as that, never as
  "nothing new".
- After a **robot check or a rate limit** (`holdsKindleAutoSync`) automatic
  syncs hold back for 24 hours, the robot check's own back-off reused: both
  are Amazon doubting the client, and asking again soon makes it surer
  (`mayAutoSyncKindle`, a pure function of the clock's reading; the scheduler
  that arrives with the sync-on-launch ticket keeps when the last one came). A sync the
  person asks for is not held. A stored time that is not a finite number is
  read as no robot check: a bad value never holds syncs for ever.
- Fetches are at least 1.5 s apart (`KINDLE_MIN_FETCH_GAP_MS`, through an
  injected delay port), and a wait is never longer than that gap, whatever
  the clock does. The wait is the gap less the time the clock says has passed
  since the last fetch ended, but only while that reading is believable
  (0 to 60 s); a clock set back (below none) or forward (past a minute, more
  than parsing a page and writing a note can take) says nothing of how long it
  has been, so the whole gap is waited. A forward jump under a minute reads
  as time passed and may shorten one gap; a monotonic clock port would close
  that, and is not worth a port of its own here.
- **One sync is in flight per app.** The slot is owned by the use-case
  factory, `createKindleSync`, not keyed by the sink: the composition root
  creates **one** per app and every caller (launch, schedule, ⌘K) uses it. A
  call made while a sync runs joins it and gets its report, failed or not. A
  join waits at most 10 minutes from when the running sync started
  (`KINDLE_SYNC_JOIN_DEADLINE_MS`, through an injected delay); past that the
  running sync is taken as stuck, the join is told so
  (`KindleSyncStuckError`), and the running sync is **given up** (an abort
  signal it checks before every fetch and every note write): it fetches and
  writes nothing more, and its own call fails the same way. The slot is
  **never freed while a sync is alive** — freeing it let a third call run
  beside a healthy long sync and add a highlight twice. A call made while a
  given-up sync winds down runs once it has settled (further calls join that
  one), within a deadline of its own; so two syncs never run at once.
- A call that joins gets the running sync's report even if it was asked for
  a different reason — a sync right after Connect, say, joins one started
  just before the person signed in, and may report a sign-in that the new
  session no longer needs. That is accepted: the next sync reads the new
  session, and two at once would add everything twice.

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
- **Region.** Only `read.amazon.com` (the US store) is allowed. A notebook
  Amazon sends to another store's (`read.amazon.co.uk`, …) is reported by name
  as unsupported. Each would be added to the host's allowlist and the sign-in
  window's, deliberately.
- **The store lives under the app's bundle identifier** in `~/Library/WebKit`.
  A future identifier change (as ADR-0042's was) leaves the session behind;
  the person connects again.
- The sign-in window, the hidden window and the store's removal are AppKit and
  WebKit on the main thread and have no automated test. The pure rules — the
  URL and navigation policy, the page script, how its answer is read, the
  guards that no cookie is read and neither window has a way into the app —
  are unit-tested in Rust, and the parser and use-case in Vitest against
  fakes. No test or CI run contacts Amazon: the Vitest run refuses any
  address off this machine at `fetch` and `XMLHttpRequest`, at node:http and
  node:https requests, and below them at every socket
  (`net.Socket.prototype.connect`, which `net.connect`, `tls.connect`, the
  HTTP agents and undici all open through); and no Rust test opens a socket.
  The PR lists the manual checks.

## Alternatives considered

- **A `reqwest` client with the session's cookies read from the store**
  (the first version of this ADR's host). Rejected:
  - _Fingerprint._ A TLS client that is not WebKit has a different TLS and
    HTTP/2 fingerprint and header order from the browser the person signed in
    with, which is what Amazon's bot detection reads; the same session from a
    different fingerprint is the pattern that triggers robot checks.
  - _Cookie rotation._ Amazon rotates session cookies on responses
    (`Set-Cookie`). A client that sends cookies but does not take the new ones
    back leaves the stored session stale; one that does would have to write
    cookies into the store, which is more cookie handling, not less.
  - _Cookies in Rust._ Reading them makes them strings in DFAI's process: in
    a panic, a log, a struck-out page, an IPC payload. Striking a value from
    the HTML only covers the spellings thought of (percent- and entity-encoded
    echoes got past it in review). A cookie never read cannot leak.
- **Fetching in the main webview.** Rejected: that is where scripts in notes
  and artifacts run (ADR-0017's rule for secrets).
- **Scraping the visible sign-in window** after the person signs in. Rejected:
  it needs the window open for every sync and a page to navigate for every
  book.
- **My Clippings.txt / the per-book export email.** Not automatic; kept as a
  manual fallback outside this ADR.
