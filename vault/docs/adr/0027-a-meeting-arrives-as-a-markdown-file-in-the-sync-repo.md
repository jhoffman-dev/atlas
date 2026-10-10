---
type: adr
id: ADR-0027
title: A meeting arrives as a markdown file in the sync repo, under a versioned contract
status: accepted
date: 2026-10-07
---

# ADR-0027 — A meeting arrives as a markdown file in the sync repo, under a versioned contract

## Context

James's meetings are written up by Google Meet's "Notes by Gemini" (earlier,
Granola). His n8n workflow already pulls them out of email and writes each
into a Notion "Meeting Notes" database: Meeting name, Date, Attendees,
Category (Standup, Retro, 1:1…), Source (`gemini` | `granola`) and Source ID.
The provider will change again — a bot-based notetaker is likely — and Atlas
must not care which. The Mac may be asleep when a meeting ends. Atlas pulls
the vault's GitHub repository every minute (ADR-0025), and external data
already arrives as notes (ADR-0012).

What the providers actually give (from James's Notion rows, 2026-10-06):

- **Gemini:** an Attendees list of `Name — email` lines, which can include
  group addresses (`platform-team@…`) that are not people; Summary; Next
  steps as `- [Owner Name] Title: description`; Details as `Topic: …`
  bullets; a transcript with a date line, **timestamps per section**
  (`### 00:09:44`), one `Speaker Name: text` line per turn with real names,
  ending `### Transcription ended after …` and a disclaimer line.
- **Granola:** **per-line timestamps** (`**[14:14:22] You:** …`) and speakers
  only `You` or `Remote Speaker`; next steps with an owner and a confidence
  (high / medium / low).

Three ways in were weighed: n8n calls Atlas's local API (needs the app
running and reachable; the API is `127.0.0.1` only, ADR-0016); Atlas polls
Gmail itself (a second OAuth surface and provider parsing inside Atlas); n8n
commits a markdown file into the sync repository.

## Decision

**n8n gains a second destination: it commits one markdown file per meeting
into the vault's sync repository, at `Inbox/Meetings/<YYYY-MM-DD> <title>.md`.**
The email parsing it already does is kept, not rebuilt. Atlas's pull brings
the file in like any other note. Atlas holds no Gmail login and no
provider-specific parser.

**The file obeys a versioned meeting import contract**
(`vault/docs/contracts/meeting-import-v1.md`, with a JSON Schema beside it):

- Frontmatter: `type: meeting`, `atlas_import: meeting/v1`, `title`, `date`,
  `start`, `end` (optional), `kind` (from Category), `provider`,
  `external_id` (from Source ID), and `attendees` as a list of
  `{ name, email?, group? }` — a group address is kept but never becomes a
  Person.
