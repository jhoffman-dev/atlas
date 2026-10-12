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

### Addendum (2026-10-11): after the adversarial pass on the stack

_As built on #99 after an adversarial pass over the four stacked changes
(`claude-step.stack.adversarial.test.ts`, `claude-step.stack.test.ts`,
`source-meeting.adversarial.test.ts`, `use-automations.held-news.adversarial
.test.tsx`, `use-automations.catch-up.test.tsx`). The import's side of the same
pass is in ADR-0027._

- **"Not asked twice for the same words" holds wherever the note goes.** A
  rule's history is by path, and a path a note left has none — right for a
  rule that sets or archives (a new note there is new), wrong for a Claude
  step: a meeting filed out of the Inbox, not a byte changed, was asked about
  again by Run now. The digest of a version a run **asked Claude about** is
  now handled at whatever path those bytes are (`handledVersions`); the log
  needed no new line, since a Claude run's entry already holds the digests. A
  failed step answered nothing. A meeting edited after it was answered is
  another version, as it is in place: Run now asks about it. Keying by the
  meeting's provider and id as well was considered and left out — it would
  make a filed, edited meeting behave differently from one edited where it
  landed.
- **A proposal's id comes from what it cites, not how the citation was
  written.** The id was a hash of the rule, kind, title and the `source` text,
  so `[[Standup#^t1]]` and `[[Inbox/Meetings/Standup#^t1]]`, or the same turn
  once the meeting was renamed, were two proposals. A checked proposal now
  carries `cites` — the note the link resolved to among those the run read,
  that note's meeting identity when the import vouches for it, and the block
  id — and the id is the rule, kind, normalised title and that: a let-in
  meeting by provider and id (filing and renaming do not change it), any
  other note by its path (renaming such a note does change it). `source`
  still shows the link as the model wrote it. **Every id a Claude step made
  before this changes**; nothing was released, so nothing is migrated — an
  open proposal from an earlier build could be made once more.
- **A title two notes share is not a citation.** A link by bare title that
  matches more than one of the notes the run read is refused, with words
  telling the model to cite by path (`[[Folder/Note#^id]]`), which the step's
  instructions now also say. It was first-wins by the order the notes were
  read in, which for `joinsMeeting` chose the meeting Accept writes to. A
  target that is a note's whole path names that note alone.
- **A meeting is cut by turns whatever its line endings.** The blank line
  between turns is now found in a CRLF file too; before, such a meeting past
  the limit was shown as nothing at all.
- **One reader of "is a meeting".** `isMeetingType` (a list, any case, as the
  index counts it) is what linking, correcting a meeting's terms and a Claude
  step's `AnsweredNote.meeting` all read. The identity keeps the provider as
  written and trims the id, as `sameMeetingIdentity` and the holders query
  compare them — a trimmed provider would name a meeting Accept cannot find.
- **A re-ask that finds everything made says so.** The run's `claude` record
  carries `alreadyMade` (an `- already made` line with the count, in the log) and its summary
  reads "Nothing new to propose (2 already made)." instead of "Claude proposed
  nothing."
- **News let go is said.** A rule held back keeps 20 syncs' news, and news
  heard before the rules can run is kept to 20 as well; past that the oldest
  went silently. Each one let go is now counted and, within the minute, said
  once per rule: in Activity (a warning) and as a `letGo` entry in the rule's
  log, with how many and that Run now takes the notes they named. It is not a
  run: it counts toward no cap and no schedule. News dropped before any rule
  could hear it is counted against every enabled note-triggered rule, since
  it may have been any of theirs.

#### Catching up when Atlas opens

An arrival is heard in memory. Quit between the import's stamp reaching the
feed and the rule's run — or while the rule was held back, or mid-run — and
on relaunch the feed has nothing to say: the meeting is already `imported` in
the index, so `created` is never heard, and the meeting waited for a run by
hand for ever.

- **What is caught up with.** Once per vault opened, on the Mac that runs its
  automations, with the index ready: for each enabled rule whose trigger
  includes `created`, the notes in `Inbox/Meetings` that are of the rule's
  type, stamped `imported`, **last written after the rule's own file was**,
  and of which the rule's log holds nothing — no version at that path, and
  not those words (`missedArrivals`, domain; `runOnMissedArrivals`,
  application). They are run on as the feed's news would have been: the
  rule's query among them, the per-run cap (10 for a Claude step; the log
  says when it stopped short, and the next opening takes the rest), and the
  hourly cap — held by it, the look is kept in the rule's queue like news and
  runs when the pause ends.
- **Why "since the rule's file was last written".** Nothing in a meeting says
  when it was let in, and a `created` rule must not act on what was there
  before it existed or was turned on. The import's stamp is the last write to
  a meeting until someone edits it, and turning a rule on or saving it writes
  its file; both times come from the same disk, so no clock is converted. It
  is read from the index's manifest and one read of the rule's file.
