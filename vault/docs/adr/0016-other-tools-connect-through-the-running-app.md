---
type: adr
status: accepted
date: 2026-09-22
---

# Other tools connect through the running app

## Context

James wants other tools — Claude Code, Claude Desktop, scripts, Raycast — to read
and write the vault through Atlas: search it, read a note, create one from a
template, set a property, capture a task, run a view. Two shapes were asked for:
a plain **API** anything can call, and an **MCP server** AI tools can start.

The files are already open to anything. What another tool cannot get by reading
the folder is what Atlas knows: the types and their properties, templates, the
index, saved views, and — the one that matters most — which notes are open in a
pane right now with edits not yet saved.

Three places the API could live were weighed:

1. **Inside the running app.** A localhost server in the Rust host that
   authenticates a request and hands it to the webview, where the same
   TypeScript use-cases the UI uses answer it.
2. **A headless sidecar** that loads the vault itself and works with the app
   closed.
3. **The MCP server reads the folder directly**, with no API at all.

## Decision

**The API is served by the running app, and the MCP server is a thin translator
onto it.**

- The Rust host listens on `127.0.0.1` only. It checks the token, the `Host`
  header and the body size, then emits the request to the webview and waits for
  the answer. It decides nothing about what the request means (ADR-0005): the
  router and every rule behind it are the TypeScript that already runs the UI.
- REST under `/v1` is the single contract, typed in
  `packages/application/src/api/contract.ts` and described for people in
  `vault/docs/api/v1.md`.
- `apps/mcp` is a Node program speaking MCP over stdio. Each tool is one REST
  call. It holds no rules, reads no vault files, and finds the app through the
  connection file.

Why in-app rather than a sidecar: **a write to a note that is open in a pane must
go through that pane.** The board already does this for drags
(`setPropertiesIfOpen`, `reloadOthers`), because writing the file behind an open
editor is how edits get lost — the editor saves its older copy over it. Only
code in the same process as the panes can see them. A sidecar would either write
behind them or need its own channel into the app, which is this design with
more parts. The price, accepted: **Atlas must be running** for the API to
answer, the same bargain Obsidian's Local REST API makes. A headless mode can be
added later behind the same contract without any caller noticing.

Why not option 3: it would reimplement types, templates, frontmatter editing and
the byte-preserving save in a second program, which is the drift ADR-0005 exists
to prevent, and it would still write behind open editors.

## Security model

A localhost port is reachable by every process on the machine and, through DNS
rebinding, by any web page open in a browser. So:

- **Off by default.** Turned on in Settings, per machine.
- **Bearer token** on every request, 32 random bytes as hex, compared in
  constant time. Rotating it in Settings invalidates the old one at once.
- **Bound to `127.0.0.1`,** never `0.0.0.0`.
- **`Host` must be `127.0.0.1:<port>` or `localhost:<port>`** — this is what
  defeats DNS rebinding, where a page's own domain resolves to `127.0.0.1`.
- **Any `Origin` header is refused.** Browsers send one; the tools this is for
  do not. There is no CORS, so no page can read an answer even by accident.
- **A request target that names a host is refused** (`GET http://…/v1/…`,
  absolute form): RFC 9112 makes that authority, not `Host`, the request's
  host, so the `Host` check could otherwise be judging the wrong thing.
- **Bodies over 1 MiB are refused** before they are read into memory.
- **Connections are bounded (A15-01).** At most 32 are open at once; more wait
  in the kernel's accept queue until one closes, costing the app no file
  descriptors. Each connection takes no new request after 60 s and is closed
  60 s after that whatever it is doing — longer than any legitimate request
  (10 s headers + 10 s body + 30 s answer), so only a stalled client, such as
  one that stops reading its answers, is ever cut off. Without this any local
  process could exhaust the app's descriptors and make vault saves fail.
- **Only a token holder keeps a connection (R15-02).** Every refusal the host
  makes before the router sees a request — 400, 401, 403, 404, 413 — is sent
  with `Connection: close` and the connection is closed, so a caller without
  the token cannot pipeline refused requests or sit on a slot. Availability
  against local processes is otherwise out of scope: a process running as the
  same user can kill Atlas outright, and loopback gives no per-peer identity
  to account connections against, so the bounds above protect the app's
  descriptors, not a fair share of the API.
