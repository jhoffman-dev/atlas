# Meetings into Atlas from n8n

Your n8n workflow already reads "Notes by Gemini" emails and writes each
meeting to the Notion Meeting Notes database. This folder adds a **second
destination** beside Notion: the same meeting, committed as one markdown file
to the vault's sync repository, `jhoffman-dev/pkm-space`, at
`Inbox/Meetings/<YYYY-MM-DD> <title>.md`. Atlas pulls that repository every
minute, so meetings arrive even while the Mac is asleep (ADR-0027). The
Notion path is not touched: the Atlas branch runs only after the Notion node
has written the meeting, and nothing in it can stop the run.

| File                                                | What it is                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `meeting-to-atlas.workflow.json`                    | The n8n nodes to paste in. No secrets: the credential is referenced by name.   |
| `meeting-*.ts`                                      | The mapper, which the workflow's Code nodes run (compiled into the JSON).      |
| `validate-meeting.mjs`                              | Checks a file with the validator Atlas runs: `pnpm validate:meeting <file.md>` |
| `build-workflow.mjs`, `code-node.ts`, `workflow.ts` | Rebuild the JSON after changing the mapper: `pnpm n8n:build`.                  |

The file format is the meeting import contract,
`vault/docs/contracts/meeting-import-v1.md`.

**Where these live.** The issue (P28-02, #8) planned the setup doc and the
workflow JSON in `vault/docs/contracts/` and the CLI at
`tools/validate-meeting.mjs`. They were built together here, in `tools/n8n/`,
because the JSON is generated from the mapper's TypeScript and a test holds
the two in step; the contract itself stays in `vault/docs/contracts/`.

## 1. Make a GitHub token that can only write to pkm-space

On github.com: **Settings → Developer settings → Personal access tokens →
Fine-grained tokens → Generate new token**.

- **Token name**: `n8n meetings → pkm-space`.
- **Expiration**: a year (put a reminder in your calendar to renew it).
- **Resource owner**: `jhoffman-dev`.
- **Repository access**: **Only select repositories** → `pkm-space`. Nothing else.
- **Repository permissions**: **Contents → Read and write**. That is the only
  one to set; GitHub adds **Metadata → Read-only** by itself. Leave every other
  permission at "No access".

That is everything the workflow needs: reading a file (to see whether the
meeting is already there) and creating a file are both "Contents".

The token lives **only in n8n's credential store**. Never paste it into the
workflow, a Code node, the vault or this repository.

## 2. Add the credential in n8n

On your work computer's n8n: **Credentials → Add credential → GitHub API**.

- **Name**: `GitHub pkm-space (contents)` — exactly this, so the imported
  nodes find it by name.
- **User**: `jhoffman-dev`. **Access Token**: the token from step 1.
- **GitHub server**: leave `https://api.github.com`.

## 3. Paste the nodes into your workflow

1. Open your existing Gemini → Notion workflow.
2. Open `meeting-to-atlas.workflow.json`, copy all of it, click the canvas
   and press **Cmd+V**. Eleven nodes appear, starting at **Meeting fields for
   Atlas**.
3. Drag a connection from **your Notion node's output** (the one that creates
   the Meeting Notes page) to **Meeting fields for Atlas**. Atlas now runs
   only after Notion has the meeting; if the Notion write fails, the run
   stops there as it always has, and Atlas is not tried.
