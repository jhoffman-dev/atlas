---
type: adr
id: ADR-0028
title: An automation can be triggered by a note, and can run a Claude step that only proposes
status: proposed
date: 2026-10-07
---

# ADR-0028 — An automation can be triggered by a note, and can run a Claude step that only proposes

## Context

Automations (Phase 25) are notes in `.atlas/automations/`, run on a clock
(`daily`, `hourly`, `open`, `manual`) on the one Mac that holds them
(ADR-0025), with two actions (`archive`, `set`), a dry run, a log and undo.
The assistant needs them to react to a note — "a Meeting appeared" —
including one brought in by a sync pull, and to ask Claude to read it.

Today nothing can say which notes changed: the watcher hands TypeScript a
list of paths, and `app.tsx` drops it; a pull reports only `pulled: true`;
`refreshIndex` returns counts. Claude in Atlas (ADR-0021) runs Claude Code in
one fixed argument shape with its own tools off, reads through the API's
read routes, and turns every write into a proposal — but proposals live only
in a chat's memory, and the toolbox is built only inside the chat hook.

## Decision

**The index refresh reports what changed:** `refreshIndex` returns the
added, changed and removed notes with their type and a digest of their bytes.
That one change feed serves a typed edit, an API write, a watcher event and a
pull alike.

**A new trigger, "a note of a type is created or changed",** fires from that
feed, on the automations Mac only. In the rule's file it is written in words,
like every other `when`: `when: a meeting is created`, `… is changed`, or
`… is created or changed`. Its "where" is the rule's existing `which` query,
which must take that type's notes (`FROM meeting WHERE kind = standup`); the
rule acts only on the notes that set it off and that the query also matches.
_(Amended 2026-10-08, P29-01: this was drafted as an object,
`when: { kind: note, type, on, where }`. As built, it stays one line a person
can read and write by hand, as `daily at 03:00` is, and the where is not a
second query beside `which` that could disagree with it.)_

A note moved, renamed, archived or put back from the Archive is neither
created nor changed: the feed's removed and added pair one to one — by their
two paths for the Archive, whose stamp changes the bytes, and otherwise by
digest, the same name first. When a note leaves a path and a new one is made
there in the same sync, the feed reports that path `changed`; so a changed
note carries the digest it had (`before`, an addition to the P28-03 feed),
and one whose old bytes, or archived copy, turn up elsewhere is a new note.
A note in the Archive never sets a rule off. _(Amended 2026-10-11, #92:
in `Inbox/Meetings` a changed note that carries the import's stamp is never
the far end of a move — see the addendum.)_

