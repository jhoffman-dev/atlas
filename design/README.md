# design

## `target/` — what the app should look like

The mockups James approved for Phase 16 (`vault/tasks/P16-00.md`), in the
design tool's "Design Component" format: `*.dc.html` files holding markup with
`{{holes}}`, `<sc-for>`, `<sc-if>`, `<dc-import>` and a small logic class. Each
board with a `theme` prop has a light and a dark version; `DashboardDark` is
`Main` in dark. They are the reference, not code — do not reformat them.

## How a slice is judged

Side by side: the mockup rendered at 1440×900 beside the built app screenshotted
at 1440×900, same data, both themes. A slice is done when the two are hard to
tell apart, not when a checklist passes, and each slice is shown to James before
the next starts.

```sh
pnpm design:refs     # target/*.dc.html → out/refs/<Board>-<theme>.png (needs network for Google Fonts)
pnpm shots           # built app on a copy of vault/ → out/shots/<surface>-<theme>.png
pnpm design:compare  # out/compare/index.html, one page per surface, mockup left, app right
```

| App surface | Mockup    |
| ----------- | --------- |
| dashboard   | `Main`    |
| board       | `Board`   |
| all-tasks   | `Table`   |
| note        | `Note`    |
| sidebar     | `Sidebar` |

Everything else is shot too, with no mockup: `welcome` (the choose-folder
screen), `empty`, `calendar`, `timeline`, `list`, `type`, `filter`, `split`,
`specimen` (a note holding a callout, a table, code and a checklist), `slash`,
`wikilink`, `source`, `search`, `capture`, `new-note` and `settings`. The rules
those surfaces follow are in `vault/docs/design/system.md`.

`design:refs` expands the format with `tools/design/dc-render.ts` (tested in
`dc-render.test.ts`) and screenshots it in WebKit; it warns about any hole that
resolves to nothing and when Manrope fails to load. `shots` skips, with a
warning, any surface it cannot find — the shell is being restyled under it.
Everything under `out/` is generated and git-ignored.
