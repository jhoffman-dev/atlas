---
type: adr
id: ADR-0019
title: An Atlas query is text, and the builder edits the same query
status: accepted
date: 2026-09-27
---

# ADR-0019 — An Atlas query is text, and the builder edits the same query

## Context

James (U-23) wants to ask across several types at once — tasks and projects —
follow a relation to the note it points at, filter by tag, sort, group and
sub-group, and keep the answer as a view he can open from the sidebar or put on
a dashboard. He wants it to read like SQL, and to be buildable from dropdowns.

A type's saved view (ADR-0007) is one type's `v_<type>` view, filtered by
controls. Hand-written SQL (P17-04) can do anything, but a person has to know
the index's tables and write the joins through `props` and `links` themselves;
nothing in it can be checked against the vault's types, and no dropdown can
edit it. Neither answers U-23.

## Decision

**A small language of its own, parsed and checked in the domain, compiled to
one read-only SQL statement.** The grammar, with keywords in any case:

```
query     = FROM type {"," type} {clause}              -- clauses in any order, each once
clause    = WHERE or
          | SORT BY field [ASC|DESC] {"," field [ASC|DESC]}
          | GROUP BY field [THEN field]                 -- a group, then a sub-group
          | SHOW field {"," field}                      -- the columns; default: what is mentioned
          | INCLUDE ARCHIVED
          | LIMIT whole-number                          -- 1 to 5000
or        = and {OR and}
and       = unary {AND unary}
unary     = NOT unary | "(" or ")" | condition
condition = field ("=" | "!=" | "<>" | "<" | "<=" | ">" | ">=") value
          | field CONTAINS value | field STARTS WITH value
          | field IS [NOT] EMPTY
field     = name ["." name]                             -- one hop through a relation
value     = word | 'text' | "text" | number | true | false | [[link]] | #tag | @today …
```

For example:

```
FROM task, project WHERE status != done AND project.owner = [[Julie]] AND tag = #q3
SORT BY due GROUP BY project THEN status
```

- **A field** is a property one of the listed types declares, or one every note
  has: `title`, `type`, `tag` (every tag, frontmatter and body — ADR-0018),
  `modified`, `path`. `project.owner` reaches one hop through a relation into
  the type it targets. A key two listed types both declare is one field, as the
  first type declares it.
- **The check knows the vault.** A type that does not exist, a field no listed
  type has, `<` on a select, a word where a date belongs, `@someday`, sorting or
  grouping by `tag` (a note has many) — each is an error at the characters that
  caused it, and the editor underlines them. The parser does the same for the
  grammar. A query that passes compiles to SQL the index can run: a long chain
  of `AND` or `OR` is compiled as a balanced tree, since SQLite refuses an
  expression nested 1000 deep, and a query holds 2000 conditions at most, so
  its values always fit in one statement.
- **Comparisons follow the kind.** Numbers compare as numbers, dates by the day
  as written — `2026-09-30T22:00-05:00` is the 30th — and sort to the moment
  (`2026-09-30`, or `@today`, `@tomorrow`, `@weekAgo`… — the same moving dates
  views have), text with `CONTAINS` and `STARTS WITH` ignoring case. A field
  with several values matches when any value does; `!=` means _no_ value is,
  so a note without the property is listed by `status != done`. An unticked
  checkbox is anything but `true`. `tag = #q3` matches `#q3` and every tag
  nested under it. A relation matches by the note it points at, resolved when
  the query runs; a link to a note that does not exist matches links written
  the same way.
- **Archived notes are left out** unless the query says `INCLUDE ARCHIVED`, as
  views and search leave them out (U-22). So are the notes Atlas keeps in
  `.atlas`.
- **Values are always bound.** The statement's text is made only of constants
  of the app; every name and value from the query is a bound parameter,
  through a fragment builder whose only way to take a value is to bind it. A
  column is named after its field, whose key comes from the vault's own type and
  is refused unless it is a plain identifier (ADR-0007). The statement runs
  through the index's read-only connection, the same guard every view uses.

