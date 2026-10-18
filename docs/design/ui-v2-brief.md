# Atlas UI v2 — "Dense & Calm": brief for planning

**Status:** approved direction from James, 2026-10-17. Plan the work first; don't start building yet.
**Mockups:** `design/target/*.dc.html` (moved there from `design/v2/` in #270), in the Design Component format. The _Mockups_ section below explains how to render them. These files are the visual reference. Where this brief and a mockup disagree, the mockup wins on look and this brief wins on behavior.

---

## 1. What we are doing and why

The Phase 16 look feels busy: floating rounded panels with shadows everywhere, big navy icon tiles, a filled pill on every chip and tab, heavy font weights, and a 200px page header. It also uses screen space poorly. James wants **as much information on screen as possible, well organized and easy to scan**:

- **Contrast:** high (near-black text on white).
- **Color:** minimal and muted, in pastels.
- **Corners:** small radii.
- **Separation:** hairlines instead of cards.
- **Behavior:** fills the gaps Claude Code had to guess at the first time around.

References he liked: Linear (but higher contrast), ClickUp, Wrike, PandaDoc dashboards, Notion's typography (but not its wasted space), and the "Spherule" orders screen (a third-party design shot, kept out of this public repo; James has the image locally as `design/original-23390b1e91dfe28f7cd4837427021f5d.webp`). He dislikes Things 3: too big and too colorful.

**Out of scope for now:** columns in the note editor, and side-peek. Both were considered and dropped.

---

## 2. Mockups

| File                                      | Surface                                                            | Notes                   |
| ----------------------------------------- | ------------------------------------------------------------------ | ----------------------- |
| `Main.dc.html`                            | Board (Task board)                                                 | `theme` prop light/dark |
| `Table.dc.html`                           | All tasks / Task table, grouped by status                          | `theme` prop            |
| `Dashboard.dc.html`                       | Progress dashboard                                                 | `theme` prop            |
| `BoardDark`, `TableDark`, `DashboardDark` | Dark renders of the three above                                    | thin wrappers           |
| `Sidebar.dc.html`                         | Left sidebar, imported by every screen                             | `active` prop           |
| `Tokens.dc.html`                          | **Tokens, sizes, components and the rules list.** Read this first. |                         |
| `FlowTable.dc.html`                       | Table: edit in place, right sidebar, toast, tabs                   | light only              |
| `FlowPeek.dc.html`                        | Center peek over the table, plus a link preview                    | light only              |
| `FlowSplit.dc.html`                       | Split view with tabs in each pane; right sidebar hidden            | light only              |
| `FlowType.dc.html`                        | Type editor in the right sidebar (Meeting type)                    | light only              |
| `FlowInbox.dc.html`                       | Inbox: "To clarify" plus proposals                                 | light only              |

`canvas.json` is the original canvas index (layout only); you can ignore it.

**Rendering:** `pnpm design:refs` currently reads `design/target/`. Either point it at `design/v2/` or move the v2 files into `target/` as the first step of the plan, and update `design/README.md`'s surface→mockup table. Existing surfaces map to `Main`, `Table`, `Dashboard` and `Sidebar`. The five `Flow*` boards are new surfaces or states that `pnpm shots` will need to capture: peek-open, split, type-editor, cell-editing, inbox.

**Data in the mockups:** the mockups use real task titles from the e2e vault. Per-phase dashboard counts were read off an old screenshot, so treat them as approximate. Anything in `[brackets]` is a placeholder.

---

## 3. Visual system

### Color tokens

| Token     | Light     | Dark      | Use                                         |
| --------- | --------- | --------- | ------------------------------------------- |
| bg        | `#F6F6F7` | `#111113` | left sidebar, tab strip, board column wells |
| surface   | `#FFFFFF` | `#18181B` | content, cards, right sidebar               |
| well      | `#F8F8F9` | `#1D1D21` | table group rows, notice bars               |
| ink       | `#18181B` | `#EDEDEF` | primary text                                |
| ink-2     | `#52525B` | `#B4B4BC` | secondary text, controls                    |
| ink-3     | `#6B6B73` | `#8E8E98` | metadata, labels (≥ 4.5:1)                  |
| line      | `#E6E6E9` | `#2A2A2F` | hairlines, card borders                     |
| line-soft | `#ECECEF` | `#2A2A2F` | table row dividers                          |
| hover     | `#F4F4F6` | `#222227` | row and button hover                        |
| selected  | `#E8E8EB` | `#26262B` | active nav item, pressed toggle             |
| focus     | `#6B7BC4` | `#8F9BE0` | focus ring and editing-cell ring only       |

### Status: dot, pill text and pill tint (light)

In dark mode the dot stays the same, the text lightens, and the tint becomes the dot color at about 14–16% alpha.

| Status  | Dot       | Text      | Tint      |
| ------- | --------- | --------- | --------- |
| Inbox   | `#9DB4C8` | `#3D5A70` | `#EAF0F5` |
| Backlog | `#A1A1AA` | `#52525B` | `#F1F1F3` |
| Next    | `#7EA2DD` | `#2D4F8A` | `#E8EFFB` |
| Doing   | `#DDA54E` | `#7A5312` | `#FBF1DF` |
| Waiting | `#C9A0B8` | `#6E3F5C` | `#F6ECF2` |
| Review  | `#A595E3` | `#4E3F8F` | `#EFEBFB` |
| Done    | `#7DBF93` | `#2F6B45` | `#E6F3EA` |

The pastel dots fail a color-blindness separation check on their own, so status must always show its text label. Never use color alone.

### Buttons (pastel, but they need to pop)

| Kind        | Light bg / text / border          | Dark                                | Use                     |
| ----------- | --------------------------------- | ----------------------------------- | ----------------------- |
| Primary     | `#E3ECFB` / `#23457E` / none      | `rgba(126,162,221,.18)` / `#B5CBF0` | one per view (New task) |
| Positive    | `#E3F2E8` / `#26603D` / `#C8E3D2` | —                                   | Accept, confirm, Done   |
| Destructive | `#FBEDED` / `#9A3F3F` / `#F2D4D4` | —                                   | Reject, delete          |
| Secondary   | `#FFFFFF` / `#18181B` / `#D9D9DE` | —                                   | neutral actions         |
| Ghost       | transparent / `#52525B`           | —                                   | everything else         |

James explicitly asked for this: on the Inbox there was no visual difference between Reject and Accept. Choose the dark values for the remaining kinds yourself, following the same rule (dot color at about 15% alpha, lightened text).

### Type

System UI stack (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui`), replacing Manrope. Use weights 400, 500 and 600 only, and tabular figures for numbers.

| Role                             | Size / weight      |
| -------------------------------- | ------------------ |
| Note title                       | 24 / 600, −0.01em  |
| Section title                    | 15 / 600           |
| Card title, active tab, emphasis | 13 / 500           |
| Body, table rows, nav            | 13 / 400           |
| Column and group label           | 12.5 / 600         |
| Metadata                         | 12 / 400, ink-3    |
| Section and column headers       | 11.5 / 500, ink-3  |
| Mono (IDs, code)                 | 12, `ui-monospace` |

### Sizes and shape

| Element                              | Value                                                    |
| ------------------------------------ | -------------------------------------------------------- |
| Left sidebar                         | 224px                                                    |
| Right sidebar                        | 300–340px                                                |
| Tab strip                            | 36px                                                     |
| Nav bar                              | 40–44px                                                  |
| View bar                             | 44px                                                     |
| Table header and group row           | 32px                                                     |
| Table row                            | 34px                                                     |
| Control and sidebar item             | 28px                                                     |
| Radius: chips and pills              | 4px                                                      |
| Radius: buttons and inputs           | 6px                                                      |
| Radius: popovers, menus, peek, toast | 8px                                                      |
| Radius: board columns and cards      | **square (0)**                                           |
| Fully round                          | dots and avatars only                                    |
| Shadows                              | popovers, menus, peek and toasts only. Never on content. |

### Rules (also on the Tokens board)

1. No shadows on content. A 1px hairline separates things.
2. Color shows up as pastel tints on buttons, status pills, charts and the focus ring, never as a filled area bigger than a button. No navy hero tiles and no gradients.
3. One bold thing per row: the title.
4. Metadata sits on one line separated by `·` (e.g. `P14 · Bug fixer · 1h`). No chip per value.
5. Hide empty values and zero counts. Never print "Empty".
6. Page chrome is compact: no hero icon tile and no subtitle block. Content runs edge to edge on the white surface, with no floating rounded panel.
7. Board columns split the width equally, empty or not. Columns and cards are square.
8. Status is a tinted pill in tables, peeks and filters. Board column headers use the bare dot.

---

## 4. Shell and layout

From left to right: **left sidebar | panes | right sidebar**.

- **Left sidebar** (`Sidebar.dc.html`): the vault switcher, then the fixed items (Search ⌘K, Today, Inbox with its count, Weekly review, Graph, Tags, Automations, Activity, Templates, Terms), then Dashboards, Favorites, Views and Types. Settings, sync and theme sit at the bottom. The active item gets the `selected` background. Counts are ink-3 and hidden at 0.
- **Each pane** is stacked top to bottom:
  - **tab strip** (36px): square tabs with a close × on the active tab, plus a + button.
  - **nav bar**: ← → for that tab's history, breadcrumb, then actions on the right. The actions are the view's buttons, Saved, ☆, ⋯ and the right-sidebar toggle.
  - **content**.
- **Right sidebar:** contextual and hideable. See §5.3.
- When the window is too narrow, **the right sidebar collapses first, then the left**.

---

## 5. Behavior spec

### 5.1 Opening things

| Gesture                                | Result                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Click a note or task (row, card, link) | **Center peek**, a modal over the current view (see `FlowPeek`)        |
| ⌘-click                                | Open in a **new tab** in the current pane                              |
| ⌘⇧-click                               | Open in a **split** (new pane)                                         |
| In the peek: ⌘↵ / ⌘⇧↵ / expand button  | New tab / split / replace the current tab                              |
| In the peek: ↑ ↓                       | Previous or next row of the underlying view ("3 of 186 in Task table") |
| Esc                                    | Close the peek                                                         |

There is no side-peek. Peek shows the title, a one-line properties strip with "+ N empty" to reveal the rest, and the body. It's fully editable and saves like a page.

### 5.2 Tabs and history

- Every pane has its own tabs. Splits are panes. The focused pane's active tab has a 2px ink top border; an unfocused pane's active tab has a grey one.
- **Each tab keeps its own back/forward stack and its own undo/redo stack**, like a browser tab.
- Open tabs and panes come back on restart.

### 5.3 Right sidebar

- It shows whatever has focus. A selected row or the open note shows **Properties**, **Backlinks** and **Outline**. A type being edited shows the **type editor** (`FlowType`): rename, reorder by drag, each property's kind, the options _Allow many_, _Show as column_ and _Required on new notes_, add a property, the template and the default view.
- It toggles with ⌘\ and with the nav-bar button, and its open/closed state is remembered.
- **When hidden**, a note's properties collapse to one metadata line under its title (`FlowSplit`). Clicking that line edits them.
- Properties no longer render as a long block in the note body.

### 5.4 Editing in place (James works mostly in table view)

- Every table cell and every board card field can be edited without opening the item. Click or ↵ to edit, Tab or ⇧Tab to move, Esc to cancel, ↵ to commit.
- The cell being edited gets a 1.5px `focus` ring. Status and select cells open a small picker (`FlowTable`) with a filter field, where **number keys 1–7 pick a status**.
- Space opens the selected row in a peek.
- The table has a checkbox column for multi-select, ready for bulk actions.

### 5.5 Link previews

Hovering a wikilink for about 400ms shows a preview card: title, type and phase, and up to four lines of the note. Click opens the peek, and the modifier keys behave as in §5.1.

### 5.6 Feedback

- **Toasts sit in the top right** and leave after about 5 seconds. A toast for any change offers **Undo**.
- Warnings and errors are also written to **Activity**, which already exists, so a missed toast can be found later.
- Loading shows a spinner only if it takes longer than about 150ms. The app is local and usually instant, so there are no skeletons and no flashes.

### 5.7 Capture and Inbox (James's hybrid GTD / PARA / Zettelkasten / time-blocking workflow)

- **A new task needs no fields.** It is created with status **Inbox**.
- The Inbox page (`FlowInbox`) has three parts:
  - a one-line notice bar (e.g. meetings without a project), with Preview and Not now;
  - **To clarify**: Inbox-status tasks, each with one-key actions: **N**ext, **W**aiting, **S**omeday, schedule (**T**), **P**roject, **D**one;
  - **Proposals**: dense rows of kind, title and explanation, a confidence pill, then Reject, Edit and Accept. **Proposals that conflict (e.g. three candidates for "Mara Quill") are grouped into one "pick one" question** with radio choices, plus "Accept choice" and "Reject all".
- Filters are All, High confidence and Needs a choice, plus "Accept all high confidence".
- Weekly review, Activity, Tags and the other existing areas stay. Restyle them to this system, with no behavior changes beyond what this brief says.

---

## 6. Screen notes

- **Board:**
  - **Columns:** equal-width square columns on `bg`; each header shows the dot, label, count and +.
  - **Cards:** white, square, 1px line, with no hover lift. A card shows its title (two-line clamp), an optional one-line summary in ink-3, and one metadata line. Done cards dim the title to ink-2 and show a sage check.
  - **Overflow and empty:** a "N more" button at the bottom of a column; "No tasks" when it's empty.
- **Table:**
  - **Layout:** grouped by status, with collapsible group rows on `well`, a sticky header and 34px rows.
  - **Cells:** empty cells stay blank.
  - **Footer:** totals, plus how the table is grouped and sorted.
- **Dashboard:** a strip of six headline numbers divided by hairlines, then a hairline grid of panels with no cards.
  - **Tasks per phase:** grey bars, with the current phase in pastel blue. Only the tallest bar and the current phase carry value labels. Each bar has a hover title and a table-view toggle.
  - **By status:** a thin stacked bar plus a table.
  - **Lists:** Largest phases, Waiting for review and Backlog.
- **Note (full page or peek):** a 24/600 title, the one-line properties strip, then the body. Inline code uses mono 12.5 on `#F4F4F6` with a 4px radius.

---

## 7. Known gaps (decide during planning)

- The five Flow boards are light only. Build dark from the tokens and render it for review.
- Dark values for the Positive, Destructive and Secondary buttons aren't specified.
- The Note page has no dedicated v2 mockup apart from the peek and split. Use those.
- Calendar, Roadmap/timeline, Search, Settings, Welcome, Activity and Tags have no v2 mockups. Restyle them by the rules.
- The keyboard map (§5) should be checked against existing shortcuts (the one-overlay rule, Cmd+N, Shift+Cmd+D).

## 8. What I'd like from you (Claude Code)

1. A **plan**, before any code, that splits this into slices. Suggested order: tokens and type → shell (tab strip, nav bar, right sidebar, collapse rules) → table, including in-place editing → peek and link preview → tabs, history and split → board → dashboard → Inbox → type editor → remaining screens. Each slice should be small enough to show James on its own.
2. For each slice: what changes, which mockup it is judged against, the risks, and any data or model work needed. Examples of data work: per-tab history and undo stacks, persisting tabs, an Inbox status value, grouping conflicting proposals.
3. List any question where this brief is ambiguous **instead of guessing**. Guessing caused the first round's UX problems.

Slices are judged the same way as before (`design/README.md`): a side-by-side render at 1440×900, the same data, both themes, and James approves each slice before the next one starts.
