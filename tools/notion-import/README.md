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

| Notion database                      | Atlas type                | Folder            | Properties                                                                                                             |
| ------------------------------------ | ------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tasks (`Tasks`, `Tasks Tracker`)     | `task`                    | `Tasks/`          | `status` (GTD, below), `notion_status`, `priority`, `effort`, `task_type`, `tags`, `due`, `project`, `people`, `notes` |
| Notes                                | `notes`                   | `Notes/`          | `tags`, `date`, `project`, `people`, `tasks`, `related`                                                                |
| Meeting Notes                        | `meeting` (meeting/v1)    | `Inbox/Meetings/` | as the meeting import writes them                                                                                      |
| People                               | `person`                  | `People/`         | `email`, `slack`, `role`, `team`                                                                                       |
| PARA, Type Project                   | `project`                 | `Projects/`       | `priority`, `start`, `end`                                                                                             |
| PARA, Type Area                      | `area`                    | `Areas/`          | `priority`, `start`, `end`                                                                                             |
| PARA, Type Resource                  | `resource`                | `Resources/`      | `priority`, `start`, `end`                                                                                             |
| PARA, Type Archive                   | `project`, `status: done` | `Archive/`        | `priority`, `start`, `end`                                                                                             |
| Teams                                | `team`                    | `Teams/`          |                                                                                                                        |
| Daily Notes (`Daily Notes`, `Daily`) | `daily`                   | `Daily/`          | `date`, `tags`                                                                                                         |

Every note also gets `source: notion` and `notion_id`, and its page's content
as its body. A database is known by its name, without emoji or case. A note
already in the vault stays where it is, under its own name: the import finds
it by `notion_id` wherever you moved, renamed or archived it.

- **Relations become links** to the names Atlas gives their notes: `project:
"[[Larkspur Payroll renewal]]"`, `people: ["[[Mara Quill]]"]`. Every page's
  path is planned before anything is written, so a link names the note it
  will open, including one already in the vault under another name. Where a
  name alone would open another note, the link carries the path. A related
  page that is not in the export is linked by its title, and listed.
- **Links in a page's text** to another page of the export become wiki links
  too. Images, attachments and any other links are left as written.
- **Names.** A new note is named after its page's title, without what no
  file name or no link can hold (`/`, `:`, `#`, `|`, `[`, `]`…), and numbered
  when a note of that name is already in the folder.
- **Not imported, and listed:** columns that link back to the page that
  holds the relation (People's Tasks, PARA's Tasks, Notes' Back Links: Atlas
  shows those as backlinks), columns the import does not map, subpages and
  other pages that are no database's row, databases it does not know, and
  attachments.

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
are set only where the task has none, and never changed after. Change the
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

4. **Run it for real** on the vault, with the options you settled on.

## The report

One line per page that was created, updated, refused or kept an edit, and a
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
| `refused` | Not imported: no page for the row, two notes with its `notion_id`, a note not UTF-8… |
| `skipped` | Not brought in, and why                                                              |

It exits 0 when everything came in, 1 when a page was refused, an edit was
kept over Notion's, or a meeting was held or refused, and 2 when it could not
run at all (no such vault or export, a folder linked out of the vault, a
file that is not UTF-8, a record it cannot read, a Task type that is not
GTD).

| Option                 | Default               | What it does                                                    |
| ---------------------- | --------------------- | --------------------------------------------------------------- |
| `--export <folder>`    | (required)            | The unzipped export                                             |
| `--vault <folder>`     | (required)            | The vault to write into. It must exist; there is no default     |
| `--dry-run`            | off                   | Plans and reports everything, writes nothing                    |
| `--only <list>`        | every database        | `tasks,notes,meetings,people,para,teams,daily`, comma-separated |
| `--task-status <a=b>`  | the table above       | A Notion status and the GTD status it becomes; repeat it        |
| `--gemini-dates <how>` | none: Gemini held     | Passed to the meeting import (issue #44)                        |
| `--time-zone <zone>`   | `America/Los_Angeles` | Passed to the meeting import                                    |

## Safety

- No default vault: it is always named, must exist, and no folder the import
  writes into may be linked out of it.
- Every file of the export is read as UTF-8 or the run stops; a note in the
  vault that is not UTF-8 is never rewritten.
- Nothing is written until every page is planned. Each note is written whole
  under a hidden name, then given its name only if nothing has it (a new
  note), or put in place of the note in one step only while the note still
  holds what the plan was made from (an update).
- A page the vault holds twice by `notion_id` is refused: merge the notes,
  then run again.
