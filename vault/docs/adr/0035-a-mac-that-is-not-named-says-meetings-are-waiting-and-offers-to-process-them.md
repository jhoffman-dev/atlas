---
type: adr
id: ADR-0035
title: A Mac that is not named says meetings are waiting and offers to process them; automatic hand-over is deferred
status: proposed
date: 2026-10-14
---

# ADR-0035 — A Mac that is not named says meetings are waiting and offers to process them; automatic hand-over is deferred

## Context

Import on arrival, linking, correction and every automation that reacts to a
meeting run on **one Mac**, the one the vault's settings name
(`automationsMac`, ADR-0025; `runsAutomationsHere` in
`packages/domain/src/sync/sync-rules.ts`). ADR-0027 (P28-04) says the same
of the import: "Only the Mac that runs the automations writes stamps…
Another Mac does nothing, and loses nothing by it." ADR-0034 repeats it for a
pulled Granola meeting: it "is settled when sync reaches that Mac".

On 2026-10-14 that rule was found to be the reason nothing post-processed the
maintainer's meetings. He works mainly on one Mac. The vault named another.
On the Mac he used:

- Every sync commit in the vault came from it, and its Activity log held
  Granola pull lines and no meeting-import line at all. A Mac that is not
  named drops what it hears without a word (`meeting-importer.ts`: "One that
  is not drops what it hears; nothing is lost by that").
- 28 meeting files under `Inbox/Meetings/` had no `atlas_import_outcome`
  stamp: 13 from the last two days, and 15 older Granola meetings that this
  Mac's own pull had written. None was linked or corrected.
- Nothing told him. Days passed before he looked.

His position on 2026-10-14: a workflow that requires opening a particular Mac
is unacceptable ("that would be a HORRIBLE workflow"). He did not answer the
plan's question Q2, whether a take-over should be automatic or only a button.
The first draft of this record took automatic hand-over as the default. The
review and adversarial passes found it unsafe to ship in this phase (see
"Automatic hand-over: considered and deferred"), so **the default taken is the
button**: it removes the silence and the need to open a particular Mac, and
costs one click.

Why one writer at all (the forces that still hold):

- Two Macs writing one file between syncs is a git add/add conflict with
  different bytes. `settleConflicts` keeps this Mac's file and files the
  other's as `… (conflict from <Mac>).md`, which the import never judges
  (ADR-0025, ADR-0027). Identical bytes merge cleanly.
- The import's steps (validate, find holders, link, correct, stamp) are
  deterministic given the same vocabulary and files, so a double run of them
  costs at most a conflict copy of a proposal note or an archived copy
  stamped across midnight (ADR-0027, P28-04, already accepts this).
- A rule's Claude step (ADR-0028, and the summary and tasks of ADR-0036) is
  **not** deterministic: model text and task note names differ per run. A
  rule's log and its handled ledger are synced notes written for one writer.

What is already built and reused: the claim itself. A write of
`automationsMac` to `.atlas/settings.md`, which the other Mac reads on its
next sync and stands down. Settings → Sync can already move the automations
to this Mac "when the person asks" (ADR-0025).

## Decision

**We will keep one named Mac running the automations, as today, and make every
Mac that is not named say, in the Inbox and in Activity, that meetings are
waiting for the named Mac, with a one-click "Process here" that names this Mac
(the existing claim).** No Mac takes the automations over by itself in this
phase.

Three parts:

1. **A Mac that is not named says so.** The Inbox page shows a prominent
   banner line, "N meetings waiting for <Mac>", with a **"Process here"**
   button. Activity gets a warning once per sync while it holds, "N meetings
   are waiting for <Mac> to process them". Today the drop is silent. The
   banner is shown only on a Mac that is not named, never on the named one.
2. **"Process here" is the existing claim.** It writes `automationsMac` (this
   Mac's id and name) through the settings writer Settings → Sync already
   uses. It also **reruns the missed-arrivals catch-up**: the Claude step's
   catch-up (`missedArrivals`, ADR-0028) is once per vault opened, tracked in
   `use-automations.ts` (`caughtUp`), and the import's catch-up likewise, so
   a Mac that claims mid-session would otherwise catch up on nothing until the
   next open. Claiming resets that state for this vault and runs both
   catch-ups at once. The other Mac reads the new value on its next sync and
   stops (`runsAutomationsHere`).
3. **What "waiting" counts, and when it is judged.**
   - It counts **real arrivals only**: a file under `Inbox/Meetings/` with no
     import outcome stamp, **excluding** sync-conflict copies
     (`… (conflict from <Mac>).md`, recognised by `conflict-copy.ts`, which
     the import never judges, ADR-0027) and **excluding** files that cannot be
     read. A conflict copy is the person's to merge; counting it would make
     the banner permanent, and a claim cannot clear it.
   - It is judged only when **both gates** hold, so a Mac does not claim a
     file the named Mac has already stamped and not yet synced:
     **Gate 1, a pull completed after the file arrived**: the last completed
     sync pull on this Mac finished later than the file's modified time here.
     **Gate 2, the Mac has woken since**: that pull also finished later than
     the last time this Mac woke or resumed (a wake/resume signal, new in this
     ADR; the host reports it as the window regaining focus after a sleep, or
     the system's resume event, whichever the ticket finds the host can
     deliver). The existing "synced this session" flag
     (`use-granola-pull.ts`, `syncedThisSession`) is **not enough for
     either gate**: it turns true once and stays true across sleeps, which is
     exactly when the named Mac's stamp is in flight. Until both gates hold
     the banner says nothing about counts rather than guessing. A vault that
     does not sync is unchanged: it has one Mac.

**This amends no accepted statement in a way that changes who writes.**
ADR-0025's "A Mac connecting to a vault never takes the automations from
another Mac" stays true: a person's click is not the Mac taking anything. The
amendments are to the silence (ADR-0025, ADR-0027, ADR-0034, ADR-0028 each
carry a pointer), and they take effect when this record is accepted.

### Automatic hand-over: considered and deferred

The first draft had a Mac that is not named write `automationsMac` itself
after a meeting had waited ten minutes. It is **not** taken in this phase. The
review and the adversarial pass found holes that a future design must solve
before it is reconsidered:

| Hole                         | What goes wrong                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Conflict-copy ping-pong (H3) | A conflict copy of a meeting or of `.atlas/settings.md` is an "unstamped file" that never gets a stamp; two Macs each see work waiting, each takes over, each syncs a settings conflict copy, forever. |
| Pull interval (H4)           | "Pull completed" does not mean "the other Mac's stamp has been pushed and pulled": the pull interval and the named Mac's own push timing can both exceed a fixed wait, which would be a guess.         |
| Paused sync (H5)             | With sync paused or failing, no pull completes, so the rule never fires; or one Mac pulled before pausing and fires on stale data.                                                                     |
| Wake races (H7)              | A Mac that has just woken pulls, sees waiting work, and takes over in the minute before the named Mac (also just woken) stamps it. Both run the model.                                                 |
| Claude unavailable (H6)      | A Mac that takes over but has no Claude Code login makes meetings wait longer than before, and the original Mac, which had it, stands down.                                                            |

A future design must also say how a claim is undone, how a take-over is
withheld from a Mac without Claude, and how the settings file's own conflict
copies are kept out of the count. None of this is built; the record is kept so
the idea is not reinvented without its holes.

## Alternatives considered

- **Automatic hand-over after ten minutes** (the first draft). Deferred, above.
  It is the best workflow for the person and the worst on correctness; the
  button is the cheaper step that removes the silence.
- **Keep the gate and move the automations by hand (Settings → Sync) with no
  banner.** The status quo, and what the written record says. It produced the
  28 unstamped files and four silent days. Kept as the manual path; the banner
  and button are the new part.
- **Any Mac post-processes (option B in the plan): the import's steps run on
  every Mac that has synced this session, and a rule's Claude step claims a
  meeting by writing `atlas_processing: <Mac> <instant>` into the file,
  syncing, and proceeding only if its claim survives the next pull; stale
  claims (more than 15 minutes) are taken over.** It removes the notion of a
  named Mac. Not chosen because it adds an extra sync round-trip before every
  model step; claim conflicts are still possible within the same minute;
  proposal numbering, the rule logs and the ledgers would have to survive two
  writers (conflict copies in `Sync conflicts/atlas/`); and the claim lives
  in the person's files. Reversing it later is harder than anything here,
  because the key is written into meetings. **Kept in reserve**: its first
  half (every Mac runs steps that are deterministic) is one boolean to open,
  as ADR-0034 notes from the other direction.
- **A lease held in the vault (a heartbeat file the named Mac renews).**
  Needs a clock both Macs agree on and a sync before every renewal, and a
  sleeping Mac cannot renew; it fails exactly when a Mac sleeps, the case this
  record is about.
- **A hosted relay or the n8n workflow does the post-processing.** The model
  step needs the person's own Claude login (ADR-0021), which is on a Mac.
  Out of scope.

## Consequences

Easier:

- The silence is gone: a Mac that is not named says how many meetings wait,
  and for whom, on the Inbox page and in Activity.
- He does not need to remember which Mac was named. Opening the Inbox on the
  Mac in front of him shows it, and one click moves the automations there and
  processes what waited.
- Every write stays single-writer, so the rule logs, the handled ledger
  (ADR-0028) and the proposals' numbering keep the assumption they were built
  on. "A Mac that is not the automations Mac never runs Claude on a meeting"
  (ADR-0028) stays true: only a click changes which Mac that is.

Harder, and what it costs:

- **It is still one click on the right Mac.** It is the workflow he disliked,
  one step shorter and no longer silent. Meetings still wait until he clicks
  or the named Mac wakes. If that proves too slow, automatic hand-over is the
  next record, with the holes above to solve.
- **A wrong count is possible.** "Waiting" relies on the two gates and on the
  stamp's absence. A named Mac that stamped a file but has not pushed shows as
  waiting on the other Mac until the pull after it. Pressing "Process here"
  then is harmless in the steady state (deterministic steps, ADR-0027) and a
  possible conflict copy of a rule's log if a Claude run was in flight on both;
  the ledger's recovery rebuilds from its entries and Activity warns. Rare,
  bounded and visible.
- **The wake/resume signal is new host work.** Whether the host can deliver a
  reliable signal on every Mac is **not yet proven**; the ticket finds out. If
  it cannot, gate 2 falls back to a fixed delay after the first pull following
  a long gap in activity, and the banner says "may be waiting" rather than a
  count.
- **A Mac that merely pulled a Granola meeting writes an unstamped file**
  (the Granola pull runs on every Mac, ADR-0034). Such files are counted once
  both gates hold, which is intended.
- **The claim is a write to a synced settings file**, so it conflicts like any
  settings write (ADR-0025: this Mac's copy wins, the other is saved under
  `Sync conflicts/atlas/`). Two people-clicks within one sync interval leave
  one winner.
- **The settings file records the Mac id and name** (as it already does). The
  claim compares ids, so renaming a Mac changes nothing.
- **Cost to reverse: low.** Remove the banner and the catch-up reset; the Mac
  named in the settings stays named and nothing written needs cleaning.
- **Unknown, to be settled in the tickets (I1-I3):** how the settings write
  and the first read behave when `.atlas/settings.md` cannot be read (the
  rule must do nothing, not guess); what the banner says on a Mac whose gates
  have not held yet; the wake/resume signal above.
- **Status.** Proposed; accepted when the banner, the claim's catch-up and the
  gates have landed (Phase 1 of the meeting post-processing plan).

### Defaults taken

**Q2**, not answered by the maintainer, is taken as: a visible banner and a
one-click claim, **no automatic hand-over**. Overridden by what he did say
only in part: a workflow that needs a particular Mac open is still a click
away from the Mac he is on, and no longer silent.
