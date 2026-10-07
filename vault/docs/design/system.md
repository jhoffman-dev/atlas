---
type: doc
status: current
date: 2026-09-22
---

# The design system

What Phase 16 built, written down so later work stays in it. The target is the
approved mockups in `design/target/*.dc.html` (see `design/README.md`); the
reasoning is in [[reassessment-2026-09-22]]. This page is the vocabulary: the
tokens, the type scale, the pieces, and the rules. If a surface needs something
that is not here, add it here first.

**Notion's structure, the references' finish.** Sidebar on the ground; content
in one large rounded panel; a breadcrumb bar, a page tile and a big title; view
tabs as pills; properties as quiet rows. Near-white raised cards with soft
shadows and 16–24px radii, no 1px borders; one navy hero; a cyan-to-navy data
ramp; big 800-weight numerals over small labels; dark as deep navy with a cyan
edge-glow, not an inversion.

## Tokens

All in `apps/desktop/src/styles.css`, as **roles**. Light is `:root`, dark is
`[data-theme='dark']` and the `prefers-color-scheme` block; the three must
declare the same names. `styles.test.ts` fails if a token is read but never
declared, if a declared token is papered over with a fallback, or if a raw
colour (hex, `rgb()`, `hsl()`…) appears anywhere outside a token block.

| Role                                        | For                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| `--ground`                                  | The window behind everything; the sidebar sits straight on it              |
| `--panel`                                   | The big rounded work panel; also the tint inside an overlay                |
| `--raised`                                  | Cards, overlays, pills lifted off the panel                                |
| `--page`                                    | A note's reading sheet — paler than a view's panel                         |
| `--track`                                   | Segmented tracks, switches, fields                                         |
| `--chip` / `--chip-ink`                     | Small tinted chips: counts, key hints, a card's fields                     |
| `--hover`                                   | Any row or button under the pointer                                        |
| `--line`                                    | The hairline between rows of a table or list — nothing else                |
| `--ink`, `--ink-2`, `--ink-3`               | Text: primary, secondary, quiet (labels, counts, paths)                    |
| `--ink-body`                                | Running prose in a note, a step softer than `--ink`                        |
| `--accent` / `--accent-ink`                 | The one thing to act on: primary button, selected tab, a switch that is on |
| `--accent-text`                             | Accent as text: a link, a matched word, a highlighted row's label          |
| `--you` / `--you-ink`                       | Accent as a tint: the highlighted row in a menu or palette, "You" chips    |
| `--active`, `--active-ink`, `--active-icon` | The sidebar's current row                                                  |
| `--navy`, `--tile-ink`                      | Icon tiles (page, settings, app)                                           |
| `--hero`, `--hero-ink`, `--hero-muted`      | The navy hero card — the screen's one gradient                             |
| `--status-*` (fill, ink, dot)               | Status pills, by tone: backlog, next, doing, review, done                  |
| `--danger`, `--warning`, `--success`        | What happened — never decoration                                           |
| `--code-*`                                  | Code blocks and syntax highlighting                                        |
| `--scrim`                                   | The dimmed, ground-tinted backdrop behind an overlay                       |
| `--artifact-canvas`                         | Behind a saved artifact's frame: white in both themes, as the page assumes |

### Depth

Shadows carry a hierarchy. If everything is raised, nothing is.

| Shadow             | Means                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| none               | The ground: the page, the sidebar, a row in a list                                   |
| `--shadow-soft`    | A small lifted control: the knob of a switch, Today in the month nav                 |
| `--shadow-card`    | A resting card                                                                       |
| `--shadow-tile`    | Raised — interactive under the pointer, or the thing to read first                   |
| `--shadow-accent`  | The glow under a filled accent control                                               |
| `--shadow-hero`    | The hero card                                                                        |
| `--shadow-overlay` | Foremost: palettes, Settings, menus, popovers. In dark it carries the cyan edge-glow |

In dark every shadow includes a faint 1px ring, because a shadow alone does not
read on navy.

### Radius