**It is idempotent per note version:** the run log records `(rule, path,
digest)`, and a version already handled is never handled again — a restart,
a full re-index or a second pull does not re-run it. Notes changed by the
rule's own deterministic step are recorded under the new digest so they do
not re-trigger it. Notes an archive rewrote links in are not: their bytes
cannot say whether someone also edited them since the index looked, so they
are heard again, and at worst set the rule off once more. A path a note it
had handled left — deleted, moved, renamed, archived or replaced — is
recorded as gone, so a new note there is new to it. A run that changed
nothing is not logged and does not count toward the rule's cap of 20 runs an
hour; a rule at its cap, or failing, is paused, and runs on what it heard
meanwhile (up to 20 syncs' news) when the pause ends. The hour is counted on
the wall clock, in local time, as every automation's schedule is. Run now
takes the matching notes whose current version it has not handled.

**A new action, `claude`: a Claude step with a fixed shape.** The rule names
a prompt note (`.atlas/prompts/<name>.md`), the read tools it may use (a
subset of the chat's fixed read-only list) and an output kind with a schema
(`proposals`, or `note` — see below). It runs through the existing
`ModelProvider` and `runChatTurn` with the host's existing argument shape —
no new host command, no Claude Code tools, no MCP. Output that does not parse
against the schema is a failed run, logged, with nothing written.

**A Claude step never edits a note.** It can only:

- write **proposals** — notes of a built-in `proposal` type in
  `Inbox/Proposals/`, each with a kind (task, decision, follow-up, person,
  link, term, project), the change Accept would make, the source block it
  cites, and a confidence (high / medium / low). Proposals being notes means
  they sync, survive a restart and are queryable; the chat's in-memory
  proposals stay as they are.
- create **one new note** in a folder the rule declares (a morning brief, a
  weekly-review draft), never overwriting one.

**Deterministic steps are the only silent edits,** and only ones Atlas
declares as such (terminology correction is the first). Each records what it
changed on the note and is undoable like any automation run.

**What the Claude step is held to** _(Amended 2026-10-11, the review and
adversarial pass of P29-03, #16.)_

- **The notes are data in the system prompt, not the question.** Each is fenced
  as `<vault_data note=…>`, its text and path neutralized as the chat's open note
  is, cut to an equal share of a total budget. The Claude Code provider
  renders the conversation as a transcript that neutralizes every framing tag,
  so a fence in the question would have been taken down with the note's own
  and left its words bare; in the system prompt the fence is Atlas's alone. The
  question is one fixed line.
- **Text and links only.** An answer's note, proposal body, "why", title and
  properties may not load from elsewhere: no remote or by-reference picture,
  no HTML that loads or embeds (`img`, `iframe`, `script`, `link`, a `src`,
  `style` or `on…` attribute), no web address as a property's value. A picture
  whose address holds what the model read is a way out of the vault seen by no
  one; the whole answer is refused, with the reason. This does not cover what a
  person, a sync or an import wrote: the app's own CSP and a way to allow a
  remote picture are #101.
- **Strict and small.** An unknown key at either level refuses the answer; a
  proposal's payload carries `title`, `folder`, `properties`, `body` and
  nothing that would edit a note (`link`, `link_from`, `meeting`, a digest) —
  see "One writer, and the meeting a proposal came from" below for the one
  link a schema may add itself. Title, body
  and "why" have sizes, properties are few, flat and plain, and none is one
  Atlas keeps. What the model authored is cut before it reaches a log line or
  Activity.
- **Where it writes.** A rule's folder, a proposal's folder and the action a
  run is handed are all held to the proposals' refusals plus `Chats/`, the
  depth the vault is read to and the length a disk takes; the run checks the
  action again, and its prompt path, as the file that wrote it was checked.
- **A citation names a block the model was shown**, outside a code fence, in
  the text it was given before the cut. A meeting is cut between turns (a
  turn is a paragraph ending in its id), never inside one, and a run that cut
  a note says so in its log.
- **A half-written run is on record.** Every note is planned (name cut to what a
  disk takes, contents built) before the first is written. A write that then
  fails is logged as a failed run listing what it made, and the disk's error is
  raised. Each proposal carries a `proposal_id` (its rule, kind, title and cited
  block), so a run again makes none twice — whether the first is still open or
  was answered and archived. The key and the writer are P29-04's (#100): see
  the addendum below.
- **Asking costs, and the log says so.** A run that asked Claude counts toward the
  hourly cap whatever it came back with, a failure included. A Claude step on
  any trigger, not only a note's, skips a note version it has answered. A run
  over more than ten notes says it read the first ten and the rest wait for a
  run by hand, which takes them.

**Every run is in Activity:** trigger, note, digest, step, outcome, model,
duration, proposals made. Each rule has a run cap per hour.

### Addendum (2026-10-11, #92): note triggers and the meeting import

The meeting import (ADR-0027) writes `atlas_import_outcome` into every file
that lands in `Inbox/Meetings`, so a meeting's arrival and the import's stamp
reach the change feed close together, in one sync or two. A rule a meeting
set off could run on the unstamped version and then miss the stamped one,
run on a meeting the import went on to refuse, or — when two meetings had the
same bytes — take an old meeting the import stamped for the new one.

- **The feed says how the import settled each version.** A note's version
  carries its `atlas_import_outcome` when it has one, and a changed note the
  one it had before. The index already holds the stamp as a property; the
  refresh asks for it beside the manifest, so a relaunch knows it too.
- **Where meeting files land, a note is the import's until it lets it in.**
  A rule hears no note in `Inbox/Meetings` that is not stamped `imported`.
  The version that first carries `imported` is its arrival: a `created` rule
  runs once, on the version the import accepted, and a refused (`error`) or
  duplicate meeting never sets it off. The import's own stamp write is not a
  change to the note; an edit to a meeting it let in is. A note filed
  anywhere else is unchanged by this.
- **The general pairing stands, with one exception where meetings land.** A
  `changed` note whose old bytes, or archived copy, turn up elsewhere is
  still a new note made where the old one went. In `Inbox/Meetings` a
  `changed` note that carries a stamp now is never that: a new file lands
  unstamped, so a stamp is the import's own write (its first one changes the
  bytes a copy beside it may still have) or an edit of a meeting it let in.
  A path there that lost a stamp it had (`imported` to none) is a new file
  where the old one moved, and is paired as any other.
- **A meeting's arrival is heard once.** Only a `changed` note whose stamp
  went to `imported` from something else is an arrival; a file _added_
  already stamped (a sync's conflict copy, a meeting moved or restored) is
  not the import's work. The feed's baseline remembers, in memory, that a
  path's arrival was heard (`arrivalHeard`): it is set when the import lets a
  note in, kept if its stamp is lost (so the restored stamp is not a second
  arrival), set on a note that arrived as one end of a move (a meeting made
  elsewhere, then filed in), and cleared for a new file made where another
  went. A relaunch has only the stamps to go by.
- **The stamps are asked for narrowly, and not knowing is safe.** The refresh
  reads stamps only for paths under `Inbox/Meetings`, a page of 1,000 at a
  time (the host cuts a result at 5,000 rows). If they cannot be had — the
  query fails, or a result is still cut short — every note there is taken as
  already arrived: a sync, a rebuild included, goes on from its manifest and
  no meeting arrives twice; the cost is a missed edit of a let-in meeting.
- **Run now follows the feed.** A rule run by hand, or dry-run, plans over
  the same notes the feed would let it hear: in `Inbox/Meetings`, meetings
  stamped `imported` only.
- **One reader of a stamp.** The file's frontmatter and the index's rows are
  read the same way: a list by its first item, a name without the spaces
  round it, an empty list as no stamp, an unknown one as `imported`.
- News heard while the index opens is held and run once each, in the order
  it was heard (already so; now tested).

### Addendum (2026-10-11): one writer, and the meeting a proposal came from

_As built when the four post-processing changes were stacked: #97 (#92), #98
(P28-06), #100 (P29-04), then #99 (P29-03)._

- **One writer makes every proposal.** `planProposals` / `writeProposals`
  (`application/proposals`) take a `NewProposal` and are the only code that
  writes into `Inbox/Proposals/`; meeting linking and a rule's Claude step
  both go through them, and the step's own writer is gone. A checked proposal
  maps to a `NewProposal` field for field (`claudeNewProposal`). What the
  step's writer did that was general moved in, so linking has it too:
  everything is decided before the first write (names, numbered past the
  folder's and each other's, and contents); an id given twice in one batch is
  made once; the folder's own files are read for ids the index has not caught
  up with; and a long name leaves room for the number a taken name gets.
  What differs is what each does with a write that fails: linking writes the
  rest and says which were left; a Claude step stops, fails the run, logs what
  it had made, and raises the disk's error.
- **The limits stay the step's.** Sizes, flat plain properties, no remote
  resource, where it may write and the citation check are rules about a
  model's answer, and are applied before the writer is reached. Linking's
  proposals are built by Atlas from a meeting the import validated.
- **No answer names a note to edit.** P29-04 gave a payload `link_from` and
  `meeting` (provider, id), which Accept writes into a note already there. A
  draft's payload with either — or a link's `note`, `link`, `digest` — is
  refused, as is the kind `link`.
- **A schema may link a proposal back to its source meeting** — the extension
  point for P29-05 (#18). A schema declares `meetingRelations` (relations of a
  meeting, fixed in code and checked when it is registered: not a key Atlas
  keeps), and a draft says `joinsMeeting: '<one of them>'`. The shared check
  then adds `link_from` itself: the note is the one the draft **cites** — a
  note the run read — the property is the schema's, and the meeting's identity
  is what the **run** read from that note's own frontmatter (`AnsweredNote
.meeting`), and only for a meeting stamped `imported`. A draft naming a
  relation its schema does not list, or citing a note that is not such a
  meeting, is refused. Nothing in the answer can choose the note, the
  property or the identity. Accept then does what it does for a person
  proposed from a meeting: makes the note (a task also records its `source`
  block), finds the meeting by its identity wherever it has been filed, and
  adds the link — refusing a meeting that is archived, or another meeting now
  at the old path. The meeting type must have the relation, or Accept refuses
  the link; `proposals`, the general schema, declares none.
- **A Claude step on "a meeting is created" needs nothing new.** The import
  links a meeting, then corrects and stamps it in one write (ADR-0027), and a
  note where meetings land is heard only from the version that first carries
  `imported` (the addendum above). So the step is asked once, about the
  linked and corrected meeting; a duplicate or refused file never asks; the
  import's writes are not a `changed` to any rule; and the step's proposals
  are not meetings, are never handed to a Claude step, and are made once by
  their ids even when the rule's log is lost.
- **The log says when a note was cut.** A note longer than its share (20,000
  characters, or an equal share of 120,000 across the run's notes) is shown
  from its start. The run's `claude` line is followed by
  `- cut "<path>": read <shown> of <total> characters` for each, the summary
  says so, and the log API carries it as `claude.cut`. Chunking a long
  transcript is left to P29-05, which now has the fact to decide on.

## Consequences

- A Mac that is not the automations Mac never runs Claude on a meeting; the
  meeting waits until that Mac is awake and has pulled.
- Claude runs unattended on vault text, which is untrusted (ADR-0021). The
  defence stays structural: the step cannot edit, only propose or create.
- `Inbox/Proposals/` grows; accepted and rejected proposals are archived by
  the existing Archive, so the folder holds only open ones.
