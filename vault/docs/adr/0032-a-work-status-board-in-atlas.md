---
type: adr
id: ADR-0032
title: A work status board in Atlas — connectors as sources, evidence as a cache, rules in the domain
status: proposed
date: 2026-10-10
---

# ADR-0032 — A work status board in Atlas: connectors as sources, evidence as a cache, rules in the domain

## Context

James runs an earlier prototype of a personal **work status board**, a
read-only web app beside his notes. It pulls a product board from an issue
tracker (the items he is accountable for, their stage, owner and the
delivery epics beneath them), pull requests from a code host, pages from a
docs wiki, meeting notes, tasks kept outside the tracker, chat mentions and
mail threads, and answers one question: _where is everything, and what needs
me?_ Its views are a board table with a **health** level per item, a
**timeline** (Gantt) grouped by owner, a **waiting on you** queue, an
**activity** feed with a conversation digest, a **project page** per item
(AI summary, talking points, open questions, work by epic, pull requests,
documents, meetings), a ticket popup, a per-project to-do and notes section,
and a read-only **Ask Claude** panel with live lookups in every source. It
refreshes itself every two hours. Issue #82 asks how Atlas takes this over,
in phase 2, so the prototype can be retired.

What the prototype got right, and this design keeps as rules rather than
features: a missing date is never invented; every health level carries the
statements that produced it; a question is quoted, never paraphrased;
attribution never guesses (an unmatched message stays in the global queue
and never lands on a project page); coverage is stated per source, not
implied; empty is a valid answer; the model summarises facts it is given and
never goes looking for them; direct-message content never reaches a
generated paragraph unless opted in.

What the prototype got wrong, and this design fixes: it is a second app with
its own schema beside the notes, so nothing in it links to a note, a task or
a person; its to-do and notes are a parallel task system; its data lives
only in a database (the private resolutions and summaries included); it
reaches the sources by driving a Claude session as a transport, which is
slow (a full refresh is six to twelve minutes), fragile (the model altered a
query argument more than once) and tied to one account's connectors; its
routing rules and identities are JSON in the code tree, which is why the
code has no remote; and it keys items on the tracker's human-readable key,
which the tracker changed in October, leaving half its tables pointing at
stale rows.

Atlas already has most of the shape: external data arrives as notes
(ADR-0012); secrets live in the Keychain, are named and never held, and go
only to the sites they are bound to (ADR-0017); a source that sends a secret
runs only from `.atlas/sources`; other tools reach the vault through the
running app's API and MCP (ADR-0016); Claude runs through the person's own
Claude Code with its tools off and every write a proposal (ADR-0021,
ADR-0028); automations run on a clock or a note change with a log, a cap and
undo (ADR-0028); proposals are notes (P29-02); tasks follow GTD with a
`waiting_on` and a `source` block link (ADR-0029); the weekly review is a
pure rule over the index (P30-07); meetings arrive as notes under a contract
(ADR-0027); the timeline layout draws dated notes as bars; dashboards are
queries with a way of drawing them (ADR-0010); live query blocks run inside
a note (P30-05); the host fetches over http with an 8 MB cap and a 20 s
timeout, by GET only, and decides nothing (ADR-0005, ADR-0014); and
`.atlas-cache/` is a derived, never-synced place the index and the planned
embeddings already use (ADR-0031).

Atlas is a public repository. Nothing in it may name the employer, a client,
a vendor's account, a person, a board, a channel or a key. The vault is
private and syncs through a private repository.

Measured on the prototype's current data, so the design is sized to a real
load rather than a guess: about 180 board items of which about 36 are
active; 58 linked epics; about 570 child issues; about 1,200 comments; about
190 keyword-matched related issues; about 300 pull requests across seven
repositories, of which about 60 attribute to a board item; 49 wiki pages;
about 160 meetings; 17 tasks outside the tracker; about 300 chat messages
over 14 days across 13 channels plus direct messages; about 80 chat entries
and about 20 mail threads waiting on a reply at any time. A full refresh
moves about 12 MB of raw JSON. None of this is large; it is wide.

## Decision

### 1. What is a note, what is a cache, what is a rule

Three kinds of thing, each kept where its nature says.

