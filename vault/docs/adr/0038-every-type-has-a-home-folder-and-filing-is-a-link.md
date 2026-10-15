---
type: adr
id: ADR-0038
title: Every type has a home folder, meetings arrive by month, and filing is a link
status: proposed
date: 2026-10-14
---

# ADR-0038 — Every type has a home folder, meetings arrive by month, and filing is a link

## Context

The maintainer, on a vault six months old (#214): "I see a massive dump of
files with no structure. A year from now this could end up with a single
folder having 20,000 files." Measured then: 126 notes loose at the root, and
every meeting — 642, about 1,300 a year — flat in `Inbox/Meetings`. The
causes were all in the code:

- `newNoteFolder` put a new note beside whatever was open, or at the root.
- `dailyNotePath` put today's note at the root.
- The meeting mapping wrote every meeting to one folder, `Inbox/Meetings`.
- Processing an Inbox note moved it into its project's folder, which grows
  without bound too — and is a second place PARA is kept (#213 makes PARA a
  property).

A folder of thousands is slow to list, slow to sync, and costly to an AI
tool that lists it.

## Decision

1. **Every type has a home folder.** A type file may say `folder:`, which
   may hold `{YYYY}` and `{MM}`, filled from the note's own day: its `date`,
   else a date its file name starts with, else today. Built in, unless the
   type file says otherwise:

   | Type                                               | Folder                 |
   | -------------------------------------------------- | ---------------------- |
   | task                                               | `Tasks/{YYYY}/{MM}`    |
   | meeting                                            | `Meetings/{YYYY}/{MM}` |
   | daily                                              | `Daily/{YYYY}`         |
   | person                                             | `People`               |
   | company                                            | `Companies`            |
   | project (area and resource too, until #213)        | `Projects`             |
   | notes, and a plain note when it is tidied or filed | `Notes/{YYYY}`         |
   | proposal                                           | `Inbox/Proposals`      |

   A new note of a type with a home goes there whatever is open: the app's
   New, a view's "+ New", quick add, "New <type>", today's note, a promoted
   checklist line, a task accepted from a proposal, and `POST /v1/notes` with
   no `folder`. A folder chosen on purpose — "New note here", capture to the
   Inbox, an API `folder` — still wins. A plain note made by hand keeps the
   old rule (beside what is open). A `folder:` that is blank says the type
   has no home; one that cannot be used (a token other than the two, a path
   out of the vault, `.atlas`, a hidden folder, the Archive, too deep) is
   passed over, never refused: no field becomes required, and nothing the
   person does is blocked.

2. **Meetings arrive in their month.** The mapping (n8n's, Granola's, and
   `POST /v1/meetings`) writes `Meetings/<YYYY>/<MM>/<date> <title>.md`, and
   the second copy's name `… (<provider> <hash>).md` beside it. Dedupe is by
   provider + `external_id`, read from the files, and does not depend on the
   folder. **Whether a file is the import's is what it says, not where it
   is:** in a month folder under `Meetings`, a file is the import's when it
   declares `atlas_import` or carries the import's stamp. A meeting made by
   hand there declares nothing and is a note like any other — in play to
   rules from the moment it is made. The older `Inbox/Meetings` is still a
   place meeting files land (n8n keeps writing there until its workflow is
   re-imported), and every file in it is still the import's.

3. **The Inbox lists unfinished meetings by state.** A meeting waits in the
   Inbox while it declares `atlas_import`, the import stamped it or it is
   arriving in its month, it is not in the Archive, and it has no `project`
   — wherever it lives, the way a task waits by its status. One filed from
   the start (unstamped, outside where meeting files land, as the Notion
   meeting import's `--folder` writes) never waited and still does not.

4. **Filing is a link.** Processing a note under a project writes
   `project: [[…]]`. A meeting in its month stays where it is. A note in the
   `Inbox` folder leaves it for its type's home for its day — a plain note,
   or one whose type has no home, for `Notes/<year>` — never for the
   project's folder, so a project's folder no longer matters to filing.

5. **A one-time tidy, offered.** The Inbox page offers to move notes loose
   at the root to their homes, and meetings the import let in from
   `Inbox/Meetings` to their months. The preview lists every move and every
   note left where it is, with why. Nothing moves until Move is pressed. It
   goes through the Archive's batch move, which rewrites every link the moves
   leave behind, relations included. A name already taken at the destination,
   or two notes landing on one path, is a refusal, never a rename. A file the
   import has not let in stays, since moving it into a month would hand it to
   the import. Running it again moves nothing. Activity gets a line, and a
   warning per note left.

6. **The AI never lists a big folder whole.** Every list of notes the API
   answers — and so every chat and MCP tool — is paged and capped at 500, and
   the note lists say how many match in all (`total`) and hand out a cursor.
   Backlinks, which had no cap, are paged like the rest.

## Consequences

- Folders stay small: a year of meetings is twelve folders of about a
  hundred. The root holds only what the person put there.
- A task made from a meeting is linked by path when the proposal note that
  named it is still the shallower namesake (`[[Tasks/2026/10/Send the
file]]`): links stay right, if longer. Resolving links past proposals and
  the Archive would shorten them; that is a follow-up.
- Two notes may now share a name in different folders (a new
  `Companies/Acme.md` beside an older root `Acme.md`). Links are written by
  path where the name alone would open the other, as they always were.
- The n8n workflow has to be re-imported to write by month; until then it
  writes to `Inbox/Meetings`, which still works.
- The tidy's "Not now" lasts until the vault is opened again; a vault with a
  note left at the root is offered the tidy again on the next open.
- What moved is visible in git: a tidy is one commit of renames for sync.

## Alternatives considered

- **Keep `Inbox/Meetings` and move a meeting to its month when it is
  processed.** Still one folder of every unprocessed meeting — the folder
  the complaint was about, since most meetings are never filed.
- **Arrival by folder, with `Meetings/` as the landing folder.** A meeting
  made by hand there would be judged by the import and stamped as failing
  the contract: a blocking validation on the person's own notes.
- **Move filed notes into the project's folder (the old rule).** Grows
  without bound, and duplicates PARA, which #213 keeps as a property.
- **Rename on a collision.** Silent renames break the person's own idea of
  where a note is; a refusal with the reason is one they can act on.