`--radius-chip` 6 · `--radius-control` 9 · `--radius-button` 10 ·
`--radius-card` 16 · `--radius-panel` 22 (the panel, and every overlay) ·
`--radius-hero` 24 · `--radius-pill` for tracks, tabs, buttons and chips that
are pills. Menus and editor popups use 14.

## Type

Manrope, bundled (never fetched), 400–800, tabular numerals for counts.

| Token             | Size | For                                         |
| ----------------- | ---- | ------------------------------------------- |
| `--text-label`    | 11   | Section labels in capitals; key chips       |
| `--text-small`    | 12.5 | Counts, captions, paths, secondary UI       |
| `--text-ui`       | 13.5 | Sidebar rows, controls, menus, breadcrumbs  |
| `--text-body`     | 14   | Dense running text, titles in lists         |
| `--text-body-lg`  | 16   | Prose meant to be read; the palette's field |
| `--text-card`     | 17   | Card and section titles                     |
| `--text-subtitle` | 21   | An overlay's title                          |
| `--text-title`    | 30   | Page titles                                 |
| `--text-hero`     | 38   | The big numbers                             |

Titles are 800 with `--tracking-title`. Capitals are for the sidebar's section
labels only — a card or a section inside an overlay is titled in sentence case,
bold, with an icon. Monospace is for code and for things that are literally
code (a command, a file path in Settings), never for a title or a label.

## Pieces

In `packages/ui`, styled from the primitives in `styles.css`.

- **PageBar** — the breadcrumb bar: crumb icon, parent (never `.atlas/…`),
  page name, "Saved", the star and the page menu.
- **PageHead** — the icon tile, the title (editable on a note), an optional
  line under it, and a slot on the right.
- **ViewToolbar** — sibling views as pill tabs on the left; the layout's own
  controls (a calendar's `CalendarMonthNav`), Filter, Sort and the primary
  "New …" on the right. When both cannot fit, the right group wraps under the
  tabs instead of squeezing them.
- **StatusPill** — a status in its tone: fill, dot, label. Any `select`
  property in a table, list or gallery is drawn as one.
- **Chips** — `.board__field` / `.note-chip`: a small tinted chip with an icon
  that says what the value is (`# Phase 14`, a person, a duration).
  `cardChips` in the domain decides the icon and wording.
- **Cards** — `.card`, `.card--raised`, `.card--interactive`. Board cards,
  gallery cards, dashboard widgets, Settings sections (`SettingsCard`) and the
  source panel are all this.
- **Hero** — the navy gradient card: the dashboard's hero widget, and the
  choose-folder screen. One per screen.
- **Buttons** — `.btn` pills: `--primary` (accent, one per surface),
  `--secondary` (raised), `--tinted` (a secondary action on a raised card),
  `--ghost`. Icon buttons are `.icon-button`.
- **Segmented control and switch** — `.segmented` (a pill track, the chosen
  option filled; `--quiet` lifts it as a raised pill instead), and `.toggle`
  in the same language: a lifted knob on a pill track, accent when on.
- **Keys** — `Key` and `KeyHints`: a shortcut as a small chip (`⌘K`, `↵`,
  `esc`); an overlay lists the keys it answers to along its foot. Always
  `aria-hidden` — the control carries its own name.
- **Overlays** — the search and capture palettes and Settings share
  `.palette__backdrop` (the scrim with a slight blur) and `.palette` (raised,
  panel radius, `--shadow-overlay`). Rows are 44px with a kind tile, the title,
  and a quiet second line; the active row is tinted `--you` with its icon in
  `--active-icon`; matched words are `--accent-text`, not a highlighter.
- **Menus and popups** — Base UI menus (`.menu`), the editor's slash menu and
  `[[` suggestions (`.suggestions`): a raised card, 36px rows with an icon,
  shortcuts as key chips, groups split by a hairline divider.
- **Pages editing** (P17-01) — a row's menu opens from its "Options" button
  (after the star), a right-click or Shift+F10, and is the same `.menu` as
  the page's "…", built from `MenuItems`; a destructive command sits last,
  below a divider, in `--danger`. Names are edited in place (`.tree__rename`).
  "Move to…" is a palette (`MovePicker`); a delete asks first in an alert
  dialog (`.confirm`, `.btn--danger`, Cancel focused). Both are overlays under
  the one-overlay rule. Styles live in their own section of `styles.css`.
- **Artifacts** (P17-07) — `ArtifactViewer`: the saved copy as a raised
  card under a note's properties, a quiet bar (label, Open link, Full screen,
  Reload as ghost pills) over a sandboxed frame on `--artifact-canvas`; Full
  screen fills the pane. `FileDrop`: a `--track` well with a glyph, words and
  Pick files / Pick a folder, tinted `--you` with the ring while a file is over
  it — the drop zone in New artifact (a palette like New type) and on a note
  with no copy. `ArtifactCardFace`: a gallery card's front when the copy has no
  picture — the kind's glyph over the title on `--you`, never a screenshot. A
  gallery with `groupBy` draws a heading and count per group.