**Entities James reads, links to and annotates are notes**, written by a
connector refresh exactly as ADR-0012 writes a calendar: a board **item**
(`type: tracker_item`), a delivery **epic** (`type: tracker_epic`), a
**pull request** (`type: pull_request`), a wiki **document**
(`type: document`), and a **task kept outside the tracker** (`type: task`,
status `inbox`, so it enters GTD). Meetings are already notes (ADR-0027).
Each carries `atlas_source`, `atlas_source_key` and `atlas_source_digest`;
a record that leaves the feed is marked `atlas_source_missing`, never
deleted; a note whose body James edited keeps that body and takes only the
properties the source owns. Every view, board, timeline, dashboard, query
block, backlink and search already works on them.

**Evidence is a cache.** Comments, child issues, chat messages, mail threads
and the per-message "who replied in this thread" facts are machine-scale,
immutable, and — for chat and mail — private in a way the vault is not: the
vault syncs through a repository, and the prototype's first direct-message
pull contained a conversation about an employee's performance plan. So
evidence lives in **`.atlas-cache/work/`**, a SQLite file beside the index:
derived, rebuilt by re-fetching, never synced, never in a note, deleted
when the vault's cache is. This is the same bargain ADR-0031 makes for
embeddings, and the same rule as ADR-0005: nothing lives there that cannot
be made again. The host stores rows it is handed and runs the SQL it is
given; which rows, and what they mean, is TypeScript's. What crosses from
evidence into the vault is only what a rule derives (a rollup count, a
health level) or what James accepts (a task citing a message).

The alternative — every comment and message as a note — was weighed and
turned down: it would put about 1,500 three-line notes a month into the
vault and its sync repository, most of them nothing James will ever open,
and it would sync chat and mail bodies to a repository. The other
alternative — everything in side tables, as the prototype did — was turned
down because it rebuilds every view twice (ADR-0012's whole argument) and
because an item James cannot link a task or a meeting to is not in his
system.

**Derived facts are written as properties by the refresh, and the rules
that derive them are pure domain functions.** On an item note: `stage`,
`owner`, `active`, `start`, `target`, `target_basis` (`committed` or
`none`), `last_activity`, `done`, `total`, `in_progress`, `percent`,
`blocked` (the keys and statuses), `waiting_count`, `open_questions`
(count), `health` (`ok | watch | at_risk | unknown`) and `health_reasons`
(a list of plain statements). Health is written rather than computed at
read time so that an ordinary table can sort by it, a board can group by
it, and a dashboard can count it — the prototype computed it on every read
and so could show it in exactly one place. The rules count in days, and a
refresh runs at least every few hours, so a written value is at most hours
stale on a signal that moves by the day. The Status screen (§4) recomputes
nothing; it reads the properties.

### 2. Connectors are sources, in `.atlas/sources`, and the host decides nothing

A **connector** is a source note (`atlas: source`) with a new family of
formats beside `ics`, `csv`, `json` and `sqlite`: `tracker`, `code_host`,
`chat`, `mail`, `docs`. Each is generic: a connector adapter translates one
vendor's API into plain records and evidence rows, and nothing above the
adapters knows which vendor. A second vendor of the same family is a second
adapter behind the same port.

A connector note says where to read from and what to make, and names its
secrets; it holds no values:

```yaml
atlas: source
format: tracker
url: https://tracker.example.com
auth: { secret: tracker, scheme: Basic }
board: BRD # the project whose items form the board
delivery: DLV # the project whose epics deliver them
keywords: [alpha, beta] # related work matched by text, outside the epic tree
into: Work/Items
epics_into: Work/Epics
interval: 0
summaries: { model: claude-opus-5-5, min_age_hours: 12, include_dm_content: false }
```

Because it sends a secret it runs only from `.atlas/sources`
(`sourceTrustRefusal`), which the API cannot write, and its secret is bound
to the one origin it may reach (ADR-0017). The host's `http_get` is
enough: every API this needs is read by GET, pages fit well inside the 8 MB
cap (the largest page observed is 0.7 MB), and a connector that needs more
than one request makes several — paging, then keys in small batches, as the
prototype learned to. **No new host command is needed for fetching.** Two
things the host does gain, both already planned elsewhere: a cache-table
command shared with ADR-0031 (store these rows, run this read), and, for
mail, the loopback OAuth flow ADR-0030 builds for the calendar, with a
read-only mail scope and the refresh token as a Keychain secret.

What differs from a plain `json` source, and why this is a family and not a
`map:`: a connector yields **several kinds of record** (items and epics into
two folders) and **evidence** (comments, children, messages) in one refresh,
because the rules that derive an item's facts need all of them at once. The
refresh use-case runs the existing `planRefresh` once per record kind, so
the digest, missing-mark and never-overwrite rules are the same code.

**Records are keyed on the source's immutable id**, never on its
human-readable key. The tracker renamed a project's key this month; the
prototype's tables split in two. In Atlas the key is a property
(`key: BRD-135`) that the refresh rewrites, and `atlas_source_key` is the
numeric id that did not change.

**Attribution is a pure rule over private routing.** The connector note for
chat names its channels; a separate private note, `.atlas/work/routing.md`,
holds the rules every connector shares — channel to item, keyword to item,
authors to ignore, mail subjects and senders that are noise — as
frontmatter. Precedence is fixed and the result records the rule that
matched: an explicit item key in the text, then the channel, then the first
keyword; nothing else. An unmatched entry attributes to nothing. Pull
requests attribute by the delivery key in their branch or title, resolved
child → epic → item, because engineers cite the key they are implementing,
not the epic. James's own identity in each system (chat user id, mail
address, code-host login) is a property of the profile note (ADR-0024), so
the rule "has James replied in this thread" never guesses who James is.

