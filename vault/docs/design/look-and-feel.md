---
type: doc
status: brief
date: 2026-09-20
---

# Look and feel — the brief for Phase 13

> Superseded for the look by [[system]] (Phase 16): the tokens, type scale,
> pieces and rules the app is built from now. The sidebar section below still
> holds.

The reference images (third-party finance dashboards) are not kept in the
repository; what transferred from them is the _treatment_, not the content —
surface, depth, colour and rhythm, not layout to copy.

## What the images actually establish

**Cards float; they are not boxed.** There is no 1px border anywhere in the
reference. Separation comes from a lighter surface sitting on a tinted ground
with a soft shadow under it, and a large corner radius. Atlas today draws
`1px solid var(--line)` on nearly everything; that is the single biggest visual
difference, and changing it touches almost every component.

**Light and dark are equal.** The reference shows both, side by side, as the
same design — not a dark theme with a pale fallback. Light is a lavender-grey
ground (not white) with near-white cards. Dark is a deep navy ground with a
lifted navy card. Atlas currently has a dark-first palette and a light mode that
was an afterthought.

**One accent, used as a ramp.** Cyan through to blue, most saturated on the
thing you are meant to act on or read first. Everything else is a neutral. The
reference never uses a second hue for decoration — only for a chart series that
needs to be told apart, and even then it reaches for dark navy before it reaches
for another colour.

**Numbers are the hero.** A small, quiet, uppercase label with a large figure
under it. The label is never the same size as the value. Atlas's dashboards
already do this; nothing else in the app does.

**Controls are pills.** Segmented controls, tabs and toggles are rounded all the
way, and the selected one is filled with the accent. This replaces the
underline-tab and bordered-button patterns Atlas uses now.

**Density is deliberate.** Generous padding inside cards, generous gaps between
them. The reference is not information-dense; it is calm. That is a real trade
against how much of a board or table fits on screen, and it should be settled
per surface rather than globally.

## What must not be copied

- **Gradient fills on data.** The reference is selling a look. A chart whose
  bars fade are harder to compare than flat ones. One gradient — the hero card —
  is enough.
- **Depth for its own sake.** Shadows carry a hierarchy: raised means
  interactive or foremost. If everything is raised, nothing is.
- **The editor becoming a dashboard.** The card treatment reaches the editor —
  properties, body and backlinks each in their own panel — but the body panel is
  a reading surface. Prose keeps its measure, its line height and its margins.
  A note should be nicer to read after this phase, not busier.

## The sidebar

Five peer sections, each collapsible, in this order:

```
▾ FAVORITES        starred notes, anything at all, in the order you set
▾ TYPES            task · person · company — count beside each
▾ VIEWS            Board · Calendar · Roadmap · Inbox · Today
▾ DASHBOARDS       Progress
▾ USER SPACE       the vault as it is on disk: folders and notes
```

Today the sidebar is one flat file tree with `.atlas` sitting in it like any
other folder, so types, views and dashboards are only findable if you already
know where they live. The app does considerably more than its sidebar admits.

Rules that follow from the rest of the project:

- **A favourite is a property of the note** (`favorite: true` in frontmatter),
  not app state in a database. Same reason a view is a note: it survives, it
  diffs, and it is still there without Atlas.
- **Types, Views and Dashboards are derived**, read from `.atlas/` and the index
  — never a second list to keep in step.
- **User space is the vault, minus what the other sections already show.** That
  means the `.atlas` subfolders another section lists — `views` and
  `dashboards` — and nothing else. `.atlas` itself stays visible, because it
  also holds the type definitions, the templates, the sources and `settings.md`,
  and those have no section of their own. Hiding the whole folder leaves ten
  notes in this vault with nowhere to be clicked, which is what the first draft
  of this brief did. Adding a section for something in `.atlas` means adding its
  path to the hidden set; a new subfolder nobody has sectioned stays visible,
  which is the safe direction to fail in.
- Collapsed/expanded state is per-viewer convenience and may live in local
  storage. The favourites themselves may not.

## How to judge it

The test is not "does it look like the reference". It is:

1. Can you find a view, a dashboard and a type without knowing the folder layout?
2. Is a long note still pleasant to read for ten minutes?
3. Does the board still show enough cards to be useful?
4. Does light mode look designed rather than inverted?
5. Does the whole thing still respond instantly on a 2,000-note vault?
