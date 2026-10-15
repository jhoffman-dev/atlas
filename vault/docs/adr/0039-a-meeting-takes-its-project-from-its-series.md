---
type: adr
id: ADR-0039
title: A meeting takes its project from its series, and the declared step may file one
status: proposed
date: 2026-10-15
---

# ADR-0039 — A meeting takes its project from its series, and the declared step may file one

## Context

The maintainer (#227): "It will take far too long for me to go through 643
meetings … many meetings are recurring and have obvious projects based on
previous meetings in the recurrence." Measured then: 647 meetings, 78 with no
`project`, 56 of those from Granola — many the second copy of a meeting Gemini
also recorded.

No importer writes a calendar event id or a recurrence id into a meeting's
frontmatter (Gemini's n8n mapping writes the mail's id as `external_id`;
Granola's pull reads its calendar event for the time and invitees only). So a
series cannot be told by an id; it has to be told by what the notes do hold.

Until now a meeting's `project` was only ever proposed (P29-04), and a Claude
step never edited a note (ADR-0028), the declared step's own tasks excepted
(ADR-0036).

## Decision

1. **A deterministic rule, in the domain** (`suggestMeetingProject`), in order:
   - **The twin**: a meeting from the other provider on the same day, starting
     within 15 minutes, sharing a person other than the owner or the same
     title. If it is filed, that project, high.
   - **The series**: meetings of the same title — letters and digits only,
     case and accents folded — that share a person other than the owner with
     it; by title alone when neither lists anyone, which is medium at most.
     Of the series' 6 days nearest the meeting (either side of it), one vote
     per project per day; a tie goes to the nearest day.
     **High** when 2 or more days agree, two thirds of them, the nearest
     among them; **medium** on a plain majority or a series of one; **low**
     on a tie or no majority.
   - Otherwise nothing.

   Only an open project or area votes: never a resource or one archived by
   its PARA (#213), one in the Archive, or one done, cancelled or dropped.
   The rule says why in a sentence: "Same series as 2026-10-07 Larkspur
   standup: 5 of its last 6 were filed under Ledger."

2. **On arrival** the meeting-links step (P29-04) sets `project` when the rule
   is high and the meeting's `project` holds nothing; otherwise it proposes
   the rule's project, in place of the one its people tie it to. Never over a
   project already set. The Activity line names it; undoing the link run puts
   it back.

3. **The declared step may file a meeting** — the one exception to "a step
   never edits" beyond ADR-0036's tasks. For a meeting with no project, the
   "After a meeting" step is shown the vault's open projects and areas and may
   answer `"project": { "path", "confidence", "why" }` beside its items. A
   path it was not shown is left out and said. High sets `project`, logged as
   a run's `set` line, which "Undo last run" reverses (only `project`, only
   for the declared step). Anything less is one Inbox proposal, known by the
   same id as linking's own, so a meeting waits on one project proposal.

4. **A backfill** in the Inbox lists every meeting outside the Archive with no
   project, with the rule's suggestion and reason, the high ones ticked. It
   writes only `project`, leaves any meeting filed since the preview, and is
   undone from the offer.

## Alternatives considered

- **Ask Claude for every meeting.** Most meetings recur; the rule answers them
  for free, explains itself, and needs no network. Claude is the fallback.
- **The cross-provider copy match of ADR-0036** (overlapping windows, Jaccard
  0.5) for the twin. That rule decides what is archived, so it is strict and
  provisional; this one only proposes or sets a value that is undone in one
  click, so it is looser. They change for different reasons and stay apart.
- **Majority over the whole series.** A series drifts between projects over a
  year; the latest days say where it is filed now.

## Consequences

- The constants (15 minutes, 6 days, two thirds) are starting values from the
  maintainer's vault: 39 of its 79 unfiled meetings come out high, 10 medium,
  2 low, 28 with nothing.
- A meeting filed on arrival has no undo in the app yet: the link run that
  could reverse it is not kept anywhere a person can reach (as for its people
  and companies). Clearing the property is the way back.
- The prompt note is the person's (P29-05), so the choice is asked for by the
  output's own instructions, which Atlas owns, not by the prompt.