4. Rename **your parse step** (the node whose output feeds the Notion node)
   to `Parse meeting email`. After the Notion node, `$json` is Notion's page,
   so **Meeting fields for Atlas** reads the parse step by that name:
   `$('Parse meeting email').item.json["Meeting name"]`. (Or keep your name
   and change it in each of that node's expressions.)
5. Open each of the four GitHub nodes and check that the credential shows
   `GitHub pkm-space (contents)`; pick it from the list if n8n asks.

## 4. Map your parse step's fields

Open **Meeting fields for Atlas**. Each row is one field the mapper reads; the
right-hand side is an expression reading your parse step's output by name. The rows
assume your parse step names its fields like your Notion properties; change
the expression wherever yours differs (drag the field in from the input panel).

| Mapper field | What to give it                                                | Becomes in the file                   |
| ------------ | -------------------------------------------------------------- | ------------------------------------- |
| `title`      | Meeting name                                                   | `title`, and the file name            |
| `date`       | The meeting's date: `2026-10-06`, or a date-time (see below)   | `date` (and `start` if it has a time) |
| `start`      | Start time (`10:00`, `2:30 PM`) — leave empty if `date` has it | `start`                               |
| `end`        | End time, if you have it                                       | `end`                                 |
| `stated`     | Gemini: the email's **Subject** (`Notes: “Title” Oct 6, 2026`) | `date`, and `start` if it has a time  |
| `arrived`    | Gemini: when the email **Received** arrived (an instant)       | `start` (approximate), see below      |
| `attendees`  | The Attendees text: `Name — email` lines                       | `attendees` (groups marked)           |
| `summary`    | Summary                                                        | `## Summary`                          |
| `decisions`  | Decisions, if Gemini gave any                                  | `### Decisions` under `## Notes`      |
| `nextSteps`  | Next steps: `- [Owner] Title: description` lines               | `## Provider next steps`              |
| `details`    | Details                                                        | `## Notes`                            |
| `transcript` | The transcript text, as it came                                | `## Transcript`, a paragraph per turn |
| `category`   | Category                                                       | `kind`                                |
| `source`     | Source: `gemini` (or `granola`)                                | `provider`                            |
| `sourceId`   | Source ID                                                      | `external_id`                         |

`title`, a day (`date` or `stated`), a start time, `source` and `sourceId`
are required. Without a start time (in `start`, `stated` or `date`, or worked
out from `arrived`), the mapper stops with "start: the meeting has no start
time" rather than inventing one — see step 5.

**When a Gemini meeting began.** The Notion "Date" of a Gemini meeting is
when its notes _arrived_ (about when the meeting ended), not when it began, so
for Gemini the day and start come from the email itself:

1. `stated` — the email's subject. The mapper reads the **last** date in it
   (`Oct 6, 2026`, `October 6 2026`, `2026/10/06`, `2026-10-06`; a date in
   the meeting's title comes before it) and a time right after it, if any
   (`10:00`, `2:30 PM`; a zone after the time is not read: it is taken as
   your local clock). Gemini's doc title,
   `Title - 2026/10/06 10:00 PDT - Notes by Gemini`, works too. When `stated`
   is given, `date` is not read at all. Words with no date in them are refused.
2. `arrived` — when the email arrived (your trigger's received time, an
   instant). When nothing gives a start time, the start is the arrival less
   the transcript's length — Gemini's "Transcription ended after 00:51:49"
   line, else its last `### hh:mm:ss` section stamp (a little short) — and
   the file says `start_approximate: true`. With no transcript, the start is
   the arrival itself, still marked approximate.

The order is: `start`, then the time in `stated`, then the time in `date`,
then (Granola) the first stamped turn, then `arrived` less the transcript.
Rename `Subject` and `Received` in those two rows to your parse step's
names. For Granola, leave both empty: its Notion Date is the real start.

The `attendees`, `nextSteps` and `transcript` rows accept text or a list of
lines. If your parse step gives attendees or next steps as records
(`{ name, email }`, `{ owner, title, description, confidence }`), change that
row's type to **Array** and drop the `.join` from its expression: the mapper
reads records too.

**Dates and instants.** Open **Map meeting to Atlas file**; at the bottom is
`const OPTIONS = { timeZone: 'America/Los_Angeles', groupAddresses: [] };`.
The mapper reads two kinds of value differently:

- **A date or a time with no offset** — `2026-10-06`, `10:00`, `2:30 PM`,
  `2026-10-06T10:00` — is a local day or clock time, kept exactly as written.
  `timeZone` plays no part.
- **An instant** — a date-time ending in `Z` or an offset (`-07:00`) — is a
  moment, and is shown on the clock of `timeZone`. The Notion Meeting Notes
  rows are instants: a Granola meeting at 17:02 PDT is stored as `00:02Z`
  the next day, and is written `date: 2026-10-06`, `start: 17:02`.

Change `timeZone` if you move. Set it to `null` only if no value you send is
an instant: with `null`, an instant is refused (it would otherwise land on
the wrong day) rather than guessed at.

**Group addresses.** An attendee is written `group: true` (and never becomes
a Person) when the record says `group: true`, when its address is in
`groupAddresses`, or when its address's local part is a group word — team,
group, all, everyone, list, staff, crew, squad, dept — alone or joined by
`-` or `_` (`staff@…`, `platform-team@…`, `all_hands@…`). A display name is
never read (`Staff Sergeant Rivera` is a person), nor is a dotted
`first.last@` address (`dana.list@…`). Add any other list address to
`groupAddresses`, e.g. `['leads@example.com']`.

**Who spoke.** Gemini writes one `Speaker Name: words` line per turn, and its
speakers are often not on the attendee list (a shared room, a group invite),
so in a Gemini transcript **every** `Label: words` line is a turn by that
speaker — except a note label, which continues the turn before: `Note`,
`Notes`, `NB`, `PS`, `FYI`, `Re`, `TODO`/`To do`, `Action item(s)`,
`Next step(s)`, `Decision(s)`, `Question(s)`, `Answer(s)`, `Agenda`,
`Summary`, `Update`, `Reminder`, `Link`, `URL`, `Email`, `Phone`, `Subject`,
`Date`, `Time` (any case). A wrapped line whose words open with another
`Something:` (`Phase two: the rollout`) is read as a speaker; that is the
price of never losing a real one.

In a Granola transcript (every turn stamped `**[14:14:22] Name:**`), an
unstamped `Label: words` line starts a turn only when the label is an
attendee's name, a speaker already heard, `You`/`Remote Speaker`/`Speaker 2`,
the first line of a section, has no words after it, or the meeting has no
attendees to check against; otherwise it continues the turn before.

**When Atlas cannot take a meeting.** Every failure in the Atlas branch — a
meeting the mapper refuses (no start time, say), an existing file it cannot
read, both of a meeting's paths taken by other meetings, a commit GitHub
rejects (an expired token) — leaves by that node's error output to **Atlas
commit failed**, and the run goes on. Notion already has the meeting. The
node does nothing by itself: hang a notification off it (email, Slack) to be
told, and its input shows the meeting and the error.

## 5. Dry run before anything is committed

**This dry run is the real test of the Code nodes.** The tests run the
mapper under Node; n8n's Code node sandbox is close but not the same. The
mapper uses `Buffer` (which n8n documents) to read GitHub's files, and falls
back to `atob`; it uses `Intl.Segmenter` and the time zone database where
present. A sandbox without them shows up here, not in the tests.

1. Select **Commit meeting file** and **Commit meeting file (other path)** and
   press **D** to deactivate them. (A deactivated n8n node passes its input
   on rather than stopping the flow, so deactivate the two commits — they are
   last — not the lookups.) The lookups still run; they only read.
2. Run the workflow on one real email (or pin a past execution's data on your
   trigger and press **Test workflow**).
3. Open **Map meeting to Atlas file**'s output. Check `path`, `commitMessage`
   and `content`: the date and start are right (fix `timeZone` if not), the
   attendees are split, the transcript has one `**Speaker** [~00:09:44] … ^t0001`
   paragraph per turn. Check **Atlas commit failed** received nothing.
4. Optional, on the Mac: copy `content` into a file and run
   `pnpm validate:meeting that-file.md` in the Atlas repo. `ok` means Atlas
   will accept it.
5. Reactivate both commit nodes, run once more, and look in
   `pkm-space` on GitHub for `Inbox/Meetings/<date> <title>.md` and a commit
   `Meeting: <title> (gemini)`.

## How the workflow avoids writing a meeting twice

The path is deterministic: the same meeting always maps to the same
`Inbox/Meetings/<date> <title>.md`.

1. **Is the path taken?** (GitHub → File → Get) looks the path up.
   - Not found → its error output goes to **Commit meeting file**, which
     creates it.
2. Found → **Same meeting?** decodes the file and compares its `provider` and
   `external_id` with this meeting's (ADR-0027's duplicate rule).
   - Same → **Skip: already in the vault**. Re-running the flow, or the same
     email arriving twice, writes nothing.
   - Different (two meetings with one title on one day, like two `1:1`s) →
     **Is the other path taken?** looks up
     `Inbox/Meetings/<date> <title> (<provider> <hash>).md`, where the hash
     is 8 hex digits of the provider and Source ID (an id may hold characters
     a file name cannot, or be too long; the name stays within 255 bytes and
     keeps the date). Not found → **Commit meeting file (other path)** creates
     it. Found → **Same meeting at the other path?** checks it the same way:
     this meeting → skip; another → **Atlas commit failed** (it never writes
     a third name).
   - GitHub sends no content for a file over 1 MB, so it cannot be told apart
     → **Atlas commit failed**, rather than a guess that would write the
     meeting twice.

Commits go to `pkm-space`'s default branch. A commit that fails (an expired
token, no permission) goes to **Atlas commit failed**; it is never taken for
"already there".