- **Images in a note** (U-12) — an image sits in the text at its own size,
  capped at the column, with `--radius-card` corners; selected, it takes a
  3px `--accent` ring and its alt text opens under it as a small popover (a
  `--raised` card, radius 14, `--shadow-overlay`, a `--track` field). An image
  on its way in is a `--chip` pill with a spinner and "Adding name…"; one that
  was refused is the same pill tinted toward `--danger`, with a Dismiss ×.
  Both are editor decorations and never reach the file. `attachments/` at the
  vault root sorts after the root's notes in Pages, just before `.atlas`.
- **Floating add button** (U-13) — `FloatingAddButton`: a 56px `--accent`
  circle with `--shadow-tile` and `--shadow-accent` (the cyan glow in dark),
  resting at one of eight anchors over the content panel (`fabAnchorPoint`),
  clear of the page bar and the sidebar. Several types open a speed dial of
  raised pills sliding toward the panel's middle; one type opens
  `QuickAddPopover`, the menus' raised card. After an add, a `Toast` on
  `--hero` at the panels' foot. Styles in their own section of `styles.css`.
- **Bookmarks** (U-21) — a link shown as a card in a note: a resting
  `--raised` card, `--radius-card`, `--shadow-card`, lifting to `--shadow-tile`
  under the pointer. Title (`--text-body-lg`, 800), a two-line summary in
  `--ink-2`, and the note's place in `--ink-3` with a doc icon; the page's
  picture on the right at 16:10, or the page icon on `--you`. Selected, a 3px
  `--accent` ring, as an image. Missing is tinted toward `--danger` and says
  so; archived wears an "Archived" chip. Its "…" (and a link's, floating over
  it under the pointer) opens the link's `.menu`: Open note, Show as
  bookmark / Show as link. The `[[` list's foot lists ↵ Link, ⇧↵ Bookmark.
- **Notices** — a problem above the panels (`.notice`) or under the page bar
  (`.page-conflict`): a card tinted toward `--danger`, its ways out as small
  raised pills (`.viewer__resolve`).

## Rules

1. **Roles, never colours.** A component reads a token. A new colour is a new
   token, declared in light and both dark blocks.
2. **Separation is a surface and a shadow**, not a border. The only 1px lines
   are the hairlines between rows of a table or list, and the view toolbar's
   underline.
3. **One accent per surface.** The primary button, the selected tab. Everything
   else is a neutral or a status tone.
4. **Internals stay off screen.** No `.atlas/`, no `.md`, no SQL, no raw
   markdown in a summary (`plainText`), no unlabelled value (`cardChips`).
5. **Every overlay is the same overlay.** Backdrop, radius, shadow, 44px rows,
   key hints — and only one is ever up (`apps/desktop/src/overlay.ts`).
6. **Judge it side by side.** `pnpm shots && pnpm design:compare`, both themes,
   before calling a surface done. `pnpm shots` covers every surface, overlays
   and editor popups included.
