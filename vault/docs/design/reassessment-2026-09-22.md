---
type: doc
status: proposed
date: 2026-09-22
---

# The look, reassessed

James, 2026-09-22: "the UI doesn't look anything like I requested. It looks like
an amateur that doesn't know anything about UI/UX made it. Please reassess
against the inspirational images and consider Notion UI as a rough guideline."

He is right. Phase 13 changed tokens and surfaces and judged itself against its
own five questions — none of which was "does it look designed". This note is
the reassessment; the target is a mockup, not a token list:
**https://claude.ai/artifact/3HyyMqVgBFNcdg8LModFKS** (dashboard light and
dark, board, table in dark, note page, sidebar).

Also found: the Atlas window James had open was a dev build from 20 September
serving its frontend from a deleted agent worktree — none of Phase 13's sidebar
was in it. The critique stands against current `main` regardless; the
screenshots below were taken from it.

## What reads as amateur, in order of damage

1. **Internals on screen.** A Save button on every page; "SQL" on every
   dashboard card; `atlas: dashboard / widgets: 8 items` printed above a
   dashboard; "Linked from — No other note links here yet" under every view
   and dashboard; `.md` on names; `.atlas` in the sidebar; "208 notes indexed ·
   Rebuild · Atlas 0.1.0" in a status bar.
2. **No page anatomy.** The title is a small grey monospace label. No icon, no
   header, no view tabs, no breadcrumb. Notion's backbone — breadcrumb bar,
   big icon and title, view tabs, properties as quiet rows — is absent.
3. **A sidebar with no hierarchy.** 17px rows, no icons, disclosure dots, a
   temp-folder vault name, everything the same weight.
4. **Raw data.** Status as plain text, every title a bright link, markdown
   backticks in summaries, unlabelled chips ("14", "bug-fixer"), phases sorted
   as strings (0, 1, 10, 11…), the Task template shown as a card.
5. **Charts that ignore the reference.** One flat blue, a hollow circle on
   every point. No cyan-to-navy ramp, no highlighted current bar, no navy hero
   card, no raised number tiles, no centre disc on the donut.
6. **Type.** The stock system font with no scale — title, label and body sit
   within a few pixels of each other. Controls float oddly (the collapse and
   split buttons).

## The direction

**Notion's structure, the references' finish.**

- **Structure (Notion):** sidebar on the ground colour with compact 29px icon
  rows and small-caps section labels; content in one large rounded panel;
  breadcrumb bar; page icon tile + 30–36px title; view tabs as pills with the
  selected one filled; Filter / Sort / New on the right; properties as
  icon + label + value rows; autosave with a quiet "Saved" instead of a button.
- **Finish (references):** lavender-grey ground, near-white raised cards with
  soft shadows and 22–24px radii, no 1px borders; one navy hero card with the
  only gradient; cyan-to-navy data ramp with the current value highlighted and
  glowing; big 800-weight numerals over small labels; pill segmented controls;
  dark theme as deep navy with cyan edge-glow rather than an inversion.
- **Type:** Manrope (bundled, not fetched), 400–800, tabular numerals; a real
  scale (12.5 / 13.5 / 14–16 body / 17 card title / 30–36 page title / 34–40
  hero numbers).

## How to judge it this time

Side by side: the mockup artboard next to a screenshot of the built app at
1440×900, same data, both themes. A surface is done when the two are hard to
tell apart — not when a checklist passes.