**The repository holds no routing, no identities and no keys.** The dev
vault ships one fictional connector note and one fictional routing note so
the tests and the guide have an example. Everything real is in James's
vault, which is private, and the refresh refuses a connector note that is
not under `.atlas/sources`.

### 3. Rules, and where they run

Every rule is a pure function in `packages/domain/src/work/`, with an
injected clock, ported from the prototype's core with its tests (the
prototype's core was 97% covered; the port keeps that):

- `rollUp(children)` — done, in progress, to do, percent; zero children is
  0%, not 100%.
- `deriveSchedule(epics, lastActivity)` — start is the earliest epic
  created; target is the latest committed due date among the epics and
  names which epics committed it; no due date anywhere is `basis: none`
  with the bar's end at last activity. **No date is ever invented.**
- `assessHealth(input)` — at risk: a blocked epic, a committed date passed
  with work outstanding, blocked related work outside the epic tree, or
  14+ days silent while delivering; watch: a committed date inside 21 days
  with under half done, 7+ days silent while delivering, 60+ days dormant
  at any stage, no owner; unknown: no epic linked. Each level carries the
  statements that produced it.
- `attribute(text, channel, rules, knownItems)` — as above.
- `extractQuestions(comments)` — a comment with `?`, unanswered when no
  other author commented after it; the asker's own sentence, quoted.
- `unansweredMentions`, `unansweredDms` — a mention is answered when James
  posted in the same thread afterwards, not elsewhere in the channel; a
  direct message waits when the other person spoke last; group messages
  count only when James was mentioned; bots are ignored.
- `rankQueue(entries, now)` — age dominates, a question or a direct ask
  adds, ties break on id so the order is total.
- `buildFactSheet`, `buildDigestSheet`, `modelSafeText` — the exact text a
  model is given, deterministic and ordered so its hash is a cache key;
  direct-message content replaced by a placeholder unless the connector
  note opts in.

The application layer owns one use-case per verb: `refreshConnector`
(fetch through the port, derive, plan, write, store evidence, report to
Activity), `summariseItems` (§6), `workQueue` and `workStatus` (reads), and
the `/v1/work/*` routes and chat tools they answer. Adapters translate
vendor JSON and own nothing else. The UI holds no rule.

### 4. The views

- **Board** — a Status screen in the sidebar (a row under Weekly review),
  reading `FROM tracker_item WHERE active = true` and showing stage, owner,
  health with its reasons on hover, progress, target with its basis, days
  idle, waiting count and open questions, sortable, filterable by owner,
  with a toggle for inactive items. Because items are notes, the same rows
  are also an ordinary saved table view, and a dashboard can count them by
  health. The screen exists for the coverage strip and the queue, which a
  table cannot draw.
- **Coverage strip** — every connector's last refresh, from its Activity
  report: when, how many records, and the error if it failed. A connector
  that has never run is listed as not wired up. A silently stale page is
  the failure this exists to prevent.