**Relations are resolved in TypeScript and stored in the index.** Following
`project.owner` in SQL means joining a relation to the note it points at, and
which note `[[Atlas]]` means is a rule — the one `resolveWikiLinkTarget` applies
everywhere else. Re-deciding it in SQL would be a second copy of the rule that
drifts. So refreshing the index now gives every property written as a wiki link
a row in a new `relations` table — its key, its place in a list, the target as
written, and the note TypeScript resolved it to — and Rust only stores the rows
(ADR-0005). The index's schema version went to 7, so an existing cache is
thrown away and rebuilt, as it always is when its shape changes.

Each row also carries the target folded as links fold it — composed, extension
dropped, lower-cased in TypeScript (schema 8, A24-01). Finding the relations a
new or vanished note could now answer, and matching a link to a note that does
not exist yet, compare that name: SQLite's `lower()` knows only ASCII, so
`[[École]]` or `[[Later.md]]` would otherwise never be re-resolved. A note the
app moves or deletes takes the notes whose relations named it out of the index
with it, so the refresh that follows reads them again.

**The text is what is saved.** A query view is an ordinary note —
`atlas: view`, `layout:` and `query:` holding the text exactly as typed. Saving
writes the `query:` key, and `layout:` only when the layout was changed, through
the byte-preserving frontmatter write (ADR-0006), so the rest of the file is
untouched — a key given the value it already holds keeps its bytes. A blank
query is refused rather than saved: the note would stop being a query view. `sql:`
still wins over `query:`, and `query:` over a type's `type:`, so a hand-written
file that says several things is read one way.

**The builder edits the same query.** Its dropdowns — types; fields from the
schema, including a relation's fields and `tag`; the operators that fit the
field's kind; values from a select's options, the notes a relation can point
at, a date picker or a moving date — make an `AtlasQuery`, and the text shown is
that query printed. The builder can show a query whose conditions are all
joined by AND, or all by OR, each one plain or `NOT`; brackets that mix AND
and OR cannot be shown as one list, so such a query says why and stays
text-only rather than being flattened into something it does not mean. Text
typed by hand is saved as typed; the printed spelling replaces it only when the
builder changes the query.

