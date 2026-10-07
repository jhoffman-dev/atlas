---
type: doc
status: done
date: 2026-09-21
---

# Phase 13, judged against its own brief

`look-and-feel.md` ends with five questions and says the test is not "does it
look like the reference". Here are the answers, including the ones that are not
flattering.

## 1. Can you find a view, a dashboard and a type without knowing the folder layout?

**Yes**, and this is the biggest single improvement in the phase. Five sections —
Favorites, Types, Views, Dashboards, User space — every one derived from the
notes rather than from a list that can drift. A type row opens a generated table
of that type's notes.

The caveat is one the brief caused: its first draft said `.atlas` "is the other
four sections", which is false, and hiding the whole folder left ten notes — the
type definitions, the templates, the source — with nowhere to be clicked. Fixed
in P13-09, and the brief's wording with it.

## 2. Is a long note still pleasant to read for ten minutes?

**Yes.** The column widened from 78ch to 86ch so the new panel padding is paid
for out of the page rather than out of the measure; prose still runs about 76ch.
Checked by reading a real note in both themes, not only by the suite.

The editor panel fills the height available, so a short note sits in a tall card
with a lot of empty space below it. That is deliberate — it is the click target
that continues writing — but it is the thing most likely to feel wrong, and it
is worth revisiting if it does.

## 3. Does the board still show enough cards to be useful?

**Probably, but I cannot prove it.** Three cards per column are comfortable at
1440px with a summary line each. What I do not have is a before-and-after count:
no baseline was measured before the restyle, so "the density trade was settled
per surface" is a claim about intent rather than a measurement. If it turns out
to show fewer cards than it used to, that is a real regression nobody has the
numbers to catch.

## 4. Does light mode look designed rather than inverted?

**Yes.** Light is the default now, and it is a lavender-grey ground under
near-white cards rather than white with the dark theme's rules reversed. The two
themes are defined as siblings — one raw palette, assigned to roles twice.

Contrast is not a claim: `e2e/theme.spec.ts` reads the tokens as they resolve in
WebKit and asserts twelve pairs clear WCAG AA in both themes. The tightest are
around 4.7:1, and two values had to move during the work to get there.

## 5. Does the whole thing still respond instantly on a 2,000-note vault?

**Yes.** Measured: the tree is visible in 358ms, the index is built in 1.9s, and
a note opens in 36ms. Only User space is virtualised, and the 2,000-note e2e now
also asserts the derived sections stay empty when nothing matches them, so a
mistake there cannot quietly put two thousand rows in the DOM.

Those timings are recorded rather than asserted. A timing assertion is not
deterministic, and a flaky test is a bug.

## What shipped knowingly broken

- **Drag has no keyboard path.** The board, calendar and timeline all use native
  HTML5 drag. This is an accessibility hole, it shipped on purpose, and Phase 14
  closes it with dnd-kit.
- **The sidebar tree has no arrow-key navigation** (P13-10). It never had; the
  favourite stars are the first keyboard route into a row the app has had.
- **A dashboard that overflows clips its last card mid-card.** It scrolls, so
  nothing is lost, but the cut reads as broken.
- **Chart geometry is hand-rolled.** Behind a seam, named after the `d3` each
  function becomes, so Phase 14 replaces four function bodies rather than the
  charts.

## What the phase cost that was not in the plan

Seven bugs found by looking at the app rather than by a failing test, including
one that could destroy a dashboard: the properties panel offered a structured
value in a text box, so one keystroke in `widgets` wrote `[object Object]` over
the lot.

Then a code review and an adversarial pass found **fifteen more**, and this
section originally stopped at the paragraph above — which is the part worth
recording.

## Where this document was wrong

The first draft framed the phase's risk as density and virtualisation. A code
review said plainly that it was fooling itself, and it was right: the real
exposure was the **cross-pane write path**, and it was half-built. The favourite
star was routed through the pane holding the note exactly as designed; every
other write — a board drag, a table cell, a reschedule, a Gantt bar, and the
view's own sort — was not. A refused save had no way out and lost the work on
close. And nothing anywhere tested a write to a note that was open in a pane, in
either direction, which is why four bugs lived there undisturbed.

The worst of them was found by neither pass, but by the fixer sent to clear up
after them. The editor took its document as tiptap's `content`, which is read
once at creation — so a pane told to re-read updated its state, its star and its
properties and **kept the old text on screen while adopting the new
modification time**. The next keystroke then saved the stale body over the other
pane's write, and the save was _accepted_. Every other bug in this set at least
had the decency to be refused.

Two sequencing lessons worth keeping:

- **The review called `vault-visibility.ts` clean. The attack found it judged a
  note by its own name and never the folder holding it** — safe only because
  Rust skipped dotted directories first, which is the duplicated rule ADR-0005
  forbids relying on. Two passes, not one.
- **A correct rule that nothing calls is worth nothing.** `openInPane` landed as
  a total domain function with tests while the call site went on composing the
  old pair, so the user-visible bug was live the whole time the card said fixed.

The gate was green throughout all of it.
