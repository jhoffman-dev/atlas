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