**Grouping is done on the rows, not in SQL.** The statement returns each group
field as a column; `groupRows` (the board's rule) groups them, and groups each
group again for the sub-group, so a select's groups come in the type's order
and a relation's are named for the note.

## Consequences

- One hop only. `project.owner.team` is refused with a message; a second hop is
  a grammar change and a compile change, and the AST already has room for it.
- No `IN (…)`, no aggregates, no joins the person writes. `OR` covers the
  first; a dashboard's number and chart widgets still cover the second; hand
  SQL remains the escape hatch for the rest, and a query's compiled SQL can be
  read and taken there.
- A relation is re-resolved when a note it could name is made or goes away:
  refreshing the index asks which notes hold a link written as that name and
  reads them again, so `project.owner` never follows a stale answer. (Body links
  in the `links` table are not yet treated the same way.)
- Values in a query are case-sensitive for `=` (as views are), and
  case-insensitive for `CONTAINS` and `STARTS WITH`, which use `instr` rather
  than `LIKE` so `%` and `_` in a search mean themselves. Case is folded by
  SQLite's `lower()`, which folds A–Z only: `école` does not find `École`.
  Folding every letter would need a function registered in the host, which is a
  rule in Rust; it waits until it is asked for.
- A note sits in one group, so a field that holds several values — tags, a
  multi-select, a relation to many — cannot be grouped by, and says so. Sorting
  by one uses its first value; a relation sorts by the title of the note it
  points at.
- A relation's groups are the board's columns (`groupRows`), keyed by the note's
  name, so two notes with the same name in different folders share a group.
- Brackets and NOTs nest at most 64 deep; deeper is a problem in the text, not
  a stack overflow.
- A number keeps its spelling: `notes = 1.0` compares with the text `1.0`, and
  the builder never writes `1e+22`.

## Addendum, 2026-10-08 (P30-04): `this`, `LINKS TO`, and dates counted from today

A Person or Company page needs "this person's meetings in the last 30 days",
so the grammar gains two values and one condition:

```
condition = … | LINKS TO value                       -- value must be this
value     = … | this | @-30d | @+2w | @+1m | @-1y | @startOfWeek
```

- **`this` is the note the query is shown on**, handed to the compiler by
  whoever shows it (`thisNote`), never guessed. A query shown on no note — a
  saved view, a dashboard widget, an automation — cannot say `this`: the check
  refuses it at the word, before anything runs. It compares with a relation
  only, with `=` or `!=` (`people = this`, `company.owner = this`), and binds
  the note's path like any other value. `'this'` in quotes is still text.
- **`this` is now reserved.** A saved view, widget or automation that wrote a
  bare `this` to mean the word — `status = this` — no longer runs. It is not
  rewritten: the check points at the word and says to quote it, `'this'`,
  and the person decides. Such queries were judged rare enough not to need a
  migration.
- **`LINKS TO this`** asks the `links` table: the note's body links to the
  page, resolved as backlinks are, and a note's link to itself does not count,
  as it is not its own backlink. It takes only `this` for now: a link to a
  named note would need a rule for one that does not exist, and nobody has
  asked for it. The builder has no control for it, so a query that says it
  stays text, with a reason that says so. `links = x` still compares a
  property called `links`.
- **A count from today** — a sign, up to four digits, and `d`, `w`, `m` or
  `y` — and **`@startOfWeek`**, the Monday of this week as the calendar's
  weeks start. The domain still has no clock: a query the app runs asks the
  index for the day, over its own clock as `@today` always has, with the
  modifier bound; an automation pins each one to the day it is handed. A
  count reaches 1000 years at most: past the year 9999 the index dates
  nothing, so the check refuses it rather than let it match nothing. Both
  readings live in `query-language/moving-date.ts`, and a test runs the SQL
  on every weekday and the awkward month ends to prove they agree. A month
  counts as SQLite counts one: from 2026-01-31, `@+1m` is 2026-03-03. The
  builder offers `@startOfWeek` beside the named dates, and shows a count it
  holds as what it is ("30 days ago"), so it is never mistaken for no date.
- The API takes the note as `context` on `/v1/atlas-query` (ADR-0016): a note
  path in user space that must exist.

## Addendum, 2026-10-08 (P30-05): a query inside a note

A Person or Project page shows its own meetings and tasks, so a query can
live in a note's body:

````
```atlas-query
layout: list
FROM meeting WHERE people = this SORT BY date DESC
```
````

- **It is a fenced code block**, so Obsidian shows the code and nothing in the
  file is Atlas's alone. The fence's language is exactly `atlas-query`, with
  nothing after it on the line: a query block is written back with its
  language alone, so anything there would be lost on its first edit, and such
  a fence stays a code block. One rule reads it, `queryBlockOfCode` (domain).
- **It is one of the note's own blocks**, as a shown block is (ADR-0022): in
  a list, a quote or a callout the fence stays a code block, and a query block
  moved or pasted there is written as one (`nestedBlockOf`).
- **The editor holds it as an atom with its text** (`queryBlock`), like a
  shown block, not as an editable code block: the answer is drawn live and
  read-only, and the text is edited behind **Edit query**. Untouched, it is
  written from its own bytes (ADR-0003) — tildes, a longer fence and a block
  id on the line after it included.
- **`this` is the note it is in**, handed to the compiler as `thisNote` by the
  page that shows it. Where a note is only drawn — a feed, a page's picture, a
  shown block in another note — it is drawn as its code, never run, since
  that is not the note `this` would name.
- **A first line `layout: table` or `layout: list`** says how it is drawn; left
  out, a table. Any other layout, or no query, is a problem in the text,
  said in the block. The layout line is the app's, not the query's: a tool
  answering a block sends the rest, with the note as `context`.
- It is asked again whenever the index changes, and once typing in its text
  pauses.

## Addendum, 2026-10-11 (P30-06): linked pages, and `CONNECTED TO this`

A Person, Company, Project, Area or Meeting page shows its meetings, its
waiting-fors, its open tasks, its decisions and the notes linked with it; a
Task or a Decision shows the meeting it came from. Issue #25.

- **The sections are drawn from the page's type, not written into the note.**
  The card proposed query blocks in the built-in templates, plus an offer to
  append them to the pages a vault already has. A template only reaches notes
  made after it, so every existing person would have needed a write — a
  previewed, undoable, append-only one, but still hundreds of files changed
  and synced, and a second copy of each query to go stale in every note. Drawn
  from the type, every page of the type has the sections the moment the app
  opens, no file changes, and a fix to a section reaches every page at once.
  So nothing is appended to anything, the built-in templates are left as they
  are, and "existing pages are changed only after the preview is accepted"
  holds because they are never changed at all. What it costs: a section's
  query cannot be edited per page. A page that wants its own list still takes
  a query block (P30-05), and the two do not collide.
- **Each section is still an Atlas query, run as a query block's is** — `this`
  the page, compiled and checked by the same code, drawn by the same list.
  `linkedSectionPlans` (domain, `linked-pages`) writes them from the vault's
  own types, naming only fields the types declare: a meeting is found by
  `people = this` where Meeting has a relation to Person and by any link where
  it has none, a waiting section exists only where Task has a `waiting` status
  and a `waiting_on`, and a one-hop field (`waiting_on.company`) is used only
  through a relation to that type alone. A vault whose types are its own gets
  the sections its types can answer, never a query that fails its check.
  `readLinkedPage` (application) runs a page's sections at once — one bounded
  query each, `LIMIT 200`, never one per row — and a section that cannot be
  answered says why while the rest stand.
- **`CONNECTED TO this` is the one addition to the grammar.**

  ```
  condition = … | CONNECTED TO value                   -- value must be this
  ```

  A link joins the note and the page: from either to the other, written in a
  body (`links`) or held by a property (`relations`, which keeps every link a
  frontmatter value holds, whatever the property's kind). It is what "the
  tasks that came from this meeting" needs to mean today and after the meeting
  extraction lands (PR #102): today a task cites the meeting's turn in its
  `source`, a text property; after it, the meeting also lists the task in
  `tasks`. `LINKS TO this` reads bodies only and one way, as backlinks do, and
  was left as it is — its tests say a meeting that names a person in `people`
  does not "link to" them, and a query in someone's note may rely on that.
  Like `LINKS TO` it takes only `this`, the builder has no control for it, a
  note is never connected to itself, and `connected = x` still compares a
  property called `connected`.

- **Recent is 30 days, per section, remembered per page type on this Mac**
  (`localStorage`, as a view's folded groups are): the section's query gains
  `date >= @-30d` — or `modified`, for a type with no `date` and for linked
  notes. Sections of open work have no such switch: an open loop does not
  expire.
- **A waiting-for's age is the days since its file last changed**, the weekly
  review's measure (ADR-0029): Atlas keeps no "waiting since" key, so any edit
  to the task restarts the count. The query shows `modified`; the age is
  worked out in the domain from the clock the app is given.
- **Open tasks are grouped by status in work order** — Next Action, In
  Progress, Inbox, Backlog, then what is parked — not the type's order, which
  runs Inbox first. A project or an area with open tasks and none at Next
  Action or In Progress says so, by the weekly review's rule for a project
  without a next action; the hint is held back when the list was cut off.
- **Not done.** Notes with no type are not in "Linked notes": a query lists
  types, and a note without one still shows under Links at the page's foot. A
  section's query cannot be edited from the page, and nothing copies one out
  as a query block. Where Meeting declares a relation for people, a meeting
  that names a person only in its text is not under their Meetings; it shows
  under Links at the page's foot.