- **What it gets wrong, knowingly.** A meeting let in, then the rule edited,
  then Atlas quit before the run: left out (Run now takes it). An old meeting
  still in the Inbox, never handled, edited after the rule was saved: taken
  as an arrival once. A pull that rewrites the rule's file moves its time
  forward. A rule that only sets a property and found nothing to change logs
  nothing, so it looks again each opening, and again changes nothing.
- **A fresh clone or a restore.** The rule's file is written when the vault
  is cloned or restored, which can be before `Inbox/Meetings` is: every
  meeting there then looks written after the rule, and the log of a clone has
  no entries to say it was handled (the log is a file too, but a restore from
  an older copy may bring an older one). Those meetings count as arrivals the
  first time Atlas opens. It is bounded by the per-run cap (10 for a Claude
  step, the rest taken by later openings — each of which is then in the log —
  or ignored by Run now), by the hourly cap, and by the ledger's floor when
  its log is intact; it is not prevented.
- **Only the meeting case.** Elsewhere a note's arrival is the feed's `added`,
  and what was added while Atlas was closed is reported by the first sync
  after opening (the index's manifest is the baseline), so nothing is lost
  across a relaunch except what was already heard and held — which Run now
  takes. A general catch-up ("notes matching the rule, appeared since its
  last run, with no handled version") would need an arrival time the files
  do not hold; it is left out.

#### The handled ledger

The rule's log keeps its last 100 entries, so it cannot also be what a rule
remembers having handled: a meeting whose run aged out would be asked about
again at every opening, and sixty "news let go" notices were enough to push
sixty runs out. What a rule has handled lives in a **ledger**, a section at
the top of the same log note, `## Handled so far`, written in the same write
as the entry that changed it and never counted among the entries a log drops:

```markdown
## Handled so far

- vouches from `"2026-07-01T00:00:00.000Z"`
- handled `"Inbox/Meetings/Standup.md"` `"2026-10-08T09:00:00.000Z"`: `["1a2b3c4d"]`
- answered `"Inbox/Meetings/Standup.md"` `"2026-10-08T09:00:00.000Z"`: `["1a2b3c4d","body:9f8e"]`
```

- **`handled` lines** are the versions handled (or left by the rule's own
  write) at a path, newest last, at most 20 per note, with when the path was
  last recorded. A path the log says went, or that the run archived, is
  removed, exactly as the entries' reading did.
- **`answered` lines** are the words a Claude step was asked about: the path it
  was answered at, when, and **a list of keys** — the whole-file digest
  first, then any key the rule's schema supplies (the meeting's body digest,
  its identity). A log entry's version line carries those as
  `… at `"digest"`also`["body:9f8e"]``; the ledger carries them forward.
  A version is answered if any of its keys is one an answered line holds.
  The meeting-items schema plugs in by putting its key on the versions it
  logs; nothing else changes.
- **Pruned by age and by count**: records older than 90 days, then the oldest
  past 2000. Pruning sets `vouches from` to the newest time it forgot. Catch-up
  (`missedArrivals`) never reaches behind it: it considers a meeting only if
  written after both the rule's file and that floor, since a meeting last
  written before what the ledger forgot cannot be vouched for. Times are the
  entry's own wall-clock time read as UTC, so the floor can be a time-zone's
  offset off the disk's; that is a day at most, on a horizon of 90.
- **A log without a ledger** (written before this) behaves as it did: the
  ledger is built from its entries the first time it is added to, and read
  from them until then. If it already held 100 entries it may have dropped
  some, so it vouches only from its oldest. A ledger a person deleted is
  built again from whatever entries remain; a line that does not read is left
  out, as every log line is.
- **Let-go notices fold**: a `letGo` entry written right after another joins
  it, the counts summed, so a burst is one entry and costs the log no run.
- **A different note with the same bytes is not answered.** Words answered at
  a path are the note's alone while that path still holds them: another note
  (two tasks from one template) is asked about. Once the answered path holds
  other bytes or none — the note was filed, renamed or edited — those words
  at any path are taken as answered. A note carrying one of the answered
  version's schema keys (the same meeting identity) is the same note wherever
  it is. The path's current digest is read from the index when a run decides,
  and only when a version is handled but not at its own path.

#### Known behaviour, left as designed

- **One bad item refuses the whole `proposals` answer.** The general schema is
  all or nothing: a single item that cites nothing real, or carries a key it
  was not asked for, fails the run with nothing written.
- **Two rules that propose the same item each make their own proposal.** An id
  includes its rule, so two rules reading one meeting can both propose "Send
  Mara the file"; they are answered separately.

## Consequences

- A Mac that is not the automations Mac never runs Claude on a meeting; the
  meeting waits until that Mac is awake and has pulled.
- Claude runs unattended on vault text, which is untrusted (ADR-0021). The
  defence stays structural: the step cannot edit, only propose or create.
- `Inbox/Proposals/` grows; accepted and rejected proposals are archived by
  the existing Archive, so the folder holds only open ones.