**Case.** GitHub paths are case-sensitive; the Mac's disk is not. Two
meetings whose titles differ only in case on one day (`Weekly Sync`,
`weekly sync`) are two paths to GitHub but one file name on the Mac, and the
pull would clash. The lookup cannot compare without case (it fetches one
exact path), so this stays a known gap: keep a recurring meeting's title
stable.

One case n8n cannot see: once Atlas has moved or renamed the file (after
P28-04), a re-run would write the meeting to `Inbox/Meetings` again. Atlas
catches that: a second file with the same `provider` + `external_id` is marked
`atlas_duplicate_of` and archived (reversibly).

## What Atlas does when the file arrives (after P28-04)

- The vault's next pull (within a minute of the Mac being awake) brings the
  file into `Inbox/Meetings/`. The Mac that runs the vault's automations
  imports it; another Mac leaves it for that one. Anything left — Atlas
  closed, the other Mac asleep — is settled when the importing Mac next
  opens the vault.
- Atlas checks it against the contract and writes one line into it,
  `atlas_import_outcome:`, right after the `atlas_import: meeting/v1` line
  the mapping writes, saying how it settled it. Nothing else in the file
  changes.
- `imported`: a valid meeting, shown in the **Inbox**.
- `error`: a file that breaks the contract, never deleted or silently fixed.
  It also gets `atlas_import_error:` naming the problem, and is listed in
  the Inbox.
