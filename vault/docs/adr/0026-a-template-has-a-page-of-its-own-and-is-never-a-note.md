---
type: adr
id: ADR-0026
title: A template has a page of its own, and is never one of the vault's notes
status: accepted
date: 2026-10-04
---

# ADR-0026 — A template has a page of its own, and is never one of the vault's notes

## Context

Issue atlas-archive#16. James: "I don't see where or how to add and edit templates." A
template is an ordinary note in `.atlas/templates`, and its file name is what
ties it to what it makes: `Person.md` is what a new Person starts as (matched
by the type's label, then its name, in any case), `Daily.md` makes today's
note, `Task.md` a captured task, `Artifact.md` a saved artifact. The only way
to one was the System folder at the bottom of Pages — nothing said a type had
a template, nothing made one, and nothing said what one was.

Being an ordinary note also made a template look like one. ADR-0014 made every
`.atlas` note a link target, a search hit and an `[[` suggestion. Issue atlas-archive#15 is
what that costs: a relation's "create new" opened the Company template,
James renamed it to the company he meant, and the template was gone — his
person now linked to it.

## Decision

**Templates are listed in one place, the Templates page, and leave the vault's
notes.** `.atlas/templates` joins the views and dashboards folders in
`SECTIONED_ATLAS_PATHS`: the places that another part of the app already lists.
It is the rule ADR-0013 already wrote down — "adding a section for something
in `.atlas` means adding its path here" — and with it a template drops out of
Pages, link resolution, `[[` suggestions, relation pickers, the index and so
search, in one line. Type definitions, sources and settings stay where
ADR-0014 put them. The folder is matched in any case — the Mac's disk takes
`.atlas/Templates` for `.atlas/templates`, so it is hidden, and a template,
too. The graph, Links here, `[[` suggestions, search and unlinked mentions
drop a template path even when the index still hands one over, and the index
schema went to 10 so that link rows resolved to a template before this are
read again.

**A type's template is a press from the type.** Beside Edit type — the gear on
its tabs, its sidebar menu, its own page, and "Edit Person template" in the
palette — is Edit template. It opens the type's template in a pane, and when
the type has none it first writes one named after the type's label — or after
the type's name, an identifier, when the label cannot be a file name
(`Q&A / Notes`, `.NET project`) — holding `type:` and each of the type's
properties as an empty key (`role:` with nothing after it, so a new note gets
no value rather than an empty string; a key YAML would misread, `a: b` or
`#ref`, is double-quoted). Pressed twice at once, both presses land on the one
template.

**The Templates page lists every template and what uses it** — "New Person
notes", "Today's note", "Captured tasks", "Saved artifacts", or "Only the New
menu", naming every type a template serves — with Edit, Rename, Move to notes
and Delete (to the Trash, after the usual question), and New template for a
type without one or for no type. It lists every markdown file under the
folder, `.md` or `.markdown`, subfolders included, since the tree no longer
shows any of them; a rename stays in its folder and keeps its extension. A
rename or a delete says first what stops using the template ("New Person
notes will start empty", "Today's note will start blank"). A template made
for a type takes the type's template name, not one typed over it, because
the name is what ties it to the type. A template's name may not end with a
dot, as no note's may, and a note made from one is cut to fit 255 bytes.

**A template that is really a note can be made one again.** Move to notes, on
its row and on its band, asks first and then moves the file to the top of the
vault under its own name — numbered when a note there has it — with its bytes
untouched. Its links resolve to it again and it stops being what new notes
start as. This is the way out for a note written in the templates folder by
mistake, such as a company saved over its type's template (issue atlas-archive#15). A page, like the
Archive and Automations, rather than a Settings section: a template is
content you open and write in, and Settings is a dialog that would have to
close to show it. It is reached from a sidebar row, the palette ("Templates"),
and the band over any template.

**A template being edited says so.** The pane shows it as a note — properties
then text, since those are what it gives — under a "Template · Used for: …"
band, with no favourite star (the mark would be copied into every new note)
and no Move, Archive or graph; the band's own Move to notes is the one way
out of the folder. A template's own frontmatter is never read as
what it makes: the Dashboard template's `atlas: dashboard` no longer turns its
pane into a dashboard. Its title renames it through `renameTemplate`, and its
Delete goes through `deleteTemplate`, never through the note flows.

**Every way to make a note of a type uses the template.** "New book" at the
foot of a type's table now starts from the type's template, as the add button,
people and capture already did, so editing a template changes what every new
note of that type starts as. Notes already made are copies and do not change.

The rules are the domain's (`templates/template-rules.ts`: which type a
template serves, what it is used for, a template's name, what a type's new
template holds); the use-cases are the application's (`types/manage-templates.ts`:
catalog, ensure, create, rename, delete); the page and band hold none. Every
write is a create, a move or a trash — a template's bytes are only ever written
by the editor, through the byte-preserving save (ADR-0003).

## Consequences

- ADR-0014's "a template is a note you can already open in the tree; it being
  unlinkable was the inconsistency" no longer holds for templates. A link
  written as `[[Person]]` that used to reach the Person template now resolves
  to a note called Person, or nothing — the second is what issue atlas-archive#15 asks.
- Templates are not indexed. A template that names a tag no longer counts as a
  use of it; one that links a note is no longer a backlink. Neither ever meant
  anything a person wanted.
- The template is matched by its file name, so renaming one on the Templates
  page can detach it from its type; the page warns while the new name is
  typed, and says at once what it is now used for. Two templates that both answer to a type (`Person.md` and `person.md`
  on a case-sensitive disk) are resolved label-first, as before.
- A template in a subfolder is offered by name like any other; of two with
  one name, the one nearer the top of the folder answers first.
- Matching the folder in any case also hides `.atlas/Views` and
  `.atlas/Dashboards` from user space. On a case-sensitive disk those would
  then be listed nowhere; Atlas's vaults live on the Mac's case-insensitive
  disk, where they are the sectioned folders themselves.
- The local API's `POST /v1/notes { template }` still reads templates directly
  from the folder, and now matches a name in either Unicode normalisation.
  Templates are listed and read through the API and the MCP
  (`GET /v1/templates`, `GET /v1/templates/{name}`); making, renaming,
  editing, moving and deleting them stay in the app — ADR-0016, "Templates:
  read, not written", says why.
