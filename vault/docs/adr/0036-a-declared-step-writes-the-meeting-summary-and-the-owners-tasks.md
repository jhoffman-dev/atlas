---
type: adr
id: ADR-0036
title: A declared step writes a meeting's summary and the owner's tasks, and cross-provider copies are linked
status: proposed
date: 2026-10-14
---

# ADR-0036 — A declared step writes a meeting's summary and the owner's tasks, and cross-provider copies are linked

## Context

The maintainer's request, 2026-10-14: when a meeting lands, link its people
and whatever else can be worked out, link the same meeting recorded twice,
put a Claude-written summary at the top, list the action items with who owns
them, and make **his own** action items into tasks, linked both ways. Missing
action items out of meetings is, in his words, "one of my biggest flaws".
He likes linking duplicates through the existing `Duplicate of` property
(`atlas_duplicate_of`).

What is true today:

- **The extraction exists and is switched off.** Meeting extraction with
  Claude (ADR-0028, P29-05, #18) is a built-in automation preset ("Pull
  actions and decisions out of a new meeting"). A Claude step reads the
  transcript and proposes `task`, `waiting`, `decision` and `follow-up`
  items, each citing a transcript turn, with an owner and a confidence. The
  owner is resolved in the domain (`itemOwner`), never by the model. Accept
  makes the task and links it into `meeting.tasks`. In the maintainer's vault
  the preset was never enabled, no prompt note existed, no proposal had ever
  been made, and his Meeting type lacked the `tasks` and `decisions`
  relations that Accept needs. Whether he would have clicked through the
  proposals is unknown.
- **No step writes model text into a note.** ADR-0028: "A Claude step never
  edits a note." PLAN.md section 11, principle 2: "AI proposes, James
  accepts. Claude never edits a note on its own." This record is a deviation
  from both, and is the whole feature.
- **Duplicates are same-provider only.** Dedupe is `provider` + `external_id`
  (ADR-0027). Since Atlas pulls Granola itself (ADR-0034, 2026-10-14) the
  same meeting arrives twice, once per provider. In the maintainer's vault, 8
  days held both, and on the day of the request two meetings did, each with
  the same attendees, starts a few minutes apart, and the Gemini copy's start
  marked approximate (`start_approximate`). Nothing linked them. A copy is
  already archived and stamped `atlas_duplicate_of: [[original]]` when the
  provider and id match (ADR-0027, P28-04), and nothing downstream runs on a
  copy.
- **Who is "me" rests on a name.** The vault has no Person note for its
  owner and no setting for the owner's email addresses beyond Granola's
  `granola_self_emails`. `isOwnerAttendee` and `itemOwner` match the profile
  name (ADR-0024). That is enough today, and is one unset field away from
  every item becoming "waiting on" the owner's own name.
- **Everything runs on one Mac**, which ADR-0035 makes follow the person.
  This record assumes it.
- **The meeting contract keeps text before the first section alone**
  (`splitMeetingSections`), and refuses an unknown `##` heading.
  Provider text in `## Summary`, `## Notes`, `## Provider next steps` and
  `## Transcript` is the person's and the provider's.
- **The step's machinery already exists**: `ModelProvider` to the Claude Code
  CLI with its own tools off, running as the person (ADR-0021); the rule's
  handled ledger, hourly cap, dry run, Run now, Undo last run and Activity
  (ADR-0028); `writeStamp`, which refuses a note with unsaved typing or one
  changed since it was read.

## Decision

**We will post-process a meeting with one declared automation rule, "After a
meeting", whose Claude step writes a marked summary block at the top of the
meeting and makes the owner's own action items into tasks, linked both ways,
and we will link a meeting recorded by two providers as one meeting and a
copy.** The rule is written only when the person says yes to one setup offer;
nothing is written into a vault without it (ADR-0028).

### Where it runs

Imports and linking are the import (ADR-0027). The summary and the tasks are a
rule on the stamp's version, so they run once, on the linked and corrected
meeting, and **never on a copy** (rules hear `imported` only). They run on the
automations Mac (ADR-0035). The step's output kind is a new `meeting-digest`,
`{ summary, key_points[], items[] }`, registered beside `meeting-items`, which
stays registered; the preset moves to `meeting-digest`. A long meeting is
read in parts as `meeting-items` is (at most 10 asks and one 10-minute
deadline per run), plus one "reduce" ask over the parts' summaries.

### The summary block

- **Where, and how it is marked.** At the top of the body, before the
  provider's `## Summary`, as text that belongs to no section. Not a `##`
  heading, which the section reader refuses. The block is a callout between
  two comment markers:

  ```markdown
  <!-- atlas:summary v1 -->

  > [!summary] Summary by Claude (claude-opus-5-5, 2026-10-14)
  > Larkspur Payroll and the platform team agreed to ship the cache behind a flag.
  >
  > **Key points**
  >
  > - …
  >
  > **Action items**
  >
  > - [ ] Flag the cache before Friday — Tobias Fenn ([[2026-10-14 Platform sync#^t0002]])
  > - [ ] Send Mara the renewal contract — you → [[Tasks/Send Mara the renewal contract]]
  >
  > <!-- /atlas:summary -->
  ```

  Frontmatter, written in the same write, after the `atlas_import:` line like
  the other stamps: `atlas_summary_digest` (digest of the block as written),
  `atlas_summary_of` (digest of the transcript it summarised) and
  `atlas_summary_model`. The first is how an edit is detected; the second, how
  an unchanged transcript is skipped.

- **Shape and size** (Q8, default): a summary of at most 150 words, at most 6
  key points, and the action items with their assignees, the whole block under
  about 1,500 characters. Longer is cut and the log says so. The domain
  enforces it; an answer with a bad summary but good items keeps the items and
  logs the summary as dropped.
- **Model** (Q9, default): the chat's. A rule may carry an optional `model:`
  to run a cheaper one. Unset means the chat's.
- **Never over the person's words.** The block is replaced only between its
  own markers, and only when its digest equals the recorded one. An edited
  block, a missing closing marker, two blocks, a marker version the code does
  not know, or a block inside a code fence is **refused**: nothing is written
  and the new summary lands as a proposal ("Replace the summary") instead. The
  provider's `## Summary`, the person's `## Notes` and the transcript are never
  touched. The write is also refused when the note has unsaved typing in a pane
  or has changed since the step read it (`writeStamp`'s rules).
- **Marked** in the file (the callout's title and the frontmatter), in Activity
  ("Summary written by <model> in 41 s; 2 tasks made, 3 items listed, 1
  proposal") and in the rule's log.
- **Undo** is the rule's "Undo last run" (ADR-0028): the block and its keys
  are removed when the digest still matches, and the tasks it made are
  trashed when unchanged.

### Action items become tasks, for the owner only

The decision about what becomes a task is made in the domain, from the
resolved owner (`itemOwner`) and the model's confidence, never by the model:

| Owner                    | Confidence   | Outcome                                                                                                                                 |
| ------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| the person (`self`)      | high, medium | **A task is made now**, `status: inbox`, `due` when said, `source` = the turn's block link, `meeting` = the meeting, `atlas_item` = key |
| the person               | low          | A proposal, as today                                                                                                                    |
| another person or a name | any          | Listed in the summary block with the assignee, and a `waiting` proposal as today. No Waiting task is made.                              |
| ambiguous or unknown     | any          | A proposal (an Inbox task with an empty `waiting_on`), as today                                                                         |
| a decision               | any          | A proposal. A decision is never made into a note without a click.                                                                       |
| a follow-up              | high, medium | Treated as the person's: it is theirs to chase                                                                                          |

- **The default confidence floor is medium** (Q4). It is one constant. A
  missed item is the problem he named, so medium errs toward a task he can
  delete over an item he never saw. The first real meetings are the test of
  that choice (see Consequences).
- **The task lands in `inbox`** (Q3, default), not `next-action`: a task made
  by a model goes through clarify first (ADR-0029). The task rules hold: Waiting
  needs `waiting_on`, and the use-case goes through `createNote`.
- **Others' items** (Q5, default): listed in the summary with the assignee,
  plus proposals as today. Making Waiting tasks for them is a rule setting,
  off.
- **Who is "me"**: a vault setting, `selfEmails`, beside `profileName`
  (ADR-0024; amended there). It is **filled by the person** in Settings →
  Profile and offered in the setup. This record does not name, ship or default
  any address. Without it, ownership is by name only, which is today's
  behaviour; the setup says so.
- **Identity key.** An item's identity is the proposal id's: meeting
  (provider + id), turn, kind, normalised title and owner. It is written on the
  task as `atlas_item` and looked up across the vault **and the Archive**
  before a task is made, as proposals are. A re-run, Run now, a second Mac after
  a conflict, or Accept of a leftover proposal for the same item makes nothing
  twice, and a task ticked done and archived is not made again.
- **Linked both ways.** Task to meeting: `source` (the block link, as Accept
  writes it) and a `meeting` relation. Meeting to task: `meeting.tasks`, joined
  by the same use-case Accept uses, extracted first into one place
  (`makeTaskFromMeeting`) so there is one way to make a task from a meeting
  item. The person's Task type gains `meeting` and `atlas_item`, and the
  Meeting type gains `tasks`, `decisions` and the summary keys, all offered in
  one previewed yes.
- **Backfill** (Q6, default): the rule's `which` bounds it to meetings dated in
  the last 14 days. Older meetings are summarised and mined only when the
  person runs the rule by hand with a wider query. The 15 old Granola meetings
  that were never stamped get linked and corrected, not mined.
- **Work meeting text through Claude Code** (Q11, default: yes) adds no new
  recipient: the text already passes through n8n, GitHub and the chat
  (PLAN.md section 11). The decision stands as the maintainer made it.

### Cross-provider copies are linked, not merged

A meeting from a second provider is a copy of one the vault already holds when
all of these hold, tried against meetings with the same `date` and a different
`provider`, excluding notes stamped `duplicate` or `error` and conflict copies:

1. **The time windows overlap.** A window is `[start, end]`: `end` when given,
   else `start` plus the transcript's length, else `start` plus 30 minutes. A
   start marked approximate widens its window by 20 minutes each side.
2. **The attendees overlap**: Jaccard similarity of 0.5 or more over attendee
   emails, lower-cased, group addresses left out, **the owner left out** (by
   `selfEmails` or name) so that two different 1:1s with the owner do not
   look alike. When either side has no emails, names are compared.
3. When more than one holder matches: title-word overlap, then the nearest
   start.

**The thresholds (0.5, 20 minutes, 30 minutes) are starting values, not
findings.** They were checked by hand against two real pairs and one
look-alike pair, and they are set before any file is archived by a spike
(S1): the rule runs read-only over all of the vault's meeting headers, the
person looks at the pairs it finds, and the values chosen are written here
**before this record is accepted**. A change to them later is an amendment,
since they decide which meeting is archived.

What happens to a match is what already happens to a same-provider copy
(ADR-0027): **the first one imported is the original**; when both arrive in
one run, the existing path order decides. The copy is archived (not deleted),
stamped `duplicate` and `atlas_duplicate_of: [[original]]`. The link is
one-way; the original shows its copies through backlinks. Nothing runs on the
copy, so the summary and the tasks are made once. The link is the existing
property, as the maintainer asked.

A Granola copy can hold the person's own typed notes in `## Notes`. By default
(Q7) it is archived like any copy, one click away from being brought back.
Meetings already imported as two originals (before this rule, or while two Macs
differed) are not touched on arrival; a previewed, undoable sweep ("Find
duplicate recordings") lists the pairs and archives the copy on a yes. It does
not merge tasks already made from both.

### Re-running and idempotency

| Re-run of                                  | Guard                                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| The import on a stamped file               | `atlas_import_outcome` is never judged again (ADR-0027)                                                                 |
| A cross-provider match on an archived copy | The copy is stamped `duplicate`; the original's holders include it                                                      |
| The Claude step on the same words          | The rule's handled ledger, keyed by the **transcript section's digest** (`meeting:<provider>:<id>:transcript:<digest>`) |
| The summary write                          | `atlas_summary_of` equals the transcript digest: skipped without asking the model; `atlas_summary_digest` guards edits  |
| Task creation                              | `atlas_item` looked up in the vault and the Archive                                                                     |

**The ledger's key changes.** It was the whole file's digest. The summary
write, an edit to `## Summary` or `## Notes`, and Accept's frontmatter writes
change that digest, so under the old key the rule would ask again about
unchanged words. Under the new one, only an edit to the transcript is "new
words". Nothing in the maintainer's vault was answered under the old key; the
repo's test fixtures change.

### Failure modes

| Situation                                                                      | Behaviour                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code not installed or logged out on the Mac that runs it                | Import and linking are unaffected. The run fails with the fix-it line and backs off (`backoffMinutes`); it is retried at the next tick and at the next open. The Inbox row says "summary pending" and why. |
| The answer does not parse, has over 25 items, or misses the 10-minute deadline | The run fails, nothing is written, the log records the asks; one retry by backoff, then Run now.                                                                                                           |
| A task write fails after some tasks were made                                  | Everything is planned before the first write and the summary is written **last**, so no summary lists a task that does not exist. Tasks made stay (logged); `atlas_item` makes the rest once on retry.     |
| The person edits the summary block                                             | Its digest no longer matches: it is never rewritten. A later summary (the transcript changed) is a proposal.                                                                                               |
| The meeting is edited, or typed in, while the step runs                        | The write is refused (`expectedModified`, or the pane's unsaved state). The run is logged as failed and retried on the next version.                                                                       |
| A false match archives a real meeting                                          | The copy is archived, not deleted; Activity names the reasons; unarchiving restores it and a `duplicate` stamp left in the Inbox is left alone. The spike sets thresholds first.                           |
| Copies arrive on two Macs between syncs                                        | Each is let in on its Mac; after the sync both are originals and the sweep lists the pair. ADR-0035 keeps this to a rare window. Tasks may exist from both and are not merged.                             |
| 28 waiting meetings and 600 old ones when the rule is saved                    | The rule hears meetings written after its own file (ADR-0028); the 14-day `which` bounds the rest; the per-run cap of 10 and hourly cap of 20 hold.                                                        |

## Alternatives considered

- **Keep proposals only (the status quo, ADR-0028).** Honours "AI proposes,
  James accepts" and every existing test. Not chosen for the owner's own items:
  the problem is items that are missed, a proposal that is never opened is a
  missed item, and the preset was never enabled in the first place. The cost is
  a model writing into his files, accepted below. It stays the answer for
  everything not his (others' items, low confidence, decisions, a refused
  summary).
- **Make tasks at high confidence only.** Fewer wrong tasks, more missed
  items. Not chosen as the default because a missed item is what he is trying
  to stop; it is the same constant if medium proves noisy.
- **Make `next-action` tasks.** Skips clarify. Not chosen: a model's reading of
  a transcript is an input to clarify, not a decision.
- **Make Waiting tasks for other people's items.** It is the other half of
  "missing action items", and it fills the person's list with other people's
  work on a model's attribution. Off by default, available as a setting.
- **Put the summary in a separate note, linked from the meeting.** Leaves the
  person's meeting untouched and removes most of this record's deviation. Not
  chosen because he asked for it at the top of the meeting, and a separate note
  is one more page to open.
- **A summary under a `## Atlas summary` heading.** The section reader refuses
  unknown `##` headings, and the contract's sections are the provider's.
- **A frontmatter `summary:` property.** Short, never mixed with the person's
  text, and invisible at the top of the note, where he asked for it.
- **Duplicates: keep `provider` + `external_id` only.** The status quo; it
  leaves the same meeting twice and every action item made twice.
- **Duplicates: match by title.** Providers title the same meeting
  differently, and two different standups share a title.
- **Duplicates: a shared identifier.** The contract carries none across the
  two providers (ADR-0027's frontmatter), so there is none to match.
- **Merge two recordings into one note.** Out of scope: it fights the
  corrections and block citations (ADR-0034), and a merge cannot be undone as
  cheaply as an archive.
- **Link a copy two ways, or keep it in place.** A new meaning for the
  `duplicate` stamp that touches the import's "settled" rule and the Inbox
  query. Kept as the alternative if archiving a Granola copy hides his typed
  notes too often (Q7).
- **Auto-create Decision notes** (Q12, default: they stay proposals). A
  decision is a claim about what was agreed, and a wrong one is more costly
  than a wrong task.

## Consequences

Easier:

- His own action items are in his task list the same hour, linked to the
  citing turn, without a click. His meetings begin with a short summary and a
  list of who owns what.
- A re-run, Run now, a second Mac and Accept after the fact each make nothing
  twice.
- A second recording of the same meeting is recognised and linked, and does not
  make the tasks twice.

Harder, and what it costs:

- **A model writes into his notes without a click.** This is the deviation, and
  it is not free. The block can be wrong, and a task made at medium confidence
  can be the wrong item, the wrong owner or the wrong due date. The marker, the
  digest, the callout title, the frontmatter, Activity and Undo make it visible
  and removable; they do not make it correct. Whether medium-confidence items
  are right often enough is **not known**; the first weeks of real meetings are
  the test, and the floor is one constant.
- **A wrong "self" is likely when `selfEmails` is empty**, and the setup can
  only ask. A name that two attendees share, a transcript with unnamed
  speakers, or "we" must stay proposals; the domain table treats each as
  low confidence, and its tests carry them.
- **A wrong match archives a real meeting.** It is reversible and visible, and
  the thresholds are unproven until the spike has run.
- **The block's text syncs to GitHub** with the meeting, like the rest of it.
- **Plan limits.** Each ask counts against the person's Claude plan: about 10 to
  60 thousand input tokens per hour of meeting, 1 to 11 asks (an estimate from
  the transcript sizes, not a measurement).
- **A re-ask sees the previous summary** as part of the text before the
  transcript. The prompt tells the model to ignore it; the block is bounded.
- **The ledger's key changes**, so any rule answered under the old key would
  ask again once. None exists in the maintainer's vault.
- **Two sources of truth for an item for a while.** A proposal and a task can
  exist for the same item if the proposal was made first; Accept is then refused
  as "already made" and the proposal archived.
- **The backfill window is a guess** (14 days); the query's relative-date syntax
  is to be confirmed when the ticket is written.
- **Cost to reverse: moderate.** Removing the rule stops all of it. Summary
  blocks can be removed by their markers; the tasks stay, being ordinary notes
  with `atlas_item` and `meeting` on them; the keys on the person's types stay
  until he removes them. Archived copies are restored by unarchiving. Undo last
  run does the latest run only.
- **Unknown, to be settled in the tickets:** where the Inbox's "offer these
  keys" code lives (ADR-0027 says it exists); the relative-date syntax for
  `which`; whether the rule can name `model:` without a host change (the host's
  argument shape takes any non-empty model).
- **Status.** Proposed; accepted when the tasks and the summary have landed and
  the spike has fixed the thresholds above.

### Defaults taken

The maintainer decided the requests at the top; he did not answer the plan's
other questions, so these defaults are recorded **as defaults, not decisions**,
and any of them is a change of one constant or one setting.

- **Q3**: tasks land in `inbox`.
- **Q4**: a task is made at medium confidence and above; low stays a proposal.
- **Q5**: others' items are listed in the summary and proposed; no Waiting tasks.
- **Q6**: the backfill covers the last 14 days; older by Run now only.
- **Q7**: a copy with the person's typed notes is archived and linked.
- **Q8**: the summary is a callout at the top, 150 words at most, with key
  points and the action items with assignees.
- **Q9**: the chat's model, with `model:` available.
- **Q10**: not answered, and not a default value: the person's email addresses
  are a vault setting (`selfEmails`) that he fills in. None is recorded here.
- **Q11**: yes, work meeting text goes through Claude Code unattended.
- **Q12**: decisions stay proposals.