- Body sections, in order, each optional except Transcript when the provider
  has one: `## Summary`, `## Notes` (Gemini's Details), `## Provider next
steps` (owner kept as `[Owner]`, and confidence when given), and
  `## Transcript`.
- **Transcript: one block per speaker turn**, `**Speaker** [hh:mm:ss] words
^tNNNN`. The timestamp is the turn's own when the provider gives one, else
  the section's it fell under (marked `~`), else omitted. Block ids make
  every turn citable (ADR-0022). Speaker is a real name, `You` (read as the
  profile's name, ADR-0024), or `Unknown` for `Remote Speaker` and the like;
  an unknown speaker is never guessed into a Person.
- Provider boilerplate (the disclaimer, "Chat with meeting transcript" links)
  is dropped by the mapping.

**`external_id` makes import idempotent.** A file whose `provider` +
`external_id` the vault already holds is not a second meeting: Atlas marks
it `atlas_duplicate_of: [[…]]` and archives it (reversible), and nothing
downstream runs on it. A file that fails validation stays where it landed
with `atlas_import_error:` set and shows in the Inbox; it is never deleted
or silently fixed.

The validator is a pure domain function (`validateMeetingImport`); the
contract version is in the file so v2 can be read beside v1.

## Consequences

- Meetings arrive with the Mac asleep and are processed on its next pull.
- n8n needs push access to the vault repository — a fine-grained token or
  deploy key scoped to that one repository, kept in n8n, never in the vault.
- n8n only adds files, so the existing conflict rules (ADR-0025) suffice.
- Existing Notion Meeting Notes can be brought in once through the same
  contract.
- Work meeting content passes through n8n and GitHub: whether that is
  allowed for work data is James's call, recorded as an open question.

## As built (P28-01, 2026-10-07)

Accepted as written. The contract is `vault/docs/contracts/meeting-import-v1.md`
with `meeting-import-v1.schema.json`; the validator is `validateMeetingImport`
and `parseTranscript` in `packages/domain/src/meetings`. Where the build went
past or around the text above:

- **`transcript_clock: elapsed | wall`** (optional, default `elapsed`) was
  added to the frontmatter. Gemini's times count from the start of the
  recording and Granola's are the time of day; without the key a reader
  cannot tell `00:09:44` from `14:14:22` apart in meaning.
- **The validator is handed the YAML reader.** The domain has no YAML parser,
  so `validateMeetingImport` takes the text plus a `readFrontmatter` function;
  the app passes the one it reads every note with.
- **The JSON Schema covers the frontmatter only.** The body's rules (section
  order, turn grammar, block ids) are in the doc and the validator; a test
  holds the schema and the validator to the same verdict on the frontmatter
  of every fixture.
- **Unknown speakers are read leniently.** The mapping writes `Unknown`;
  Atlas also reads `Remote Speaker`, `Speaker 2`, `Guest` and the like as
  unknown, so a mapping that passes Granola's label through is not refused.
- **`attendees` is not a property of the Meeting type**, since no property
  kind holds a list of records; it stays in the file, and `people` is its
  editable, linked form.
- **The Meeting type is built in** (`BUILT_IN_TYPES`) and its file ships in
  this repository's vault. Nothing yet writes a built-in type's file into
  another vault; that is the "ensure built-in types" step ADR-0029 names, and
  meeting import on arrival (P28-04) depends on it.

After an adversarial pass and a review (2026-10-07), the contract was
tightened. It stays v1: no mapping writes files yet (#8), and most changes
refuse what the first build read wrongly. One does narrow the text: a
deeper heading that names a section (`### Notes`) was allowed and is now
refused.

- **The frontmatter is written with a YAML serializer**, or every string is
  single-quoted: titles and kinds are free text (`Q3: plan`, `Retro #4`,
  `1:1`), and pasted unquoted they read as something else.
- **A turn id is `^t` and a number, rising.** ADR-0022 allows any id; turns
  are narrowed to `^t0001`, `^t0002`, … (padding optional, gaps allowed) so
  a reordered or merged transcript is caught. A block id is used once in the
  whole file, not just among turns.
- **Each turn is its own paragraph.** Two turns without a blank line between
  are refused rather than read as one turn that loses the first id; so is an
  id anywhere in a turn but its end.
- **A bracket of digits right after the speaker is always the time**, so
  `[1:02]`, `[00:09:44.500]` or a time with no words is refused, never read
  as words. With `transcript_clock: wall`, a time is at most `23:59:59`.
- **A section's name at another level (`# Transcript`) and a code fence never
  closed are refused**, since both read as a meeting with no transcript.
  Fences close as CommonMark closes them. A section heading may carry a block
  id (`## Transcript ^h2k8d1`), as citing it writes one.
- **Next-step owners:** `[x]` is a checkbox and refused like `[ ]`; brackets
  inside an owner are kept, and a wikilink owner is kept as written.
- **YAML that cannot be expanded (an alias bomb) is reported as unreadable**,
  not as every key missing: `frontmatterProblem` now reports what turning
  the YAML into values throws, not only what parsing it does.
- **A blank profile name is no name**: `You` stays unnamed.

## As built (P28-02, 2026-10-07)

The n8n destination is in `tools/n8n/` (setup in its `README.md`). Where it
differs from the issue (#8) and the text above:

- **File locations.** The issue planned `vault/docs/contracts/n8n-meeting-to-atlas.md`
  and `.json` and `tools/validate-meeting.mjs`. They live together in
  `tools/n8n/` instead (`README.md`, `meeting-to-atlas.workflow.json`,
  `validate-meeting.mjs`), because the workflow JSON is generated from the
  mapper's TypeScript (`pnpm n8n:build`) and a test fails while the two
  differ. The contract stays in `vault/docs/contracts/`.
- **Atlas runs after Notion, and never stops the run.** The branch is wired
  from the Notion node's success output and reads the parse step by name;
  every node that can fail sends its item to an "Atlas commit failed" node
  instead of stopping, so the Notion write is never prevented.
- **Instants need a time zone.** A date-time with `Z` or an offset is read on
  the clock of `timeZone` (default `America/Los_Angeles`); with none it is
  refused rather than kept as a UTC clock time. A date or time without an
  offset is kept as written.
- **The collision path names a hash**, `<date> <title> (<provider> <8 hex>).md`
  of provider + external_id, within 255 bytes with the date kept. A file
  already there is checked with the same duplicate rule; another meeting
  there, or a file GitHub sends without content (over 1 MB), is a failure,
  never a skip or a guess.
- **Known gap:** titles that differ only in case on one day are two GitHub
  paths but one macOS file name; the single-path lookup cannot see it.

## As built (P28-04, 2026-10-08)

Import on arrival is `importArrivedMeetings` and `catchUpMeetings` in
`packages/application/src/meetings`, run by `createMeetingImporter`. Where the
build went past or around the text above:

### Decision: every handled file carries its outcome

**Each file the import handles gets one frontmatter line,
`atlas_import_outcome: imported | duplicate | error`.** This departs from the
first build's rule that a valid first copy stays byte for byte. Two review
rounds showed that with nothing written, a file never handled and a file
handled and then edited, renamed, moved, unarchived or copied by a sync
conflict look the same. Outcomes then hung on an in-memory record of what
was heard and on guessing moves from names and digests. That memory is lost
on a restart and differs between Macs. The stamp puts the outcome in the
file, where every Mac reads the same thing. No other byte of the file
changes (ADR-0003). The stamp goes right after the `atlas_import:` line the
mapping always writes, not at the end of the frontmatter. A property added
on another Mac lands at the end, so the two are separate changes git merges
rather than a conflict. Keys the import already wrote are changed where
they are.

- **Its own key.** `atlas_import` already names the contract a file follows
  (`meeting/v1`), and the validator requires that value, so the outcome
  cannot share it. `atlas_import_error` and `atlas_duplicate_of` stay as the
  readable detail.
- **What a stamp means.** A file under `Inbox/Meetings/` with no outcome is
  an arrival not finished, whatever the change feed called it. `imported`
  and `duplicate` are never judged again: an edit, rename, move, unarchive
  or sync conflict copy of the file carries the stamp. `error` is checked
  again whenever the file changes, so a fix lets it in and restamps it
  `imported`. An outcome Atlas does not know, or one cleared by hand, is
  read as `imported`, and the file is left alone; the API says the same.
- **A sync conflict's copy is the person's.** A file named
  `… (conflict from <Mac>).md` (U-29) is the other Mac's version of a file
  both changed. It is never judged, never counted as a holder and never
  archived. Activity warns of it each time it is looked at, until the
  person merges it and deletes it.
- **Only the Mac that runs the automations writes stamps**
  (`sync.automationsHere`, as automations, U-29). Another Mac does nothing,
  and loses nothing by it. While the automations move from one Mac to the
  other, each Mac reads the setting on its own next sync, so for that
  window both may import. They still reach the same outcomes: the rules
  depend only on the files. They write the same values too, except the
  day an archived copy is stamped with. A copy's link is its original's
  path, so it is the same on both Macs. If the two Macs' writes do meet,
  the sync rules (ADR-0025) keep both.
- **It catches up.** When the import starts for a vault, once the index is
  ready, and when this Mac takes the automations over, it lists
  `Inbox/Meetings/` (hidden files and folders left out, as everywhere,
  ADR-0014) and settles every file without an outcome. "Ready" means ready
  since this vault opened: the window's index status is the last vault's
  until the new vault's sync starts. The change
  feed only says where to look. That covers a fresh index's first sync
  (P28-03's baseline), what was heard while another Mac imported, and a run
  that failed.

### The rules

- **Which copy is kept.** Among the notes holding a provider + trimmed
  external_id that are not stamped `duplicate` or `error`, and are not a
  sync conflict's copy: one already stamped `imported`, wherever it is, is
  the original. It counts by its stamp and its own keys, even when the
  person's additions mean it no longer follows the contract. An unstamped
  holder counts only when it follows the contract.
  Otherwise a meeting filed elsewhere comes first, then one in the Archive,
  then one in `Inbox/Meetings/`, then by path compared without case,
  Unicode composition or extension. So `<date> <title>` comes before its
  `… 2` and `(<provider> <hash>)` variants. Every other unstamped holder
  in `Inbox/Meetings/` is archived, then stamped `duplicate` where it lands
  and linked to its original by the original's path. Holders filed or
  archived elsewhere, and any already stamped, are left as they are.
- **A copy is moved before it is stamped.** A copy whose move fails stays
  unstamped and is archived when next looked at. So a `duplicate` stamp
  under `Inbox/Meetings/` only ever means the person brought the copy back
  from the Archive, and it is left there.
- **Holders are read, not taken from the index**, which lags the import's
  own writes. Ids are compared trimmed, in SQL and when read.
- **One file's failure is its own.** A copy that cannot be written (a pane
  typing in it, a refused write) is said against that copy. The original
  and the other copies still settle, and the unwritten one is settled when
  it next changes or at the next catch-up.
- **The error is one line**: the first three problems and how many more
  (`tools/n8n/validate-meeting.mjs` prints them all). A body problem names
  its section and its line, counted with the stamp already in the file, so
  writing it does not move what it points at. A file whose YAML cannot be
  read is never written to; Activity says why. It is looked at again when
  it changes.
- **Activity has a Meetings kind**: one line per outcome.
- **The Inbox.** This repository's vault ships an Inbox view that is an
  Atlas query over tasks and meetings: tasks at GTD's `inbox` status, anything under
  `Inbox/`, and any meeting with an import error, shown as a column. Its
  Meeting type declares the three keys so the query can name them and the
  properties panel shows them. **Another vault has neither until they are
  put there.** The import works without them, but its Inbox lists meetings
  only once its Inbox view says so and its Meeting type declares the keys
  (copy `.atlas/views/Inbox.md` and the three properties from
  `.atlas/types/meeting.md`). P30-01's Inbox page, which lists everything in
  `Inbox/` with each meeting's import outcome or error on its row, makes the
  view unnecessary, and the Inbox offers to add the three keys to a vault's
  own Meeting type (previewed, written only on a yes).
- **Known gaps:** a file that fails import and declares no `type: meeting`
  is stamped, but the shipped Inbox query cannot list it (`GET /v1/meetings`
  does, and so will P30-01's Inbox page). Files under `Inbox/Meetings/` that
  are not meetings are judged as arrivals and stamped `error`.

## As built (P28-07, 2026-10-08)

The meetings already in Notion come in once through
`tools/import-notion-meetings.mjs` (how to run it: `tools/n8n/README.md`).
Where it goes past the text above:

- **It writes into a folder, not through GitHub.** It reads a Notion
  "Markdown & CSV" export and writes into a vault folder it is named
  (`--vault`, no default; an empty one is refused), `Inbox/Meetings/` unless
  told otherwise. The folder may not be hidden, nor linked out of the
  vault. The files are the mapper's (P28-02), at the paths n8n would use, so
  Atlas takes them in as it takes n8n's.
- **A row is paired with its page by Source ID**, not by title: titles
  repeat (`1:1`). A row with no page, or with two, is refused, not guessed.
- **It checks each file with the validator before writing it**, and writes
  it whole under a hidden name, flushed, before linking it to its name. A
  name never holds part of a meeting, and no file is written over.
- **"Already in the vault" is P28-04's holder rule**, shared, not copied:
  `meetingHolding` in `packages/domain/src/meetings` decides for both the
  import on arrival and this tool. It is asked of the whole vault (hidden
  folders and sync conflict copies left out) before a row is mapped, so a
  second run writes nothing.
- **The Date cell is read as Notion shows it.** A time with no zone, or a
  zone other than UTC, is kept as written; a UTC time is an instant on the
  clock of `--time-zone`. A range is on one clock: a zone on either side is
  both sides'. A form that could be two days (`10/06/2026`) is refused.
- **Gemini's rows are held by default** (issue #44): their Date is when the
  notes arrived, near the meeting's end, written as local time marked UTC.
  `--gemini-dates arrival-local` reads it as local time and starts the
  meeting the transcript's last section stamp before it. meeting/v1 has no
  field for an approximate start, so Notes open with a line saying so.
- **Not carried over:** the Attendees relation (the page's Attendees
  section is read instead) and the other properties. A page section the
  workflow did not write goes into Notes under its own heading, and a
  transcript block is taken only at the page's top level, outside code; a
  `## Transcript` section is preferred to one.
- **Known gap:** a local time marked UTC cannot be told from a real UTC
  time from the export alone. For Gemini that is issue #44, handled above
  by choice, not by default; any other provider's would be moved by the
  zone's offset. The README's step 4 is the check to make on a vault copy
  before the real run.
