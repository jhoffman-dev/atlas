# Atlas — plan of record

A local-first desktop app that replaces Notion and Obsidian: markdown notes, typed
objects, SQL-backed database views, tasks, calendar, project management and dashboards.

Codename `atlas`. Renaming later is a find/replace plus a directory move — nothing
is built on the name.

---

## 1. The shape of the thing

**Stack (decided)**

| Concern | Choice                                                       | Why                                                                                       |
| ------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Shell   | Tauri v2                                                     | ~10–15 MB app, ~150 MB RAM, native filesystem + SQLite without shipping Chromium          |
| UI      | React 19 + TypeScript                                        | best-maintained TipTap bindings; TanStack Table/Virtual, dnd-kit, ECharts all React-first |
| Editor  | TipTap v3 (ProseMirror)                                      | required; markdown handled by our own remark bridge (see §3)                              |
| Index   | SQLite (rusqlite, bundled) + FTS5                            | derived index, not the source of truth                                                    |
| Build   | Vite + pnpm workspaces                                       | matches the other projects on this machine                                                |
| Test    | Vitest + Testing Library + Playwright (e2e via tauri-driver) | satisfies the three-layer testing bar                                                     |

**Prerequisite:** no Rust toolchain is installed on this machine. Phase 0 installs
`rustup` + stable toolchain + Xcode CLT. Node 26.8.1 and pnpm 11.24.0 are already present.

---

## 2. Architecture

Dependencies point inward. Nothing in `domain` knows about Tauri, React, SQLite, the
clock or the filesystem.

```
packages/
  domain/        pure TS. Document model, ObjectType + PropertyDef, property
                 validation, query AST, view spec, dashboard spec, scheduling
                 rules, critical-path algorithm. No I/O, no Date.now(), no Math.random().
  application/   use-cases + ports: VaultPort, IndexPort, WatcherPort, ClockPort,
                 RngPort, DataSourcePort. Returns plain data and events.
  adapters/      thin translators: tauri-fs, tauri-sqlite, markdown (remark <-> mdast
                 <-> ProseMirror), ics, http-source.
  ui/            React components. Zero business rules.
apps/
  desktop/       Tauri shell (src-tauri Rust) + Vite React entry, wires ports to adapters.
tools/           board.mjs — the kanban you watch me work in (see §6)
vault/           this project's own vault: tasks, docs, ADRs. We dogfood from day one.
```

**Rust owns exactly three things** — scoped filesystem read/write, filesystem
watching, and the SQLite connection. It translates; it never decides. Everything
else is TypeScript.

### The one invariant that governs every other decision

> **Markdown files are the source of truth. SQLite is a derived cache.**

Delete the database and the app rebuilds it from the vault with nothing lost. This
is what keeps the vault Obsidian-compatible, Git-syncable, and yours forever.

Consequences that fall out of it, deliberately:

- Editing a cell in a table view **writes YAML frontmatter to a file**. The index
  updates because the file changed, never the other way round.
- App state that has no natural note to live in — view definitions, dashboard
  layouts, type schemas, datasource configs — still lives as files, under
  `.atlas/` inside the vault. Diffable, syncable, reviewable.
- SQLite holds nothing you would cry over losing.

### Vault layout

```
<your vault>/
  Notes/, People/, Companies/, ...     your content, any structure you like
  .atlas/
    types/company.md                   object type definitions
    templates/weekly-review.md         templates
    views/companies-by-arr.md          saved database views (SQL + display config)
    dashboards/ops.md                  widget grid
    sources/github.md                  external datasource configs
    settings.md
  .atlas-cache/index.sqlite            derived, gitignored, disposable
```

---

## 3. Markdown fidelity — the highest-risk area

An Obsidian replacement that reformats your files on save is worthless. So the
markdown bridge is owned code, not a plugin:

- **remark/mdast is canonical** for both parse and serialize. TipTap's default
  markdown serializer is lossy; we do not use it on the write path.
