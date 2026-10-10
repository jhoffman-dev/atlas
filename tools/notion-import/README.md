# Notion workspace import

`tools/import-notion-workspace.mjs` (issue #79) brings a whole Notion
workspace export into an Atlas vault: tasks, notes, meeting notes, people,
PARA, teams and daily notes, with relations written as wiki links. Run it
again whenever you like: it matches each page to its note by `notion_id`,
updates in place, never makes a second copy, and never writes over a change
you made in Atlas.

The Meeting Notes database goes through the meeting import
(`tools/import-notion-meetings.mjs`, P28-07, described in
`tools/n8n/README.md`) with its rules unchanged: one file per meeting in
`Inbox/Meetings/`, checked against the contract, and Gemini's rows held until
`--gemini-dates arrival-local`.

## What goes where

| Notion database                      | Atlas type                | Folder                        | Properties                                                                                                             |
| ------------------------------------ | ------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tasks (`Tasks`, `Tasks Tracker`)     | `task`                    | `Tasks/`                      | `status` (GTD, below), `notion_status`, `priority`, `effort`, `task_type`, `tags`, `due`, `project`, `people`, `notes` |
| Notes                                | `notes`                   | `Notes/`                      | `tags`, `date`, `project`, `people`, `tasks`, `related`                                                                |
| Meeting Notes                        | `meeting` (meeting/v1)    | `Inbox/Meetings/`             | as the meeting import writes them                                                                                      |
| People                               | `person`                  | `People/`                     | `email`, `slack`, `role`, `team`                                                                                       |
| PARA, Type Project                   | `project`                 | `Projects/`                   | `priority`, `start`, `end`                                                                                             |
| PARA, Type Area                      | `area`                    | `Areas/`                      | `priority`, `start`, `end`                                                                                             |
| PARA, Type Resource                  | `resource`                | `Resources/`                  | `priority`, `start`, `end`                                                                                             |
| PARA, Type Archive                   | `project`, `status: done` | `Archive/Projects/`           | `priority`, `start`, `end`, and the Archive's `archived` / `archivedFrom`                                              |
| Teams                                | `team`                    | `Teams/`                      |                                                                                                                        |
| Daily Notes (`Daily Notes`, `Daily`) | `daily`                   | `<YYYY-MM-DD>.md` at the root | `date`, `tags`                                                                                                         |

Every note also gets `source: notion` and `notion_id`, and its page's content
as its body. A database is known by its name, without emoji or case. A note
already in the vault stays where it is, under its own name: the import finds
it by `notion_id` wherever you moved, renamed or archived it.

- **Daily notes** go where Atlas keeps them: `<YYYY-MM-DD>.md` at the root,
  the day read from the page's Date (else its title). A day that already has
  a note in the vault is filled in, never written over.
- **PARA Archive items** go where archiving puts a project,
  `Archive/Projects/<name>.md`, stamped as archiving stamps it, so
  unarchiving in Atlas takes it back to `Projects/`.
- **Types.** The import writes no type files. When the vault does not declare
  a type its notes are written as (`team`, `area`, `resource`, `daily`,
  `notes`…), the report warns: open the vault in Atlas first, which adds the
  types it builds in once the PARA and GTD work is merged, or add the type.

- **Relations become links** to the names Atlas gives their notes: `project:
"[[Larkspur Payroll renewal]]"`, `people: ["[[Mara Quill]]"]`. Every page's
  path is planned before anything is written, so a link names the note it
  will open, including one already in the vault under another name. Where a
  name alone would open another note, the link carries the path. A link to a
  Meeting Notes page names the note the meeting import placed it in, in the
  same run. A relation that names a page by its id links that page's note
  or, when it has none this run, its title, listed — never another page that
  happens to share the title. A related page named only by its title is
  matched to the one page of that title, or linked by its title and listed.
- **Links in a page's text** to another page of the export become wiki links
  too. Images, attachments and any other links are left as written.
- **Names.** A new note is named after its page's title, without what no
  file name or no link can hold (`/`, `:`, `#`, `|`, `[`, `]`…), a `.md` or
  `.markdown` ending kept as a word, cut to what a file name can hold, and
  numbered when a note of that name is already in the folder — or when the
  name would take over `[[links]]` that open another note now (the rule Atlas
  follows when it adds a person). A renamed note is listed.
- **Dates** are read as the meeting import reads them: a UTC time's day is the
  one it falls on in `--time-zone`. A range writes its end where the type has
  a place for it (PARA's Start date into `end`), and is listed otherwise. A
  date that cannot be read is listed and left as the note has it: it is not
  taken for Notion having cleared it.
- **Properties paragraph.** A page's first `Label: value` lines are read as
  its properties only when every label is one of its database's columns;
  otherwise they stay in the body.
- **Not imported, and listed:** columns that link back to the page that
  holds the relation (People's Tasks, PARA's Tasks, Notes' Back Links: Atlas
  shows those as backlinks), columns the import does not map, subpages and
  other pages that are no database's row, databases it does not know,
  attachments, and a second column that maps to a property another column
  already fills (a text `Notes` column beside the `Note` relation).

### Task statuses

Tasks follow GTD (ADR-0029). The vault's Task type must already be GTD: run
the in-app GTD move first. Until then the import refuses to bring tasks in
(exit 2, "run the GTD move first"); leave them out with `--only` to bring in
the rest.

| Notion                    | Atlas `status`                                        |
| ------------------------- | ----------------------------------------------------- |
| Inbox                     | `inbox`                                               |
| Ready                     | `next-action`                                         |
| Next Action               | `next-action`                                         |
| Later                     | `someday`                                             |
| In progress               | `in-progress`                                         |
| Waiting                   | `waiting`, `waiting_on` the first person in People    |
| Waiting, nobody in People | `inbox`, listed                                       |
| Done                      | `archive`, with `completed` set to the day of the run |
| anything else             | `inbox`, listed                                       |

A Due date still to come also sets `scheduled`. `completed` and `scheduled`
are offered once: set only where the task has none, never changed after, and
never put back once you take one out in Atlas. Change the
mapping with `--task-status "Later=longterm"` (repeat it); the right side must
be one of the eight statuses.

## Edits made in Atlas are never written over

The import keeps a record of what it brought in, at
`.atlas/imports/notion-workspace.md` in the vault: for each Notion page, a
digest of each property's value and of its body. It syncs to every Mac with
the notes. On a later run, each property (and the body) is settled three
ways — the last import, the note now, Notion now:

| The note since the last import | Notion since the last import | What the run does                   |
| ------------------------------ | ---------------------------- | ----------------------------------- |
| unchanged                      | changed                      | writes Notion's value               |
| changed                        | unchanged                    | leaves yours                        |
| changed                        | changed to the same          | nothing to do                       |
| changed                        | changed to something else    | leaves yours and lists it as `kept` |

**A note you delete in Atlas stays deleted.** A page the record says was
imported whose note is gone from the vault (deleted, or moved into a hidden
folder) is listed as `deleted` and not made again; `--recreate-deleted`
brings such notes back.

A note with no record — one the earlier, one-off import made, or any note
after the record is removed — is filled in where it lacks a property, and
every value that differs is kept and listed. Each Notion value is recorded
once it has been offered, so a difference is listed on the run that finds
it, and a run with nothing new in Notion changes nothing at all, the record
included.

Only the keys the import writes are touched, through Atlas's byte-preserving
frontmatter writer: every other key, its comments, quoting and order, and
an untouched body keep their bytes.

**Why a record in the vault, not a key in each note.** A digest of a whole
note cannot live inside the note it describes, and a key per property would
show in every note's properties. The record follows the GTD move's own
(`.atlas/migrations/`): synced, readable, and safe to lose — without it, the
next run only fills in what notes lack.

**The record is kept as the notes are written.** The run checks it can write
the record before it writes anything, meetings included, and saves it every
25 notes and at the end. If it cannot be saved partway, no further note is
written and the report says which were (exit 1). A note written just before a
crash already says what the record would have, so the next run finds it in
step.

## Running it

1. **Export.** In Notion: **Settings → Export all workspace content →
   Markdown & CSV**, with **Include subpages** on (or export each database
   that way). Unzip it into a folder of its own, and any zip inside it. Set
   every Date property's format to **Full date** first (`October 6, 2026`).
2. **Run the GTD move** in Atlas, if you have not.
3. **Copy the vault** and run on the copy first, as a dry run, then for real:

   ```sh
   rsync -a --exclude .git ~/"Atlas Vault/pkm-space/" /tmp/atlas-vault-copy/
   pnpm import:notion-workspace --export ~/Downloads/<export folder> \
     --vault /tmp/atlas-vault-copy --dry-run --gemini-dates arrival-local
   pnpm import:notion-workspace --export ~/Downloads/<export folder> \
     --vault /tmp/atlas-vault-copy --gemini-dates arrival-local
   ```

   Use absolute paths: pnpm runs the script from the repository's folder. Do
   not open the copy in Atlas: it carries the vault's sync settings. Read the
   notes in it instead. Run it once more: it should report every page
   `unchanged`.

4. **Quit Atlas, then run it for real** on the vault, with the options you
   settled on. A note is replaced only while it still holds what the run read,
   but that check and the write are a moment apart: an edit Atlas saves in
   that moment could be lost. With Atlas closed, nothing else writes the
   notes. Open Atlas again when the report is in.

## The report

A `warning` line for each type the vault does not declare, then one line per
page that was created, updated, refused, deleted in Atlas or kept an edit, and a
`note` line for anything about a page worth saying (a Waiting task held in
the Inbox, a status it does not know, a related page not in the export, a
date it could not read). Then what was skipped, the meeting import's own
report, and the totals.

| Line      | Means                                                                                |
| --------- | ------------------------------------------------------------------------------------ |
| `created` | A new note, at this path                                                             |
| `updated` | The note took Notion's change to these properties (or `body`)                        |
| `kept`    | You changed these in Atlas, and Notion changed them too: yours were left             |
| `note`    | Something about the page: it was imported                                            |
| `deleted` | Imported before and deleted in Atlas: not made again (see `--recreate-deleted`)      |
| `refused` | Not imported: no page for the row, two notes with its `notion_id`, a note not UTF-8… |
| `stopped` | The record could not be saved partway: the notes listed as written were, no others   |
| `warning` | The vault does not declare a type the notes are written as                           |
| `skipped` | Not brought in, and why                                                              |

It exits 0 when everything came in, 1 when a page was refused, an edit was
kept over Notion's, the record stopped partway, or a meeting was held or
refused, and 2 when it could not run at all, having written nothing (no such
vault or export, a folder linked out of the vault, a page that is not UTF-8,
a record it cannot read or write, a Task type that is not GTD).

| Option                 | Default               | What it does                                                    |
| ---------------------- | --------------------- | --------------------------------------------------------------- |
| `--export <folder>`    | (required)            | The unzipped export                                             |
| `--vault <folder>`     | (required)            | The vault to write into. It must exist; there is no default     |
| `--dry-run`            | off                   | Plans and reports everything, writes nothing                    |
| `--recreate-deleted`   | off                   | Makes again the notes of imported pages deleted in Atlas        |
| `--only <list>`        | every database        | `tasks,notes,meetings,people,para,teams,daily`, comma-separated |
| `--task-status <a=b>`  | the table above       | A Notion status and the GTD status it becomes; repeat it        |
| `--gemini-dates <how>` | none: Gemini held     | Passed to the meeting import (issue #44)                        |
| `--time-zone <zone>`   | `America/Los_Angeles` | The clock UTC times are read on, for meetings and every date    |

## Safety

- No default vault: it is always named, must exist, and no folder the import
  writes into may be linked out of it.
- Every page of the export, the meetings' included, is read as UTF-8 before
  anything is written, or the run stops; a note in the vault that is not
  UTF-8 is never rewritten.
- The record is never written through a link out of the vault.
- Nothing is written until every page is planned. Each note is written whole
  under a hidden name, then given its name only if nothing has it (a new
  note), or put in place of the note in one step only while the note still
  holds what the plan was made from (an update).
- A page the vault holds twice by `notion_id` is refused: merge the notes,
  then run again.
- Quit Atlas before a real run (step 4).