- **The connection file** — port, token, version — lives in the app's data
  directory (`~/Library/Application Support/<bundle id>/api.json`) with mode
  `0600`. **Never in the vault**: vaults get synced and shared, and a token in
  one is a token published. A file found readable by anyone else (restored
  from a backup, copied by hand) is made `0600` again **and its token
  replaced**, since it may already have been read.
- **A taken port replaces the token.** When Atlas starts with the API on and
  its recorded port is held by another process, that process may have been
  collecting the token from tools knocking there while Atlas was closed. Atlas
  replaces the token before serving on the port the OS gives it, and logs that
  it did (never the token). Clients connect to `127.0.0.1` literally.
- **Turning the API on or off is all-or-nothing.** If the connection file
  cannot be written, nothing changes: a turn-on serves nothing, and a turn-off
  leaves the API on and says so, rather than the file and the server
  disagreeing.
- **No delete and no rename in v1.** Every write is additive or guarded:
  `PUT .../body` requires `ifModified`, a body write to a note with unsaved
  edits in the app is refused with `unsaved_in_app`, and SQL runs on the
  index's read-only connection under a row cap and step budget.
- Each request is bound to the vault open **when it arrived** (R14-01's
  `inVault`); a vault switch mid-request makes its write refuse rather than
  land in the other vault.

## Consequences

- One contract, three builders: router, host and MCP server can be written in
  parallel against the same types.
- Every new capability the UI gains is an API route away, with no rule copied.
- The app being closed is a clean `ECONNREFUSED`, which the MCP server turns
  into "Atlas is not running" rather than a stack trace.
- A long request holds a webview task; the host gives up after 30 seconds with
  `timeout` so a stuck handler cannot hold a caller forever.

## Later routes (2026-09-27)

Images for notes, calendar ranges, quick add and source refresh were added on
these terms, unchanged. An image is written a chunk at a time like an
artifact's files, never over a file, and never into the note: the caller adds
its markdown with the guarded body routes. A source refresh is the one route
that reaches outside the vault; it runs the app's own refresh bound to the
request's vault, so ADR-0017's host-side binding decides where any secret goes,
and nothing about secrets is readable. What stays out — writes into `.atlas`
(types, views, dashboards, settings), moves and deletes, secrets, picking a
file — is listed in `vault/docs/api/v1.md`, with why.

## Hardening (A20-02, 2026-09-27)

An adversarial pass found the terms above too loose in four places. Each is
now closed where the rule belongs:

- **A source that spends a secret runs only from `.atlas/sources`.** The
  binding in ADR-0017 checks the host a secret goes to, not the path, so a
  note the API wrote in user space could spend the user's token on any page of
  that host and read the answer back. Such a source — and one reading a SQLite
  file outside the vault — refreshes only from `.atlas/sources`, which the API
  cannot write; elsewhere the route answers `forbidden` and fetches nothing,
  and the pane says to move it into System → sources. The API refreshes one
  source at most every 30 seconds (`conflict` with `retryAfter`).
- **A chunked image is staged, never appended into the vault.** Its first
  chunk (`last: false`) goes to `.atlas-cache/uploads/<id>`, answered with an
  id no one can guess; every next chunk must carry it; the last (`last: true`)
  has the whole image checked and moved into place under a free name. A chunk
  past offset 0 without a valid id is refused, so no caller can add to a file
  it did not start. An abandoned staging file is inert (the cache is
  disposable; nothing prunes it yet). An image that fits in one request is
  saved at once, as before. Artifact files keep their offset contract: they
  land in a copy folder the API made for the note, and moving them to staging
  would change the thumbnail flow for no gain on this card.
- **An SVG must be a picture.** Its root element must be `<svg`, and an HTML
  doctype, `<html`, `<script` or an `on…=` handler anywhere refuses it.
- **A link cannot carry a path into a hidden folder.** The API keeps callers
  out of `.atlas` and `.git` by what a path says; the host now refuses any
  path whose canonical form lands in a hidden top-level folder the path did
  not name, so `Notes/settings.md` linked to `.atlas/settings.md` is refused,
  for the app as well as the API.

`atlas_add_image` is a confused deputy by nature — the MCP server reads the
disk as the user for a client that may not be able to. It reads a `file` only
under `~/Desktop`, `~/Downloads`, `~/Pictures` or the temporary folder
(`ATLAS_MCP_IMAGE_DIRS` overrides), after resolving links, when its own
extension is an image kind, its bytes are that kind, and `stat` says it is at
most 20 MB — before any byte is read or sent. `name` cannot change the kind.
A file that is missing, not a file, or outside the folders gets one answer.