- mdast ⇄ ProseMirror mapping lives in `adapters/markdown` and is covered by
  **property-based round-trip tests**: `serialize(parse(x)) === x` for a corpus
  including frontmatter, wikilinks, embeds, callouts, nested lists, tables, code
  fences with language + attrs, footnotes, and task checkboxes.
- Untouched regions of a file are byte-preserved on save. If you only edit a
  paragraph, `git diff` shows one paragraph.
- `[[Wikilink]]`, `![[embed]]`, `#tag` and `^block-id` are custom ProseMirror nodes
  with matching remark plugins.

---

## 4. The database layer (your point 3)

User-facing schema, stable and documented:

| Table/view   | Contents                                                                    |
| ------------ | --------------------------------------------------------------------------- |
| `files`      | path, title, type, created, modified, size, hash                            |
| `props`      | EAV: path, key, value_text, value_num, value_date, value_json, idx          |
| `links`      | src, dst, kind (wikilink / relation-property / tag)                         |
| `blocks`     | headings and block ids, for transclusion and deep links                     |
| `fts`        | FTS5 over body text                                                         |
| `v_<type>`   | **generated view per object type** — one typed column per declared property |
| `src_<name>` | cached rows from external datasources                                       |

The `v_<type>` views are what make SQL pleasant. You write:

```sql
SELECT name, arr, ceo FROM v_company WHERE arr > 1000000 ORDER BY arr DESC
```

instead of hand-rolling EAV joins. The view is regenerated whenever the type
definition changes.

**Safety:** user SQL runs on a second connection opened `query_only=ON`, with a
statement timeout and a row cap. A query in a dashboard widget can never mutate
your vault.

**Filter/sort/group UI compiles to SQL** and the generated SQL is always visible and
editable — the UI is a convenience over the query, never a cage around it.

---

## 5. Object types, typed properties and locked relations (your point 5)

A type definition is a markdown file with frontmatter:

```yaml
---
atlas: type
name: company
icon: building
properties:
  name: { kind: text, required: true }
  arr: { kind: number, format: currency }
  founded: { kind: date }
  stage: { kind: select, options: [seed, a, b, c] }
  ceo: { kind: relation, target: person, cardinality: one }
  employees: { kind: relation, target: person, cardinality: many }
  headcount: { kind: rollup, over: employees, agg: count }
  age_years: { kind: formula, sql: "(julianday('now') - julianday(founded))/365.25" }
---
```

`kind: relation, target: person` is exactly what you asked for: the picker for `ceo`
queries `SELECT path, title FROM v_person` and **nothing but People is selectable**.
The value is stored in frontmatter as a wikilink, so the file stays readable in
Obsidian and the link shows up in backlinks.

Validation (`validateProperty(def, value, ctx)`) is pure domain code and is part of
the 90%-coverage slice. Templates are markdown files with placeholders; "New Company"
instantiates one with properties pre-stubbed.

---

## 6. How you watch me work (your point 6)

`node tools/board.mjs` → `http://localhost:4321` → a kanban of every task in
`vault/tasks/*.md`, polling for changes every 2 seconds. Zero dependencies, ~1 second
to start. Drag a card between columns and it rewrites `status:` in that file's
frontmatter.

Those task files are ordinary markdown with YAML frontmatter, so you can also edit
them in Obsidian today. I move cards as I work, so the board is the live view of
what I'm on.

**In Phase 7 the app takes over its own board** and `tools/board.mjs` retires — the
first real moment of dogfooding.

---

## 7. Phases

Each phase ends with something you open, look at, and test by hand. Nothing starts
until you've signed off on the phase before it.

