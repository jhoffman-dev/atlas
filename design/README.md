# design

## `target/` — what the app should look like

The UI v2 "Dense & Calm" mockups James approved (`docs/design/ui-v2-brief.md`;
the plan is `docs/design/ui-v2-plan.md`), in the design tool's "Design
Component" format: `*.dc.html` files holding markup with `{{holes}}`,
`<sc-for>`, `<sc-if>`, `<dc-import>` and a small logic class. `Main`, `Table`,
`Dashboard` and `Sidebar` take a `theme` prop and render light and dark;
`BoardDark`, `TableDark` and `DashboardDark` are the same three boards in dark
as single-render wrappers; `Tokens` and the five `Flow*` boards are light only.
`canvas.json` is the tool's canvas layout and is not rendered. They are the
reference, not code — do not reformat them. The Phase 16 boards they replaced
are in git history before this folder was switched over.

## How a slice is judged

Side by side: the mockup rendered at 1440×900 beside the built app screenshotted
at 1440×900, same data, both themes. A slice is done when the two are hard to
tell apart, not when a checklist passes, and each slice is shown to James before
the next starts.

```sh
pnpm design:refs     # target/*.dc.html → out/refs/<Board>-<theme>.png, or <Board>.png for a board with no theme prop
pnpm shots           # built app on a copy of vault/ → out/shots/<surface>-<theme>.png
pnpm shots:gallery   # the primitives gallery via Vite → out/shots/gallery.png and gallery-<row>-<theme>.png
pnpm design:compare  # out/compare/index.html, one page per surface, mockup left, app right
```

| App surface   | Mockup      | Shot today |
| ------------- | ----------- | ---------- |
| dashboard     | `Dashboard` | yes        |
| board         | `Main`      | yes        |
| all-tasks     | `Table`     | yes        |
| sidebar       | `Sidebar`   | yes        |
| tokens        | `Tokens`    | not yet    |
| table-editing | `FlowTable` | not yet    |
| peek          | `FlowPeek`  | not yet    |
| split         | `FlowSplit` | yes        |
| type-editor   | `FlowType`  | not yet    |
| inbox         | `FlowInbox` | yes        |

The "not yet" rows are surfaces or states `shots` will capture once the slice
that builds them lands; until then their compare page shows the mockup beside
a missing app shot. Everything else is shot with no mockup: `note`, `welcome`
(the choose-folder screen), `empty`, `calendar`, `timeline`, `list`, `type`,
`filter`, `specimen` (a note holding a callout, a table, code and a checklist),
`slash`, `wikilink`, `source`, `search`, `capture`, `new-note` and `settings`.
The rules those surfaces follow are on the `Tokens` board and in
`vault/docs/design/system.md`.

`design:refs` expands the format with `tools/design/dc-render.ts` (tested in
`dc-render.test.ts`), lists the boards with `tools/design/boards.ts` (whose
`boards.test.ts` proves every board renders with no empty hole) and screenshots
each in WebKit; it warns about any hole that resolves to nothing. The mockups
use the system font stack and load nothing from the network. `shots` skips,
with a warning, any surface it cannot find — the shell is being restyled under
it. Everything under `out/` is generated and git-ignored.