## Tags (Phase 20, 2026-09-27)

Listing tags, the notes using one, and renaming one were added on these terms.
Renaming a tag is not the rename v1 leaves out: no file moves, and what it
writes is notes' text in user space, the class `PATCH .../properties` already
is. It runs the tags page's own use-case, so every note is read again and
written byte for byte against the version it read. Three things differ from
the page, because the caller is not the person at the keyboard:

- **A note being typed in is left alone and reported**, never flushed: the page
  saves its own pane's typing first, but a request from outside must not save
  what someone is still writing, as it may not write a body under it.
- **`.atlas` and hidden folders are never written.** A template's `tags:` is
  listed as skipped; the rename reaches user space only.
- **A merge must be asked for.** Renaming into a tag already in use joins the
  two, and renaming back cannot part them, so it is refused with `exists`
  unless the request says `merge: true`; `dryRun` shows `mergesInto` first.
  A tag used only as the parent of others is in use (renaming `#alpha` to
  `#beta` when `#beta/y` is written is a merge). Renames in a vault run one at
  a time through one queue the tags page shares, and the merge is asked again
  just before writing, counting names earlier renames wrote that the index has
  not caught up with (A20-04).
- **Tags are counted in user space.** The tree, a tag's lookup and its notes
  read only the notes the API reads, so a tag only a template uses is
  `not_found`, as its notes are left out of `/v1/notes`.
- **A timed-out rename may still finish.** The rename writes note by note and
  does not stop when the caller stops waiting; a caller checks with
  `dryRun: true` before retrying. The MCP tool previews unless told
  `dryRun: false`.

## Amendment: the Archive is the one move (A20-06, 2026-09-27)

"No delete and no rename in v1" gains one exception: `POST /v1/archive` and
`POST /v1/unarchive` move notes. They are the only routes that do, and they are
held to these limits, so that a caller can file a note away and bring it back
but cannot use them to put a note anywhere it likes:

- **User space only.** Every path named is a `.md` note outside `.atlas` and
  hidden folders — the pruned names (`node_modules`…) matched in any case, as
  the disk matches them.
- **Never over anything.** Each move is an exclusive rename: the host refuses a
  destination that exists, and a taken name is numbered first (`X 2.md`).
- **The destination is fixed by the note's own path.** Archiving files
  `P` at `Archive/P`; unarchiving puts `Archive/P` back at `P`. The note's
  `archivedFrom` is used only to spell that same place as it was (another case
  or composition, or without the number archiving gave a clashing name). An
  edited stamp — through `PATCH .../properties`, `POST /v1/notes` or by hand —
  cannot send a note to another folder, give it another name or extension, or
  make folders anywhere but on the way to that place. A note whose place in the
  Archive would be deeper than the host's walk reads (`VAULT_WALK_DEPTH`, a
  domain constant handed to the host with the skip list, ADR-0014) is refused.
- **At most 100 paths** a request.
- **Typing is never saved for anyone.** A note open in Atlas with unsaved
  typing is not moved or stamped, and a note linking to a moved one that has
  unsaved typing is not rewritten; each is reported in `failed` with
  `code: "unsaved_in_app"`. The app's own Archive command runs the same
  use-case with the typing saved first, because there the person asked.
- Every note left unmoved or not fully updated — a link rewrite that failed,
  unreadable YAML — is named in `failed`, and a vault switch part-way still
  answers the moves already made.

## Atlas queries (Phase 24, 2026-09-27)

`POST /v1/atlas-query` runs an Atlas query (ADR-0019) on these terms,
unchanged: it names its vault, reads only, and runs through the same checked,
bound, read-only path as the query builder. A query's text is refused over
200,000 characters or 2000 conditions; its rows are 1 to 5000, the text's own
`LIMIT` winning when smaller. Archived notes are included only by the text's
`INCLUDE ARCHIVED` — the route takes no `includeArchived` of its own. Saving a
query as a view is not a route: a query view is a note in `.atlas/views`, which
the API never writes.

## Automations are read, not run (Phase 25, 2026-09-27)