| #   | Phase                        | What you'll see and test                                                                                                                                                            |
| --- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Foundations                  | `pnpm tauri dev` opens a window showing the version. CI gate green: typecheck, lint, test, build.                                                                                   |
| 1   | Vault + file tree            | Pick a folder; the sidebar shows your real notes; clicking one shows its raw text. Point it at your actual Obsidian vault.                                                          |
| 2   | TipTap + markdown round-trip | Open a note, edit it WYSIWYG, save. `git diff` shows only what you changed; frontmatter untouched; Obsidian opens it unchanged.                                                     |
| 3   | Editor depth                 | Wikilink autocomplete, backlinks panel, slash commands, tables, callouts, code blocks, images, checkboxes.                                                                          |
| 4   | Index + search               | Full-text search across the vault, instant. "Rebuild index" wipes and regenerates, proving the DB is disposable.                                                                    |
| 5   | Object types + properties    | Define a Company type; a properties panel on the note; add a `ceo` relation and watch the picker offer only People. Templates.                                                      |
| 6   | Database views               | A table view over SQL. Edit a cell → the file's frontmatter changes on disk. Filter/sort/group UI, plus a raw SQL editor.                                                           |
| 7   | Board / list / gallery views | Kanban with drag-to-set-status. **This project's own board moves into the app.**                                                                                                    |
| 8   | Tasks                        | Task type, due/scheduled/recurring, Inbox and Today, global quick-capture hotkey.                                                                                                   |
| 9   | Calendar                     | Month/week/agenda over date properties, drag to reschedule (writes frontmatter), daily notes.                                                                                       |
| 10  | Dashboards v1                | Drag-resize widget grid: stat tiles, tables, charts. Edit a note in Obsidian and watch the widget update live.                                                                      |
| 11  | Gantt + project management   | Timeline with dependencies, milestones, critical path.                                                                                                                              |
| 12  | External datasources         | ICS calendar subscribe, HTTP/JSON, CSV, attach external SQLite. Scheduled refresh; secrets in the macOS keychain.                                                                   |
| 13  | **Look and feel**            | A real design system, and a sidebar organised into Favorites / Types / Views / Dashboards / User space.                                                                             |
| 14  | Headless UI foundations      | Overlays, menus, drag and chart maths onto headless libraries. Tokens and primitives stay ours.                                                                                     |
| 15  | Connect other tools          | A local API and an MCP server. Claude Code searches the vault, creates a task from a template, and it appears in the open app.                                                      |
| 16  | The look, rebuilt            | Notion's structure with the references' finish, matched screen by screen against `design/target/`. Judged side by side.                                                             |
| 17  | Make it editable             | Folders, move and delete; a type editor with Projects; dashboard widgets you add, edit, drag and resize; saved views and SQL queries; feed layout; tick-to-done; links and a graph. |
| 18  | Migration + polish           | Command palette, keymap, auto-update. Signed build and Notion importer deferred until asked for.                                                                                    |
| 19  | Arrange the sidebar          | Drag Favorites / Types / Views / Dashboards / Pages into any order; collapsed sections slide to the bottom.                                                                         |
| 20  | Tags                         | Type `#tag`, `#multi word#`, `#area/topic`; suggestions as you type; a tag manager with counts, rename everywhere.                                                                  |
| 21  | People and mentions          | `@` picks a person and links the page to them; built-in types can't be deleted.                                                                                                     |
| 22  | Bookmarks                    | Any link can become a card with the page's thumbnail and summary, and back again.                                                                                                   |
| 23  | Archive                      | Archive a note and it's out of the way — not in the sidebar, views or search — but one click (or one API call) brings it back.                                                      |
| 24  | Query builder                | One query across several types, written as SQL-like text or built with dropdowns; sort, group, sub-group; saved and embedded in dashboards.                                         |
| 25  | Automations                  | Rules that run on a schedule — first: archive done tasks after 30 days — with a dry run and undo.                                                                                   |
| 26  | Block transclusion           | `![[page#^block]]` embeds a live block from another note, picked page-first then block.                                                                                             |
| 27  | Claude in Atlas              | A chat panel that knows the page it opened on, can search everything, and edits the page when you accept.                                                                           |
| 28  | Meetings arrive              | A Gemini meeting lands in the vault while the Mac sleeps: speaker turns you can link to, names spelt right.                                                                         |
| 29  | The assistant reacts         | A new meeting links its people and proposes my actions, waiting-fors and decisions in the Inbox, each citing its line.                                                              |
| 30  | GTD, PARA, linked pages      | Eight GTD statuses, everything under a Project or Area, Person/Company/Project pages with meetings and open loops.                                                                  |
| 31  | Timeblocking                 | Drag tasks into blocks, split a task across blocks, see the blocks as busy on Google Calendar.                                                                                      |
| 32  | Retrieval + proactive        | Related notes and trails, search by meaning, brief/meetings tools for Claude, a morning brief and a Friday review draft.                                                            |