- `duplicate`: a second copy of a meeting already in the vault, archived and
  marked there `atlas_duplicate_of: [[<the original's path>]]`;
  un-archiving restores it. A
  meeting already imported is always the one kept. Otherwise the one at
  `<date> <title>.md` is kept over the one at
  `<date> <title> (<provider> <hash>).md`.
- Each outcome is one entry in Activity.
- **Fixing a file that failed.** Fix it in place and save: Atlas checks it
  again, takes the error out and stamps it `imported`. To send it again from
  n8n instead (after fixing the mapping), delete the broken file first.
  **Same meeting?** skips a path that already holds this provider and Source
  ID, broken or not, so a re-send over it writes nothing.

## Bringing in the meetings already in Notion (once)

The workflow only sends meetings from now on. The ones already in the Notion
Meeting Notes database come in once, through the same mapper, with
`tools/import-notion-meetings.mjs` (P28-07). It reads a Notion export, maps
each row as the workflow would, checks each file with the validator Atlas
runs, and writes it into a vault. It never writes into your vault unless you
give it that vault's path.

1. **Export.** In Notion, open the Meeting Notes database, then **••• →
   Export → Markdown & CSV**, with **Include subpages** on (the pages hold
   the notes and transcripts). Unzip it into a folder of its own, and any
   zip inside it. Notion
   writes two CSVs, `Meeting Notes <id>.csv` and `Meeting Notes <id>_all.csv`:
   use the `_all` one, which has every column. The pages are the `.md`
   files in the folder beside it. Before exporting, set the Date property's
   format to **Full date** (`October 6, 2026`): `10/06/2026` could be either
   day, so a row written that way is refused, never guessed at.
2. **Run it on a copy of the vault first.**

   ```sh
   cp -R ~/"Atlas Vault" /tmp/atlas-vault-copy
   pnpm import:notion-meetings --csv ~/Downloads/<export>/"Meeting Notes <id>_all.csv" \
     --vault /tmp/atlas-vault-copy
   ```

   Use absolute paths: pnpm runs the script from the repository's folder.
   Do not open the copy in Atlas: it carries the vault's sync settings and
   would sync into `pkm-space`. Read the files in it instead, and
   `pnpm validate:meeting /tmp/atlas-vault-copy/Inbox/Meetings/*.md` if you
   like (the import has already checked each one).

3. **Read the report.** One line per row, then the totals:

   | Line       | Means                                                                                                 |
   | ---------- | ----------------------------------------------------------------------------------------------------- |
   | `wrote`    | The meeting's file, at the path the workflow would use (two `1:1`s on one day: the second's names it) |
   | `in vault` | The vault already holds the meeting, by Atlas's own rule, wherever it is filed; nothing written       |
   | `no id`    | A row with no Source ID: listed, never given one, so not imported                                     |
   | `left out` | A provider you did not name in `--providers`                                                          |
   | `held`     | A Gemini row, waiting for `--gemini-dates` (step 4)                                                   |
   | `refused`  | Why not: no start time, no page for the row, two pages with one Source ID, a file Atlas would refuse  |

   It exits 0 when every row with a Source ID you asked for is in the vault,
   1 when one was held or refused, 2 when it could not run (no such vault, a
   hidden folder, not the Meeting Notes CSV, a file that is not UTF-8). Fix a
   refused row in Notion, export again and run again: the rows already
   brought in are `in vault`, and only the rest are written.