Automations get three routes, all read-only: `GET /v1/automations` (every rule,
its last and next run, and why one is paused or broken),
`GET /v1/automations/{id}/log`, and `POST /v1/automations/{id}/dry-run`.
Running a rule, undoing its last run, turning one on or off, and making,
editing or deleting one stay in the app. Why:

- **Rules and logs live in `.atlas`, which the API never writes.** A rule is a
  standing order: a caller that could write one could have the vault archived
  or rewritten on a schedule, long after the call and with no one asked. The
  log is what undo reads to put notes back; a caller that could write it could
  have undo put back something that was never there.
- **A run changes many notes at once.** One run moves or rewrites up to 500
  notes, and the app runs rules one at a time, logs each run, and offers its
  undo on the page that reports it. A run from outside would do the same with
  no one watching that page, while the app's own clock may be running another
  rule. Anything a rule does to a note can still be done note by note through
  the routes that exist — `POST /v1/archive`, `PATCH .../properties` — each
  under its own guards.

The dry run is the one POST that writes nothing: it runs `planRun`, the same
use-case the app's Dry run and every run plan with, and reads only the notes
and the index. Every route names its vault and answers `no_vault` if another is
opened while it reads; a query the rule holds that does not read, or that the
index refuses, is `query_failed` with this machine's paths taken out. What only
the app's runner knows — when it began watching the vault, and which rules its
clock has paused — is read through a port the app fills (`AutomationClock`),
for the request's vault only, so a rule's next run and pause are the ones the
Automations page shows.

## A view's groups: read, moved into, added to (issue atlas-archive#6, 2026-10-03)