Phases 0–4 make it a better Obsidian. Phases 5–7 make it Notion. Phases 8–11 make it
the thing neither of them is. 12 connects it to the outside, 13 makes it something you
want to look at, 14 makes it maintainable, 15 lets other tools use it, 16 makes it look designed, 17 makes everything editable from the app, 18 makes it permanent, 19–27 are James's next queue (September 2026), and 28–32 make Atlas his assistant (§11).

### Why 14 exists, and why it is not a component kit

James asked, reasonably, whether hand-rolling the UI would be maintainable. The
answer we landed on: most of it is fine to own, and a specific part is not.

Tokens, cards, buttons, inputs and chips are CSS. Cheap to own, cheap to replace.
The expensive kind of hand-rolling is the **overlay and interaction layer** —
there are already four hand-rolled overlays (search palette, capture palette,
new-note menu, editor suggestion popup), each needing focus trapping, focus
restoration, escape handling, scroll locking, click-outside versus focus-outside,
portals and correct ARIA. That is the code that is subtly wrong for years. On top
of it, the board, calendar and timeline all use native HTML5 drag, which has no
keyboard path at all — a live accessibility hole, not a future one.

So Phase 14 adopts **headless** libraries: behaviour and accessibility with zero
styling, so the Phase 13 token set stays the source of truth and adoption is
per-component rather than all at once.

- **`@base-ui/react`** — dialogs, popovers, menus, tooltips, tabs. Chosen over
  Radix on measured maintenance activity, not reputation; see ADR-0015.
- **dnd-kit** — board, calendar and timeline drag, with keyboard and touch.
- **`d3-shape` + `d3-scale`** — donut, line and radar geometry only. Atlas goes on
  rendering its own SVG, so the flat-fill look survives.

A full component kit was considered and rejected. MUI, Mantine, Chakra and Ant
each bring their own theming system, which would fight the tokens rather than
build on them; they are styled for a _generic_ good look, and the last 20% of a
_specific_ look is where you fight a kit hardest; and they would add real weight
to a bundle already past 1 MB.

**What stays ours:** tokens, themes, card, button, input, chip, segmented
control, the vault tree and the Gantt. No library gives you a good vault tree,
and the Gantt's domain logic is already pure and tested.

The cost of sequencing this after 13 rather than during it, accepted knowingly:
some surfaces get styled twice, and the drag accessibility hole ships in 13.
Phase 13's honesty pass (P13-08) names it rather than quietly passing.

That check was done on 2026-09-22 and reversed the original guess, which had
favoured Radix on reputation: Radix had made no commits in thirty days and its
release-candidate train had stopped in July, while Base UI was shipping monthly
and had caught it on download volume. ADR-0015 has the numbers. If this is ever
revisited, **re-measure rather than re-remember**.

### Why 13 is where it is

Everything up to 12 was built to see whether an idea worked, and styled just enough
to tell. That was the right trade while the shape was still moving, and it has run
out: the app now does more than it looks like it does, and the sidebar is a flat
file tree that hides most of it.

The themes originally listed under "polish" are pulled forward into 13, because a
theme is not a coat of paint on top of a design system — it _is_ the design system,
and retrofitting one twice is how you end up with neither.

---

## 8. Testing bar

Per the global engineering rules: 70% lines repo-wide in CI, 90%+ with every rule
tested on the high-impact slice. That slice is named here and in `COVERAGE.md`:

1. `adapters/markdown` — round-trip fidelity. Your files are at stake.
2. `domain/properties` — type and relation validation.
3. `domain/query` — filter/sort/group → SQL compilation.
4. `application/indexing` — file change → index delta correctness.
5. `application/vault` — safe write, atomic replace, conflict detection.
6. `domain/schedule` — recurrence and critical path.

Adapters get integration tests against a real temp vault and a real SQLite file.
Playwright drives the core loop end-to-end on every merge.

---

## 9. Known risks, and what we do about them

| Risk                                                      | Mitigation                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Markdown round-trip mangles your notes                    | Owned remark serializer, property-based tests, byte-preserving writes, Phase 2 tested against a copy of your real vault |
| Large vault performance in WKWebView                      | Virtualized tree and tables, incremental indexing, queries off the main thread                                          |
| Watcher echo loops (we write → we react to our own write) | Hash-and-ignore on self-writes                                                                                          |
| Rust learning curve                                       | Rust surface deliberately tiny: fs, watch, sqlite. Three files, no business logic                                       |
| User SQL doing damage                                     | Read-only connection, timeout, row cap                                                                                  |
| TipTap tables ⇄ markdown tables                           | Constrained table feature set in Phase 3; anything unrepresentable in markdown is not offered                           |
| Scope (this replaces two products)                        | Strict phase gates; each phase is independently useful and shippable                                                    |

---

## 10. Open questions for you

1. **Vault location** — point Phase 1 at your existing Obsidian vault (read-only until
   Phase 2 is proven) or start on a copy?
2. **Sync** — is iCloud/Dropbox/Git sync in scope, or is this one-machine for now?
   It affects conflict handling in Phase 2.
3. **Mobile** — ever? If yes, the domain/application split stays strict enough to
   reuse; if never, we can take shortcuts in Phase 6+.
4. **GitHub** — private repo under `jhoffman-dev` like the other projects, or local-only?

---

## 11. The assistant (phases 28–32)

James wants Atlas to be his AI personal assistant, built on the system he ran
before AI: **PARA** for structure, **GTD** for tasks (Inbox first), a
**Zettelkasten** of linked notes, and **timeblocking** on his real calendar,
with everything linked. At work he mostly asks Claude questions — "what do I
discuss with <client> today", "what did <colleague> say about X last week", "build a
dashboard of X" — and he wants meetings processed the moment they land.
Agreed with James on 2026-10-07.

### Principles

1. **Markdown is truth.** Meetings, terms, proposals, blocks and briefs are
   notes. Embeddings and change feeds are derived and disposable.
2. **AI proposes, James accepts.** Claude never edits a note on its own; what
   it produces lands as a proposal in the Inbox (accept / edit / reject).
3. **Every AI item cites its source** — a block link to the transcript turn or
   line it came from. An answer without one is flagged.
4. **Provider-agnostic ingestion.** Atlas reads one versioned meeting import
   contract; which notetaker wrote it is n8n's concern.
5. **Local-first.** Ingestion goes through the vault's own sync repo, so
   nothing waits on the Mac being awake; embeddings are computed on the Mac.
6. **Nothing silent.** The only unprompted edits are declared deterministic
   steps (terminology correction, sure links), each recorded on the note,
   logged in Activity and undoable.

### Build order

| #   | Phase                                 | Design parts                                                     |
| --- | ------------------------------------- | ---------------------------------------------------------------- |
| 28  | Meetings arrive                       | A (ingestion), D (terms and correction), the Meeting type        |
| 29  | The assistant reacts                  | B (note-triggered automations with a Claude step), C (pipeline)  |
| 30  | GTD, PARA and linked pages            | E (PARA), F (GTD tasks, weekly review), G (Person/Company pages) |
| 31  | Timeblocking                          | H (blocks, calendar drag, Google Calendar two-way)               |
| 32  | Retrieval and the proactive assistant | I (embeddings, related, trails), J (assistant tools), K (briefs) |

