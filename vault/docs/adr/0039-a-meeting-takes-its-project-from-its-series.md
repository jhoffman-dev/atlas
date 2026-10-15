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

1. **A deterministic rule, in the domain** (`suggestMeetingProject`). When it
   is unsure it does not file: a wrong project written at high confidence is
   the failure that matters. In order:
   - **The twin**: a meeting from another provider on the same day, starting
     **less than** 15 minutes apart, with the **same series title** (letters
     and digits only, case and accents folded) **and** a person in common
     other than the owner — or, for a title that is not generic, nobody listed
     on one side to compare. Never people alone under another title; never a
     title alone when both list who was there. Of several filed twins, the
     nearest start is named, and only when **every** one is filed under the
     same open project; twins filed apart, or under a closed project, give no
     twin answer, and whatever the series says is then medium at most.
   - **The series**: meetings of the same series title **and much the same
     people**: at least half shared of all (Jaccard ≥ 0.5) of the Person notes
     both link, or else of the attendees both list, owner aside — the same 1:1
     counterpart, or most of a team, never one colleague two teams share. By
     title alone only when one side lists nobody, and then medium at most.
   - A **generic title** — one made only of words such as "1:1", "Standup",
     "Daily", "Weekly", "Sync", "Team", "Meeting", "Check-in", "Catch up" —
     never ties two meetings by itself: neither a twin nor a series.
   - **Voting**: of the series' 6 days nearest the meeting (either side of it),
     one vote per project per day; a tie goes to the nearest day. A meeting
     filed under a project now **closed** (done, cancelled, dropped, archived,
     or no project at all) still holds its day and votes "closed": when closed
     wins, nothing is suggested, and when the nearest day is closed, the answer
     is low at most — an older open project is never revived at high.
     **High** when 2 or more days agree, two thirds of them, the nearest
     among them; **medium** on a plain majority or a series of one; **low**
     on a tie, no majority, or a closed nearest day.
   - **The owner** is left out of every meeting's people by the profile's name,
     the vault's `selfEmails`, and every name, alias and address on the
     owner's own Person note — else every meeting shares a person. When the
     owner cannot be told at all (no name, address or Person note), every
     series and twin answer is medium at most: proposed, never filed.
   - Otherwise nothing.

   Only an open project or area is suggested: never a resource or one archived
   by its PARA (#213), one in the Archive, or one done, cancelled or dropped.
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
   a run's `set` line, which "Undo last run" reverses — only `project`, only
   for the declared step, only on a note that is a meeting when undone, and
   only back to nothing (absent, empty or `[]`), as the step only fills a
   `project` that holds nothing; any other line is refused and named, since a
   log is a note anyone can write (A25-01). Anything less than high is one
   Inbox proposal, known by the same id as linking's own, so a meeting waits
   on one project proposal. A meeting read in parts whose parts chose
   different projects is not filed: the surest choice is proposed, medium at
   most, naming the others.

4. **A backfill** in the Inbox lists every meeting outside the Archive with no
   project, with the rule's suggestion and reason, the high ones ticked. When
   the preview is read again (after a run, or as the page comes back), a row
   already shown keeps the person's tick; only a new row, or one whose
   suggested project changed, is ticked by the rule. It writes only
   `project`, leaves any meeting filed since the preview, and is undone from
   the offer.

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
  maintainer's vault: 39 of its 79 unfiled meetings came out high, 10 medium,
  2 low, 28 with nothing. Under the stricter rules above (PR #228 review), 40
  of 80 are high, 9 medium, 2 low, 29 nothing: every high stayed high, one
  medium series-of-one match dropped, and one meeting arrived since.
- The generic-title words, the half-overlap of people and the closed-project
  vote all lean towards not filing: a meeting left for a person to tick costs
  a click, one filed under the wrong project costs trust.
- A meeting filed on arrival has no undo in the app yet: the link run that
  could reverse it is not kept anywhere a person can reach (as for its people
  and companies). Clearing the property is the way back.
- The prompt note is the person's (P29-05), so the choice is asked for by the
  output's own instructions, which Atlas owns, not by the prompt.