- **Timeline** — the existing timeline layout over items, grouped by owner,
  with `start` and `target`. One generic addition: an optional
  **tentative end** on the layout (`endFallbackKey`), drawn hatched and
  labelled, used here with `last_activity` when `target_basis` is `none`.
  Without it two thirds of the items would be "undated" and vanish from the
  chart; with it they are drawn as what they are, a bar that promises
  nothing.
- **Project page** — not a new screen. James's own Project note gains a
  `tracker_item` relation; the Project template (P30-06) gains query blocks
  for the item's epics, pull requests, documents, meetings and tasks, and
  shows the item's summary and health. The item note itself shows its
  facts, its summary and its digest, and is Atlas's to rewrite. The
  prototype's to-do and notes per project are Atlas tasks with a `project`
  relation and the Project note's body: one task system, not two.
- **Ticket popup** — the item or epic note in a pane, with the comments
  from the evidence cache shown beneath, quoted with their links.
- **Activity** — recent evidence for an item or for the board, from the
  cache, plus the digest (§6). Direct messages appear tagged private.

### 5. "Waiting on you" is a derived queue; what James keeps is a task

Two shapes were weighed. **Every waiting entry as a proposal** in
`Inbox/Proposals/` fits ADR-0028 and empties on accept or reject, but about
80 entries arrive at once, a proposal cannot withdraw itself when James
replies in the thread (the prototype closes about a third of mentions that
way), and a wall of proposals is how the prototype's predecessor died. **A
derived queue** — `unansweredMentions` and `rankQueue` over the cache,
recomputed on every refresh — closes itself when the reply is visible in
the data and never needs clearing by hand for things James already handled.

The queue is derived. On each entry, two actions: **Make a task** writes a
GTD task (`inbox`, or `next-action` when James chooses) whose `source` is the
message's permalink and whose `project` is the attributed item's project,
so the reply becomes a real next action; **Dismiss** records the entry's
source id in `.atlas/work/dismissed.md`, a small private note that syncs,
because a dismissal is James's judgement and not disposable. A new message
in a dismissed thread is a new entry: dismissing means "I handled this
message", not "mute this thread". Open questions from tracker comments are
the same queue with the same two actions, and their resolution is recorded
the same way.

Proposals stay what ADR-0028 made them: what a Claude step extracts from a
meeting or a note. The deterministic queue does not go through them.

### 6. AI summary and conversation digest

Each item note carries two generated paragraphs in marked sections of its
body, and they are different things: the **summary** is where the item _is_,
written from the fact sheet (health reasons, rollup, blocked work, target,
in-flight keys, open questions, what is waiting); the **digest** is what
people are _saying_, written from recent evidence verbatim and told to
attribute every claim to a name. A board-level digest lives in one note the
chat connector owns.

The model is given the sheet and nothing else: no tools, no vault, no
lookup, through the existing `ModelProvider` with the Claude Code
provider's fixed argument shape (ADR-0021) — which is exactly a run with
tools off. The sheet is hashed; the hash, the model and the time are
properties on the note (`summary_hash`, `summary_at`), and a sheet that
hashes the same costs nothing. A changed sheet regenerates only after
`min_age_hours` (12 by default), because the day counts in health reasons
move daily and a two-hourly refresh would otherwise reword every item
several times a day; in between, the section says the facts have moved
since it was written. **Regenerate** on the note is explicit and always
works. Every generation is an Activity line with model and duration.