Decisions, drafted as **Proposed**: ADR-0027 (meeting import contract and
ingestion via the sync repo), ADR-0028 (note-triggered automations with a
Claude step), ADR-0029 (GTD task model and status migration), ADR-0030
(Google Calendar two-way sync), ADR-0031 (embeddings cache). Each ticket is a
GitHub issue labelled `assistant` and `phase-N`; the "Assistant roadmap"
issue (#41) tracks them all.

### Tickets

#### Phase 28 — Meetings arrive

A meeting written up by Gemini lands in the vault while the Mac sleeps, as a Meeting note with a speaker-attributed, citable transcript, its terms already spelt right.

- **P28-01** (atlas-archive#18) Meeting type and the meeting import contract v1 (doc, JSON Schema, validator) _(after: —)_
- **P28-02** (#8) n8n: add a "commit to the vault repo" destination for meetings (Gemini + Granola mapping) _(after: P28-01)_
- **P28-03** (#9) Index change feed: refresh reports added/changed/removed notes with type and digest _(after: —)_
- **P28-04** (#10) Meeting import on arrival: validate, dedupe by external id, surface errors in the Inbox _(after: P28-01, P28-03)_
- **P28-05** (#11) Terminology: Term type, aliases on People and Companies, and a Terms page _(after: P28-01)_
- **P28-06** (#12) Transcript correction: deterministic, recorded and undoable _(after: P28-04, P28-05)_
- **P28-07** (#13) One-time import of existing Notion Meeting Notes into the vault _(after: P28-02, P28-04)_

#### Phase 29 — The assistant reacts

A new meeting triggers Atlas on its own: people and companies linked, action items, decisions and follow-ups proposed in the Inbox with a link to the line they came from.

- **P29-01** (#14) Automations: note trigger ("a note of type X appears or changes"), idempotent per version _(after: P28-03)_
- **P29-02** (#15) Proposals as notes, and an Inbox to accept, edit or reject them _(after: P28-01)_
- **P29-03** (#16) Automations: a Claude step with a fixed shape that only proposes _(after: P29-01, P29-02)_
- **P29-04** (#17) Meeting linking: attendees to People, companies, likely project (proposed where unsure) _(after: P29-01, P29-02, P28-05)_
- **P29-05** (#18) Meeting extraction with Claude: my actions, waiting-fors, decisions, follow-ups, each citing its line _(after: P29-03, P29-04)_
- **P29-06** (#19) "After a meeting" pipeline preset, plus suggested glossary terms _(after: P29-05, P28-06)_

#### Phase 30 — GTD, PARA and linked pages

Tasks follow James's eight GTD statuses, everything hangs off a Project or Area, and a Person, Company or Project page shows its meetings, open tasks, waiting-fors and decisions.

- **P30-01** (#20) PARA: Area and Resource types, project relation on everything, Inbox as the universal entry _(after: —)_
- **P30-02** (#21) GTD task model: eight statuses, waiting-on, contexts, defer, and a previewed migration _(after: P30-01)_
- **P30-03** (#22) Checklist progress on tasks, and promote a checklist line to a task _(after: P30-02)_
- **P30-04** (#23) Query language: `this` and relative date ranges _(after: —)_
- **P30-05** (#24) Live query blocks inside a note _(after: P30-04)_
- **P30-06** (#25) Person, Company and Project pages: meetings, open tasks, waiting-fors, notes, decisions _(after: P30-05, P29-02)_
- **P30-07** (#26) Weekly review screen _(after: P30-02)_

#### Phase 31 — Timeblocking

Drag tasks into blocks on the calendar, split a big task across blocks, and see the blocks as busy on the real Google Calendar.

- **P31-01** (#27) Block type and the scheduling rules (estimate vs scheduled vs done) _(after: P30-02)_
- **P31-02** (#28) Calendar: drag tasks into time, into blocks, and split them _(after: P31-01)_
- **P31-03** (#29) Google Calendar connection: OAuth in the host, token in the Keychain _(after: —)_
- **P31-04** (#30) Two-way sync of blocks with the dedicated Google calendar _(after: P31-01, P31-03)_
- **P31-05** (#31) Today's meetings from Google Calendar (read) for briefs and the calendar _(after: P31-03, P29-04)_

#### Phase 32 — Retrieval and the proactive assistant

Related notes and trails, semantic search, brief/meetings/open-loops tools for Claude, and a morning brief and Friday review draft written without being asked.

- **P32-01** (#32) Embeddings spike and host embedding command _(after: —)_
- **P32-02** (#33) Embeddings cache and semantic search (app + MCP) _(after: P32-01, P28-03)_
- **P32-03** (#34) Related notes and trails _(after: P32-02)_
- **P32-04** (#35) Assistant tools: brief, open_loops, meetings (with speaker quotes) _(after: P30-06, P29-05)_
- **P32-05** (#36) propose_tasks(meeting) and make_dashboard(spec) as proposals _(after: P29-05, P29-02)_
- **P32-06** (#37) Ask (⌘J) as a first-class home, answers always cited _(after: P32-04)_
- **P32-07** (#38) Export a note for Confluence _(after: —)_
- **P32-08** (#39) Proactive: morning brief per meeting today _(after: P32-04, P31-05)_
- **P32-09** (#40) Proactive: Friday weekly-review draft _(after: P30-07, P29-03)_

### What this builds on

- **Sync** already pulls every minute (ADR-0025), so a file n8n commits is in
  the vault within a minute of the Mac waking.
- **Automations** already have rules as notes, dry run, log and undo, on one
  Mac — they gain a note trigger and a Claude step rather than a second engine.
- **Claude in Atlas** already runs Claude Code locked down (ADR-0021) with
  read-only tools and proposals; the assistant reuses `runChatTurn` and makes
  proposals durable as notes.
- **Block ids** (ADR-0022) make every transcript turn citable.
- **Sources** (ADR-0012) set the pattern for external data: written as notes,
  marked missing rather than deleted.

What is genuinely new: a change feed out of the index, persisted proposals,
query `this` and live query blocks in notes, a checklist table in the index,
OAuth, and a local embedding model.

### Risks and open questions

| Risk / question                    | Where it bites | What we do                                                                                                                                                               |
| ---------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Group attendees                    | P28-01, P29-04 | Gemini lists group addresses (`platform-team@…`) beside people. The contract flags them `group: true`; they are kept, never made a Person.                               |
| Unknown speakers                   | P28-01, P29-05 | Granola gives only `You` / `Remote Speaker`. `You` is the profile's name; others are `Unknown` and never guessed; extraction carries a confidence (high / medium / low). |
| Section-level timestamps           | P28-01         | Gemini stamps sections, not turns. A turn takes its section's time, marked approximate.                                                                                  |
| Google OAuth on a work account     | P31-03         | Workspace policy may forbid a third-party client. Spike before building; ICS + one-way is the fallback.                                                                  |
| Embedding model size and quality   | P32-01         | Measured on James's vault before choosing; download-on-first-use if the app would grow too much.                                                                         |
| API writes into `.atlas`           | P32-05         | ADR-0016 keeps the API out of `.atlas`. Dashboards and views from Claude arrive as proposals accepted in the app — an addendum to ADR-0016, not an exception to it.      |
| Work data privacy on a work Mac    | P28-02, P29-03 | Meeting text passes through n8n, GitHub and Claude. James decides whether work meetings may; the pipeline can be turned off per vault, and embeddings stay local.        |
| Existing task status migration     | P30-02         | Previewed many-to-one migration, one undoable run (ADR-0029). This repo's own vault is the first test.                                                                   |
| Unattended Claude runs cost money  | P29-03         | Per-rule run cap per hour, every run in Activity with its duration and outcome.                                                                                          |
| n8n needs push access to the vault | P28-02         | A fine-grained token scoped to the one repository, kept in n8n, never in the vault.                                                                                      |
