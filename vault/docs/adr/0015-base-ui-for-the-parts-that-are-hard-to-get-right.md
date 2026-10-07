---
type: adr
status: accepted
date: 2026-09-22
---

# Base UI for the parts that are hard to get right

## Context

James asked whether hand-rolling the UI would be maintainable. Most of it is:
tokens, cards, buttons, inputs and chips are CSS, cheap to own and cheap to
replace. Two things are not.

**Overlays.** There are four hand-rolled ones — the search palette, the capture
palette, the new-note menu and the editor's suggestion popup — and each needs
focus trapping, focus restoration, escape handling, scroll locking,
click-outside versus focus-outside, portals and correct ARIA. That is the code
that is subtly wrong for years rather than loudly wrong for an afternoon.

**Drag.** The board, calendar and timeline all use native HTML5 drag, which has
no keyboard path at all. That shipped in Phase 13 knowingly and is an
accessibility hole, not a future one.

A full component kit — MUI, Mantine, Chakra, Ant — was considered and rejected.
Each brings its own theming system, which would fight the Phase 13 tokens rather
than build on them; each is styled for a _generic_ good look, and the last 20%
of a _specific_ look is where a kit is fought hardest; and each would add real
weight to a bundle already past 1 MB.

## Decision

**Headless libraries for exactly those two things, keeping our tokens as the
source of truth.**

- **`@base-ui/react`** — dialogs, popovers, menus, tooltips, tabs.
- **dnd-kit** — board, calendar and timeline drag, with keyboard and touch.
- **`d3-shape` + `d3-scale`** — donut, line and radar geometry only. Atlas goes
  on rendering its own SVG, so the flat-fill look survives. Measured cost on
  landing: **+11.7 kB gzipped**, mostly `scaleLinear` dragging `d3-interpolate`,
  `d3-color` and `d3-format` behind it rather than `d3-shape`, which is small.

### Why Base UI rather than Radix

The earlier recommendation in `PLAN.md` favoured Radix on reputation. The card
for this phase said to check current maintenance activity rather than trust
that, and checking reversed it. Measured 2026-09-22:

|                       | Radix Primitives                              | Base UI                          |
| --------------------- | --------------------------------------------- | -------------------------------- |
| Latest stable         | 1.6.7                                         | 1.8.0                            |
| Last commit           | 2026-07-31                                    | 2026-09-22                       |
| Commits, last 30 days | 0                                             | 100+                             |
| Release cadence       | `next` tag stopped at July release candidates | monthly, April through September |
| Weekly downloads      | 9.80M                                         | 9.79M                            |

Base UI has caught Radix on download volume outright while shipping monthly.
Radix has been quiet for roughly eight weeks, which for a mature library is not
abandonment — but the engineers who built Radix now build Base UI at MUI, and
that makes the direction one-way rather than ambiguous.

Base UI's `date-fns` and `@date-fns/tz` peers are marked optional and are only
needed for its date components, which we do not use.

### Which dnd-kit — measured 2026-09-22 (P14-03)

dnd-kit ships in two generations from the same repository, so "dnd-kit" was not
yet a choice. Measured rather than remembered:

|                    | `@dnd-kit/core` (classic)          | `@dnd-kit/react` (new)                  |
| ------------------ | ---------------------------------- | --------------------------------------- |
| Latest stable      | 6.3.1                              | 0.5.0                                   |
| Last release       | 2024-12-05                         | 2026-06-11 (betas to 2026-09-12)        |
| Where commits land | `master`, untouched since Dec 2024 | `main`: 10 commits in 30 days, 16 in 90 |
| API stability      | 6.x, stable for two years          | 0.x; 0.2, 0.3, 0.4 and 0.5 all in 2026  |
| Weekly downloads   | 18.0M                              | 0.94M                                   |
| React 19 peer      | `>=16.8.0` (open-ended)            | `^18 \|\| ^19`                          |
| Keyboard step      | `coordinateGetter(event, context)` | a fixed pixel `offset` only             |

**We use the classic `@dnd-kit/core`**, and not `@dnd-kit/sortable`: nothing
here reorders. The deciding row is the last one. Every surface needs an arrow
key to mean "the next column" or "the next day", and the new sensor can only
move a fixed number of pixels — wrong for a board whose columns and a calendar
whose days are sized by the window. The classic sensor hands the step to a
function, which is exactly the hook this needs. Its 0.x rival is also still
fixing React signal subscriptions (September 2026) and has broken its API four
times this year.

The cost is knowingly taken: the classic line is frozen, and the direction of
travel is towards the new one. The exposure is small — three components and
`packages/ui/src/drag/` — and the snapping and announcement rules are pure
functions that owe dnd-kit nothing, so a move to `@dnd-kit/react` once its
keyboard sensor can snap is a rewrite of the glue, not of the rules. Re-measure
when that is considered.

## Consequences

- **Our tokens stay the source of truth.** These libraries ship behaviour and
  no styling, so Phase 13's design system is built on rather than fought.
- **Adoption is per component.** A dialog can move without a button moving.
- **The look must not change.** Phase 14 is a behaviour swap; a diff showing
  visual churn means something has gone wrong.
- **Younger API surface, fewer examples to crib.** This is the real cost of
  choosing Base UI, and it is accepted knowingly.
- **What stays ours:** tokens, themes, card, button, input, chip, segmented
  control, the vault tree and the Gantt. No library gives you a good vault tree,
  and the Gantt's domain logic is already pure and tested.
- This decision is dated. If it is revisited, re-measure rather than
  re-remember — measuring is what changed the answer this time.