This is a refresh writing into a note it owns, not Claude editing a note
James owns: the item note is a source-owned mirror, and the moment James
edits its body ADR-0012 stops the body from being rewritten — the summary
freezes and only properties move. James annotates in his Project note. The
alternative, summaries in the cache, was turned down because a paragraph
that cost money and is quoted in meetings should not vanish with a cache
rebuild or reword itself on a whim; summaries as a new note per generation
(ADR-0028's `output: note`) was turned down as clutter.

### 7. Ask Claude

The prototype's panel looked things up live in every source through a
Claude session's connectors. Atlas's chat runs Claude Code with every tool
off and no MCP (ADR-0021), on purpose; it will not reach a source live.
What it has instead is better grounded: three read tools added to the
chat's fixed list and to the MCP server — `work_status(item?)` (the facts,
health and reasons), `work_queue()` (what is waiting on James, ranked, with
permalinks), and `work_evidence(item, since?)` (comments, messages, threads,
pull requests, each with its link) — answered by `/v1/work/*` through the
same router the MCP reaches, so the chat sees what an MCP client sees. Every
item an answer cites carries a note link or a source permalink, which is
what the citation check in P32-06 flags on. An answer says how fresh its
evidence is (the coverage strip's time). For a live question, James asks
from Claude Desktop or Claude Code with the Atlas MCP server beside the
source systems' own connectors; the tools are the same.

These three tools are the `open_loops` and `brief` of P32-04 with work data
in them; that card absorbs them rather than growing a second set.

### 8. Refresh scheduling

ADR-0012 says a source refreshes while its note is open and never in the
background, and automations are the declared exception that writes on a
clock with a log, a cap and undo. So: a new automation action, `refresh`,
naming a source, used by a preset "Refresh work connectors every 2 hours"
on the automations Mac, plus "on app open" when the last refresh is older
than the interval. One refresh per connector at a time (the refresher's
existing guard), at most one every 30 seconds through the API (existing),
and the connectors run in parallel with a bounded pool. A full refresh on
the measured volume is expected to be well under a minute of real API calls
rather than the prototype's six to twelve minutes, since no model is in the
path. That expectation is tested in the first card, not assumed.

### 9. Failure behaviour

- **A source is down or refuses.** The refresh writes nothing, marks
  nothing missing (missing means "left the feed", not "feed unreachable"),
  reports the failure to Activity, and the coverage strip says "last
  refresh failed — showing data from <time>". Each repository and each
  channel is fetched independently and one failing keeps the others, as the
  prototype learned on the day one timed-out request emptied seven
  repositories.
- **Rate limits.** A 429 backs off once with the server's wait and then
  fails that connector for this run.
- **Malformed payloads.** Adapters validate the shape they translate; a
  record missing its id is counted `unkeyed` and skipped, never written
  under an invented key.
- **A payload over the cap.** A page over 8 MB fails that page with the
  host's message; page sizes are chosen so the largest observed page is a
  tenth of the cap.
- **Two refreshes at once.** The refresher's per-source guard; the second
  returns null and the pane says one is running.
- **A run repeated.** Every write is keyed and digested; running twice
  writes nothing the second time; summaries are hash-gated.
- **Ten times the data.** `MAX_RECORDS` (2,000) bounds a refresh; the
  evidence window is bounded by days (30 for chat, 21 for mail, 90 for
  related work) and the cache is pruned to it; past that a refresh reports
  `truncated` rather than growing without bound.
- **The tracker renames a key.** Identity is the id; the key property
  changes on the next refresh and nothing else moves.
- **James edits an item note's body.** The body freezes, properties keep
  moving, and the note says so (the existing source behaviour).
- **No model available.** Summaries are skipped and reported; the facts
  still refresh. Nothing on the board depends on a model.

### 10. What is deliberately out of scope

Writing back to any source — resolving, commenting, transitioning — now or
later; this stays read-only, as the prototype was. A general "any REST API"
connector. Two-way sync of tasks with the tracker. Replacing the tracker
as the system of record. Multi-user. Live lookups from inside the Atlas
chat.

## Phased plan

Sizes are rough agent-days (S ≤ 1, M 2–3, L 4–5), not estimates to put on
a roadmap. The riskiest unknowns go first. Each card is a GitHub issue with
the `assistant` label and a `phase-33` label, and lands as its own PR with
a `code-reviewer` and an `adversarial-tester` pass.

| #   | Card                                                                                                                                                                              | Size | After     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------- |
| 1   | Spike: a tracker page through `http_get` with a bound Keychain secret — auth, paging, cap, timing                                                                                 | S    | —         |
| 2   | Domain: `work/` rules ported with tests (rollup, schedule, health, attribution, questions, queue, replies, sheets, privacy)                                                       | M    | —         |
| 3   | Connector framework: connector formats, multi-kind refresh through `planRefresh`, evidence cache port and host command, Activity report, private routing note, profile identities | L    | 1, 2      |
| 4   | Tracker connector: items, epics, children and comments, related-by-keyword, derived properties written                                                                            | L    | 3         |
| 5   | Status screen: board table, coverage strip, refresh, inactive toggle; API `/v1/work/status`                                                                                       | M    | 4         |
| 6   | Timeline: tentative end (`endFallbackKey`), hatched and labelled                                                                                                                  | S–M  | 4         |
| 7   | Scheduled refresh: automation action `refresh`, preset, refresh on open when stale                                                                                                | S–M  | 3         |
| 8   | Code-host connector: pull requests as notes, attributed child → epic → item, per-repository failure                                                                               | M    | 4         |
| 9   | Docs connector: pages by keyword as `document` notes, routed to items                                                                                                             | S–M  | 3         |
| 10  | Project page: `tracker_item` relation and query blocks on the Project template; item note sections                                                                                | M    | 4, P30-06 |
| 11  | Summary and digest: sheets, hash gate, min age, Regenerate, Activity, DM withholding                                                                                              | M    | 4         |
| 12  | Ask: `work_status`, `work_queue`, `work_evidence` in the chat toolbox and the MCP server                                                                                          | M    | 5, P32-04 |
| 13  | Spike: chat and mail credentials — user token or OAuth app, workspace policy, scopes                                                                                              | S    | —         |
| 14  | Chat connector: mentions, direct messages, channels into the cache; queue; routing; privacy tag                                                                                   | L    | 3, 13     |
| 15  | Mail connector: threads waiting on a reply, noise rules; OAuth through the host (ADR-0030's flow)                                                                                 | M    | 3, 13     |
| 16  | Waiting on you: queue on the Status screen, Make a task, Dismiss note, open questions                                                                                             | M    | 14        |
| 17  | Retire the prototype: parity check, import its checklist as tasks and its resolutions as dismissals                                                                               | S    | 16        |

Cards 1–7 are the first increment (the board, timeline and health from the
tracker alone); 8–12 the second (the project page as a real page, the
summaries and Ask); 13–17 the third (the queue, which needs credentials the
first two do not).

## What keeps running in the prototype meanwhile

The prototype stays up for exactly what Atlas does not yet have, and is
switched off per feature, not at the end:

- Until card 5: everything.
- From card 5: the board, timeline and project facts move to Atlas; the
  prototype is kept for the waiting-on-you queue, the activity digest and
  live Ask.
- From card 11: summaries and digests move; the prototype keeps only the
  queue and live Ask.
- From card 16: the queue moves; live Ask is answered by an external
  Claude with the Atlas MCP server and the sources' own connectors.
- Card 17 shuts it down after a week of both running.

The prototype's code has no remote; backing it up to a private repository
before any of this starts is a precondition, not a card.

## The high-impact 20%

Held at 90%+ with every rule tested, named now so the test writer does not
guess later: `domain/work/*` (every rule above, with fixed clocks and the
prototype's fixtures); `application/work/refresh-connector` (it writes into
the vault from outside it); the connector adapters' translation of vendor
payloads (the integration boundary — malformed, empty, paged and
rate-limited responses); the routing precedence and the identity rules
(the privacy boundary); and the summary gate (it spends money).

## Consequences

- Work items, epics, pull requests and documents become notes James can
  link a task, a meeting or a decision to, and every existing view works on
  them. The vault's sync repository carries their titles and facts; whether
  work data may sync is James's standing call (ADR-0027), per vault.
- Chat and mail bodies never enter the vault or its repository; they live
  in a cache the Mac holds and can lose.
- Atlas gains five generic connector adapters and one cache-table host
  command (shared with embeddings); it gains no vendor names, routing or
  keys. A second vendor of a family is an adapter.
- Three Keychain secrets, each bound to one origin, and for mail a second
  OAuth client on the host's existing flow; a work account's policy may
  forbid that client, which card 13 finds out before card 15 is built.
- The automations Mac does the refreshing; another Mac sees the notes
  through sync and the cache only after its own refresh.
- `.atlas/work/` is a new private folder in the vault (routing,
  dismissals), beside `.atlas/sources/` (connector notes).
- The timeline layout gains one optional key that any dated type may use.
- Ask inside Atlas answers from the last refresh, and says so; live answers
  come from an external Claude with the Atlas MCP server, which is the
  bargain ADR-0021 already made.
- ADR-0012's "nothing refreshes in the background" is met by making the
  background refresh a declared automation, which is what automations are
  for; ADR-0012 is not amended.