Saved views gained a sub-grouping (`subGroupBy`: a table's sub-groups, a
board's swimlanes). The API follows on the same terms as every route above —
each names its vault, hands out no secret, and writes through the
byte-preserving property and create paths:

- **Read.** `GET /v1/views` names each view's `groupBy` and `subGroupBy`, and
  running a grouped view answers its groups and sub-groups as the app draws
  them (`groups`, shaped as an Atlas query's).
- **A card moved on a board** is `POST /v1/views/{path}/move`. Its completion
  rule — which property finishing means, and rolling a repeating task forward
  once — is `cardMoveChanges`, the one the board's drag calls; the route only
  reads the view, its type and the note, and never decides it again. A group
  is one the board draws, matched by `groupKeyOf` — the key the board's own
  columns are drawn by — and written typed by its property's kind (`movedValue`,
  which the drag uses too). A group the card is already in is left out of the
  write, as a drag within a column writes nothing. That alone does not stop a
  retry: a finished repeating task is back in its first status, so the same
  move would finish it again. A move that finishes a task therefore requires
  `ifModified`, which makes the retry a `conflict`, and the MCP tool is not
  marked idempotent. Only a board's cards move — never a view or dashboard
  note, whose `type:` names what it lists; anything else is a property write,
  which the API already has.
- **A note added in a group** is `POST /v1/views/{path}/notes`, given the
  group's values typed by `groupValueProperty`, the rule "+ New" uses.
- **Not a route: changing a view's grouping.** A view is a note in
  `.atlas/views`, which the API never writes; a caller that could regroup one
  could rewrite the views James keeps in his sidebar. Grouping, like the rest
  of saved-view editing, stays in the app.

## A type's views: read, not changed (issue atlas-archive#11, 2026-10-04)

A type now owns its views, shown as tabs a person can add to, rename, copy,
drag into another order and delete (ADR-0023). The API follows on the same
terms as every route above:

- **Read.** `GET /v1/types/{name}/views` answers a type's tabs in the order
  the app draws them, each with its `title`, `layout`, `path` and `order:`,
  and — for a type with no views — the virtual default table, marked
  `virtual`, under the name and path the app would write it to. The route
  only reads the sidebar catalogue and the types; which views a type owns,
  their order and the default's name are `typeViews` and `defaultViewTab`,
  the rules the tabs use, never decided again. It names its vault, and answers
  `no_vault` if another is opened while it reads. Asking writes nothing, the
  default included: ADR-0023 keeps a look from writing to a synced vault.
  `GET /v1/views` names each view's `order` beside its `title`.
- **After its review (same day).** The default's name is checked against one
  list, `takenViewPaths`, which the route, the app's tabs and the app's write
  all use: every entry in `.atlas/views` (from the folder's listing, so a
  note that is no view still holds its name, and a view lifted to Today or
  Inbox is not missed) and every view found elsewhere, compared in any case
  and in NFC, as APFS compares. The route pages by `limit` and `offset` with
  a `total`, as `/v1/archive` does — tab order is not path order, so a path
  cursor cannot mark a page's end. `GET /v1/views` now lists Today and Inbox
  too, first: they are views, and a caller could not otherwise find their
  paths to run. `order: "0x10"` is no order: only a plain decimal counts.
- **Not routes: adding, renaming, copying, moving and deleting a type's
  views.** Each is a write into `.atlas/views`, which the API never writes.
  Why each stays in the app:
  - _Adding and copying_ make a new file in `.atlas/views`, and the first
    change to a type with no views writes its default table as well. A caller
    that could make views could fill the sidebar James keeps, and a copy is a
    byte-for-byte duplicate of whatever a view holds — its SQL included.
  - _Deleting_ is a delete, and v1 has none (Security model): the app's
    delete goes through its usual question, to the Trash.
  - _Renaming and moving_ write one key of an existing view — `title:` or
    `order:` — and are the only candidates for an exception. They change how
    the tabs read, not what a view lists. But the rule is drawn by path, and
    enforced twice by path (the router, and the host's hidden-folder check):
    letting these through means a key allowlist inside `.atlas`, a new kind of
    guard that must refuse `type:`, `filters`, `sql:` and every other key that
    changes what a view means, and a move may renumber several views at once
    (`movedViewOrder`) — a write to many `.atlas` files from one call. Renaming
    the virtual default would also create a file there.

  So the API stays read-only for views. A view kept outside `.atlas` is an
  ordinary note: its `order:` and `title:` can be written with
  `PATCH /v1/notes/{path}/properties` like any other note's, as they always
  could; the tabs read whatever is there.

- **Proposed, not accepted: a narrow write for rename and reorder.** If James
  wants an agent to tidy a type's tabs, the exception would be one route,
  `PATCH /v1/types/{name}/views/{path}` taking `{ title }` or `{ to }` and
  nothing else, running the app's own `renameTypeView` / `moveTypeView`
  use-cases (so `movedViewOrder` decides what is written), byte-preserving,
  requiring `ifModified` for the moved view, refusing a virtual default
  (nothing in `.atlas` is created), and refusing any path that is not a view
  the named type owns. Adding, copying and deleting views stay in the app
  either way. Until this section is amended to accept it, nothing writes
  `.atlas/views` through the API.

## Templates: read, not written (issue atlas-archive#16, 2026-10-04)

Templates now have a page of their own and are never notes (ADR-0026): the
Templates page lists each with what makes notes from it, and makes, renames,
edits, moves to notes and deletes them. The API follows on the same terms as
views above:

- **Read.** `GET /v1/templates` lists every template — every markdown file
  under `.atlas/templates`, `.md` or `.markdown`, subfolders included — with
  its `uses` (a type's new notes, today's note, captured tasks, saved
  artifacts) and the types no template serves. `GET /v1/templates/{name}`
  answers one template's parsed properties and its body byte for byte. The
  routes only read: the catalogue is `loadTemplateCatalog` and what a
  template is for is the domain's `templateUses`, the rules the page uses;
  which template a name means is `findTemplateNamed`, the lookup
  `POST /v1/notes { template }` makes, so reading one by name answers what a
  note made from it starts with. Both name their vault and answer `no_vault`
  if another is opened while they read.
- **A name is matched as the disk matches it.** `findTemplateNamed` now
  compares through the domain's `isTemplateNamed` — trimmed, in any case and
  either Unicode normalisation — the comparison `isTemplateFor` already made.
  Before this, `POST /v1/notes { template: "Café" }` sent decomposed missed a
  `Café.md` written composed, though the Mac's disk takes the two for one
  file.
- **After its review (same day): which of two templates a name means.**
  Templates were sorted by `localeCompare` on their names, with depth only
  breaking exact ties, so of `Meeting.md` and `Old/meeting.md` (or
  `Old/ Meeting.md`) the deeper one sorted first and the case-folding lookup
  took it — the read route and `POST /v1/notes` both started from the
  subfolder's file. The order is now the domain's `compareTemplates`: by the
  name as lookups fold it, in one fixed locale, then nearer the top, then as
  written. The Templates page and the app's lookups read the same order.
- **No note route hands out a template.** Every note route already kept to
  user space (`isApiNotePath`), so a template was never a note here; tests now
  pin it for the notes list, search hits and backlinks the index still holds,
  and a template path asked for as a note.
- **Not routes: making, renaming, editing, moving to notes and deleting a
  template.** Each writes `.atlas/templates`, which the API never writes.
  Why each stays in the app:
  - _Making and editing_ decide what every new note of a type, today's note
    or every captured task starts as. A caller that could write a template
    could put text or properties into notes made long after the call, by
    James, with nothing saying where they came from.
  - _Renaming_ can detach a template from what uses it, since the name is
    what ties it to a type (ADR-0026); the page warns while the name is
    typed. A route would do it silently.
  - _Deleting_ is a delete, and v1 has none (Security model).
  - _Moving to notes_ is the one candidate for an exception: it moves a file
    out of `.atlas` into user space, bytes untouched, and is the way out for
    a note saved over a template by mistake (issue atlas-archive#15). But it is a move of
    a file the API cannot otherwise name, and a caller that moved the Person
    template out would leave new Person notes starting empty.

  So the API stays read-only for templates. `POST /v1/notes { template }`
  still makes notes from them, as it always could.

- **Proposed, not accepted: move to notes.** If James wants an agent to clear
  up a note saved over a template, the exception would be one route,
  `POST /v1/templates/{name}/move-to-notes`, running the app's own
  `moveTemplateToNotes` (numbered at the root, bytes untouched, never over a
  note), answering `{ note, lost }` with the uses it ends, and taking
  `ifModified` so it moves only the template the caller read. Making,
  renaming, editing and deleting templates stay in the app either way. Until
  this section is amended to accept it, nothing writes `.atlas/templates`
  through the API.
- **Later: "New <type>…" in relation pickers** (issue atlas-archive#15, another branch)
  makes a note of a type and links it from the note being edited. When it
  lands, the API/MCP keeper decides whether it is a route of its own or
  `/v1/quick-add` followed by `PATCH /v1/notes/{path}/properties`, which
  callers can already do.

## Proposals: listed, accepted, rejected (P29-02, 2026-10-08)

Proposals are notes of the built-in `proposal` type in `Inbox/Proposals/`
(ADR-0028), answered on the Proposals page. The API follows on the same terms
as every route above, through the page's own use-cases (`listProposals`,
`acceptProposalNote`, `rejectProposalNote`), so no rule is decided twice:

- **Read.** `GET /v1/proposals` lists the open ones with what each would
  write, and names any it cannot read.
- **Accept writes a note in user space, and nothing else of the caller's
  choosing.** What is written is the proposal's own payload, by
  `applyProposal`: a new note of the kind's type, made with the exclusive
  create, never over a note (a note already at its path is a refusal, since
  it may be the very one proposed); or one link added to a relation of an
  existing note, through the byte-preserving frontmatter write, guarded by
  the digest the proposal recorded and the note's modified time. A payload's
  folder may not be hidden, the Archive or the proposals folder.
- **The proposal moves, by the Archive's rules.** Accepting or rejecting
  files the proposal in the Archive at its own path, through `archiveNotes`
  — the amendment above holds: user space only, never over anything, the
  destination fixed by the note's path. These are the only routes besides
  `/v1/archive` that move a note, and each moves only the proposal it names,
  only from `Inbox/Proposals/`.
- **Typing is never saved for anyone.** A proposal, or a link proposal's
  note, open in Atlas with unsaved typing is refused (`unsaved_in_app` for
  the proposal; `conflict` with the reason for the note), and nothing moves.
- **Every refusal the vault causes is `conflict`**: decided already, a note
  already there, a note changed since the proposal was made. Two accepts at
  once make one write; the second is a `conflict`.
- **Not routes: Edit and Undo.** Editing a payload is the person changing
  what Claude proposed; a caller that wants something else written has the
  note routes. Undo takes back an accept only if nothing changed what it
  made since, and is offered once on the page that reported it, from what
  the app holds. Making proposals is P29-03's Claude step, inside the app.

MCP: `atlas_proposals` (read-only), `atlas_accept_proposal` and
`atlas_reject_proposal`. Accepting through MCP is James asking his own Claude
to accept for him; the step that _makes_ proposals unattended (P29-03) has no
tools at all (ADR-0028), so it cannot accept its own.