4. **Gemini's rows, and the times.** The Date cell is read the way Notion
   wrote it. A time with no zone, or with a zone other than UTC, is kept as
   written; a UTC time (`(UTC)`, or a date-time ending in `Z`) is an
   instant, shown on the clock of `--time-zone` (default
   `America/Los_Angeles`, as the workflow's). That is right for Granola.

   It is not right for Gemini (issue #44): the Date the workflow wrote for a
   Gemini meeting is when its notes **arrived**, near the meeting's end, and
   it is local time with a `Z` on it. Read as an instant, a Gemini meeting
   would land about your UTC offset early (7 or 8 hours), give or take the
   meeting's length, and some on the day before. So Gemini's rows are
   `held` until you choose how to read them:

   ```sh
   pnpm import:notion-meetings --csv … --vault /tmp/atlas-vault-copy --gemini-dates arrival-local
   ```

   `arrival-local` reads the written time as your local clock time (the
   `Z` ignored) and starts the meeting the transcript's length before it:
   the transcript's last time stamp, so a little after the real start. With
   no stamps in the transcript, the start is when the notes arrived. Each
   such meeting's Notes open with a line saying its start is approximate.
   `--providers granola` brings in Granola's alone, if you would rather wait
   for the fix in the workflow.

   Then compare a few meetings' `date` and `start` with your calendar, from
   each provider. A Gemini meeting should start a few minutes after it
   really did. If they are all about your UTC offset early or late instead,
   the export showed Notion's time on another clock than the one the
   workflow wrote: stop there, and do not run it for real.

5. **Run it for real**, naming the vault, with the options you settled on:

   ```sh
   pnpm import:notion-meetings --csv ~/Downloads/<export>/"Meeting Notes <id>_all.csv" \
     --vault ~/"Atlas Vault" --gemini-dates arrival-local
   ```

   The files land in `Inbox/Meetings/`, and Atlas takes each in as it does a
   meeting from n8n (below): checked, stamped, listed in the Inbox. Running it
   again writes nothing new. Each file is written whole under a hidden name
   and then given its name, so a run that stops partway leaves no part of a
   meeting behind.

| Option                    | Default               | What it does                                                                                 |
| ------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `--csv <file>`            | (required)            | The export's `_all.csv`; its pages are the `.md` files in its folder and below               |
| `--vault <folder>`        | (required)            | The vault to write into. It must exist                                                       |
| `--folder <path>`         | `Inbox/Meetings`      | Where in the vault the files go. Not hidden, and not linked out of the vault                 |
| `--time-zone <zone>`      | `America/Los_Angeles` | The clock UTC times are read on; `none` refuses a UTC time rather than read it as local time |
| `--group-address <email>` | none                  | An address to mark as a group (repeat it), as the workflow's `groupAddresses`                |
| `--providers <list>`      | every provider        | Only these providers' rows, comma-separated: `--providers granola`                           |
| `--gemini-dates <how>`    | none: Gemini held     | `arrival-local`: Gemini's Date is when its notes arrived, in local time (issue #44)          |

**Which folder.** In `Inbox/Meetings/`, Atlas imports each file on arrival,
and the Inbox lists every one until you file it: a whole history at once.
With `--folder Meetings/From Notion` (any folder outside `Inbox/Meetings/`)
they are filed from the start: the importer has already checked them, Atlas
does not stamp or list them, and if n8n later sends one of them again, that
copy is archived as a duplicate of the filed one.

**Already in the vault** means what it means to Atlas's import (P28-04): a
note stamped `imported` that names the meeting, or an unstamped one that
follows the contract as it. A copy stamped `duplicate` or `error`, or a sync
conflict's copy, does not count, and the meeting is written beside it.

**Not imported:** a row's Attendees relation (the page's Attendees section is
read instead), and its other properties. A page's sections the workflow did
not write, such as a summary you added by hand, go into Notes under their own
heading, so nothing in the page is dropped.

## Changing the mapper

Edit `tools/n8n/meeting-*.ts`, run `pnpm n8n:build`, then in n8n replace the
three Code nodes' code (**Map meeting to Atlas file**, **Same meeting?**,
**Same meeting at the other path?**) with the new `jsCode` from the JSON — or
delete the eleven nodes and paste the file again. A test fails while the JSON is out of date with the mapper.
