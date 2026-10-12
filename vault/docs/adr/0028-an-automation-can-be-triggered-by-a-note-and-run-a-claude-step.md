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
A note in the Archive never sets a rule off.

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
  nothing that would edit a note (`link`, `link_from`, a digest). Title, body
  and "why" have sizes, properties are few, flat and plain, and none is one
  Atlas keeps. What the model authored is cut before it reaches a log line or
  Activity.
- **Where it writes.** A rule's folder, a proposal's folder and the action a
  run is handed are all held to the proposals' refusals plus `Chats/`, the
  depth the vault is read to and the length a disk takes; the run checks the
  action again, and its prompt path, as the file that wrote it was checked.
- **A citation names a block the model was shown**, outside a code fence, in
  the text it was given before the cut.
- **A half-written run is on record.** Every note is planned (name cut to what a
  disk takes, contents built) before the first is written. A write that then
  fails is logged as a failed run listing what it made, and the disk's error is
  raised. Each proposal carries a `proposal_id` (its rule, kind, title and cited
  block), so a run again makes none twice — whether the first is still open or
  was answered and archived. The key is P29-04's (#100); once both are on `main`
  the writer is replaced by its `writeProposals`.
- **Asking costs, and the log says so.** A run that asked Claude counts toward the
  hourly cap whatever it came back with, a failure included. A Claude step on
  any trigger, not only a note's, skips a note version it has answered. A run
  over more than ten notes says it read the first ten and the rest wait for a
  run by hand, which takes them.

**Every run is in Activity:** trigger, note, digest, step, outcome, model,
duration, proposals made. Each rule has a run cap per hour.

## Consequences

- A Mac that is not the automations Mac never runs Claude on a meeting; the
  meeting waits until that Mac is awake and has pulled.
- Claude runs unattended on vault text, which is untrusted (ADR-0021). The
  defence stays structural: the step cannot edit, only propose or create.
- `Inbox/Proposals/` grows; accepted and rejected proposals are archived by
  the existing Archive, so the folder holds only open ones.
