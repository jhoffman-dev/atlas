---
type: adr
id: ADR-0035
title: Automations follow the Mac in front of the person, automatically and visibly
status: proposed
date: 2026-10-14
---

# ADR-0035 — Automations follow the Mac in front of the person, automatically and visibly

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

His decision on 2026-10-14: a workflow that requires opening a particular Mac
is unacceptable ("that would be a HORRIBLE workflow"). He did not answer the
plan's question Q2, whether the take-over should be automatic or only a
button, so Q2's default is taken below.

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

What is already built and reused: the hand-over itself. A write of
`automationsMac` to `.atlas/settings.md`, which the other Mac reads on its
next sync and stands down. Settings → Sync can already move the automations
to this Mac "when the person asks" (ADR-0025).

## Decision

**We will let the automations follow the person: a Mac that is not named takes
the automations over by itself when meetings have waited for more than ten
minutes, and says so, and every Mac that is not named says that meetings are
waiting.** One Mac still writes at a time.

Three parts:

1. **Automatic hand-over.** On a Mac that is not named, once a sync pull has
   completed on it this session, if a file under `Inbox/Meetings/` has no
   import outcome stamp and has waited more than **10 minutes** on this Mac,
   the Mac writes `automationsMac` (its id and name) through the existing
   settings writer, and its import catch-up runs. The other Mac reads the
   new value on its next sync and stops (`runsAutomationsHere`).
   - A Mac that is named never hands over, and never takes anything back.
   - The ten minutes is a constant in the domain rule (`standsIn`), not a
     setting, so it is tested as one number. It is a **default**: the plan's
     Q2 was not answered.
   - It reuses the hand-over. There is no lease, no claim key in the files,
     and no new sync traffic.
2. **A Mac that is not named says so.** Activity gets a warning, once per
   sync while it holds: "N meetings are waiting for <Mac> to process them
   (last synced <when>)". The Inbox page shows the same as a line, "N
   meetings waiting for <Mac>", with a "Process here" button that does the
   hand-over by hand, at once. Today the drop is silent.
3. **Pull before you judge.** On a synced vault, the import's catch-up and
   the Claude step's catch-up for missed arrivals (`missedArrivals`) run only
   after a completed sync pull this session, so a Mac that has just woken
   does not stamp a file the other Mac already stamped. It reuses the
   Granola pull's "synced this session" signal (`use-granola-pull.ts`). A
   vault that does not sync is unchanged.

**This amends two accepted statements.** ADR-0025: "A Mac connecting to a
vault never takes the automations from another Mac" now has an exception:
unless meetings have waited ten minutes after a completed pull. ADR-0027
(P28-04) and ADR-0034: "only the Mac that runs the automations writes stamps"
stays true at any moment; what changes is that the Mac can change, by itself.
Both records carry an amendment pointing here.

## Alternatives considered

- **Keep the gate and move the automations by hand (Settings → Sync).**
  The status quo, and what the written record says. It produced the 28
  unstamped files and four silent days. It also works only if the person
  remembers which Mac holds the automations, which he rejected as a
  workflow. Kept as the "Process here" button, not as the mechanism.
- **A manual "Process here" button only, with the warning (no automatic
  take-over).** Fixes the silence, and costs one click on the right Mac every
  time he works on the other one. It is the same workflow he turned down, one
  click shorter. It is the fallback if the automatic hand-over proves flappy:
  remove part 1 and parts 2 and 3 still stand.
- **Any Mac post-processes (option B in the plan): the import's steps run on
  every Mac that has synced this session, and a rule's Claude step claims a
  meeting by writing `atlas_processing: <Mac> <instant>` into the file,
  syncing, and proceeding only if its claim survives the next pull; stale
  claims (more than 15 minutes) are taken over.** It removes the notion of a
  named Mac. Not chosen because it adds an extra sync round-trip before every
  model step; claim conflicts are still possible within the same minute;
  proposal numbering, the rule logs and the ledgers would have to survive two
  writers (conflict copies in `Sync conflicts/atlas/`); and the claim lives
  in the person's files. Reversing it later is harder than reversing A,
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

- A meeting is processed on the Mac he is using, within about ten minutes of
  the file arriving there, without his knowing which Mac was named.
- The silent drop is gone: a Mac that is not named says how many meetings
  wait and for whom.
- Every write stays single-writer, so the rule logs, the handled ledger
  (ADR-0028) and the proposals' numbering keep the assumption they were built
  on.

Harder, and what it costs:

- **Two Macs can still write the same file once.** If the named Mac wakes and
  stamps a file in the last minute before it pulls, the other Mac may have
  taken over meanwhile. Steps that are deterministic produce identical bytes
  and merge. A Claude run started on both leaves a conflict copy of the rule's
  log (`Sync conflicts/atlas/`) and possibly of the meeting; the ledger's
  recovery from a damaged ledger rebuilds from its entries, and Activity
  warns. **Rare, bounded and visible**, but not impossible. Activity's "took
  the automations over" lines are the measure: if the conflict happens about
  weekly, switch to the option kept in reserve.
- **"Waited ten minutes" is measured from the file's modified time on this
  Mac**, compared with the clock. A checkout's modified time is when this Mac
  wrote the file, which is when it arrived, not when the meeting ended. That
  it is a sound proxy for arrival (and survives a Mac whose clock jumps) is
  **not yet proven**; it is checked in the ticket (I2) with a fake clock and a
  clock-jump case, and the result recorded here before this record is
  accepted.
- **A Mac that merely pulled a Granola meeting writes an unstamped file** (the
  Granola pull runs on every Mac, ADR-0034). If the named Mac stays asleep for
  ten minutes after such a pull, the Mac that pulled takes the automations.
  This is intended, and means hand-over will happen as often as the person
  switches Macs and the named one sleeps.
- **The hand-over is a write to a synced settings file**, so it conflicts like
  any settings write (ADR-0025: this Mac's copy wins, the other is saved under
  `Sync conflicts/atlas/`). Two Macs taking over within one sync interval
  leave one winner after the next sync and a conflict copy of the settings.
- **The settings file records the Mac id and name** (as it already does). The
  hand-over compares ids, so renaming a Mac changes nothing (the reason
  `runsAutomationsHere` gives for using ids).
- **Cost to reverse: low.** Remove part 1; the Mac named in the settings stays
  named, parts 2 and 3 stand, and nothing written by the hand-over needs
  cleaning.
- **Unknown, to be settled in the tickets (I1–I3):** how the settings write
  and the first read behave when `.atlas/settings.md` cannot be read (the
  rule must do nothing, not guess); what the warning says on a Mac that has
  not completed a sync this session, when "last synced" is not known.
- **Status.** Proposed; accepted when the hand-over lands (Phase 1 of the
  meeting post-processing plan).

### Defaults taken

Decided on the plan's default, because the maintainer did not answer: **Q2**,
automatic hand-over after 10 minutes of waiting work, with the visible
"N meetings waiting for <Mac>" line. Overridden by what he did say: a
workflow that needs a particular Mac open is not acceptable.
