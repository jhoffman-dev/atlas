# Meetings into Atlas from n8n

Your n8n workflow already reads "Notes by Gemini" emails and writes each
meeting to the Notion Meeting Notes database. This folder adds a **second
destination** beside Notion: the same meeting, committed as one markdown file
to the vault's sync repository, `jhoffman-dev/pkm-space`, at
`Inbox/Meetings/<YYYY-MM-DD> <title>.md`. Atlas pulls that repository every
minute, so meetings arrive even while the Mac is asleep (ADR-0027). The
Notion path is not touched: the Atlas branch runs in parallel with it, reads
the meeting from your nodes by name, and nothing in it can stop the run.

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

## 3. Paste the nodes into a copy of your workflow

The nodes fit a workflow shaped like this:

- a **notes email** node: the Gmail trigger, or a step after it that keeps the
  email's subject and arrival time (a Gmail trigger names them `subject` and
  `date`). With a second, manual trigger for tests, use the first step both
  triggers feed, so the field is there whichever one ran;
- a **merged meeting** node, whose one item per meeting holds `title`,
  `attendees` (a list of `{ name, email }`), `summaryMd` (the notes, with
  `## Summary`, `## Decisions`, `## Next steps` and `## Details` headings),
  `transcriptMd`, `source` (`gemini`), `sourceId` (the email's id) and
  `category`. Any date it holds is when the notes arrived, and is not read;
- the Notion steps after it: a "was it synced already?" lookup, then the
  page create.

Work on an inactive copy, so the live workflow keeps running untouched until
the copy is proven:

1. In n8n, open your Gemini → Notion workflow, **⋯ → Duplicate**, and name the
   copy (say, `Meeting notes → Notion + Atlas (staging)`). It is created
   inactive; leave it so.
2. In the copy, open `meeting-to-atlas.workflow.json`, copy all of it, click
   the canvas and press **Cmd+V**. Twelve nodes appear, starting at
   **Meeting fields for Atlas**.
3. Drag a connection from **the merged meeting node's output** to **Meeting
   fields for Atlas**, beside the connection that already goes to the Notion
   lookup. Put the Atlas nodes **above** the Notion branch on the canvas: n8n
   (execution order v1) runs the branches of one output top to bottom, so
   Atlas runs first and a Notion failure later in the run cannot keep it from
   running. The Atlas branch cannot stop the Notion one: every failure in it
   leaves by an error output.
   - Or wire it from **your Notion create node's output** instead. Atlas then
     runs only for a meeting Notion has just created: one Notion skipped as
     already synced, or failed to write, is not tried.
4. Open each of the four GitHub nodes and check that the credential shows
   `GitHub pkm-space (contents)`; pick it from the list if n8n asks. Open
   **Email me: meeting not in Atlas**, pick your Gmail credential, and put
   your own address in **To** (it comes as `you@example.com`).

## 4. Point the fields at your nodes

Open **Meeting fields for Atlas**. Each row is one field the mapper reads; the
right-hand side reads one of your nodes by name, so it works wherever the
branch is wired. The rows name the nodes `Meeting with people` (the merged
meeting) and `Notes email` (the email): rename your nodes to those, or change
the name in each row (drag the field in from the input panel).

| Mapper field | Read from                          | Becomes in the file                   |
| ------------ | ---------------------------------- | ------------------------------------- |
| `title`      | merged meeting `title`             | `title`, and the file name            |
| `stated`     | notes email `subject`              | `date`, and `start` if it has a time  |
| `arrived`    | notes email `date` (when it came)  | `start` (approximate), see below      |
| `attendees`  | merged meeting `attendees` (Array) | `attendees` (groups marked)           |
| `sections`   | merged meeting `summaryMd`         | `## Summary`, `## Notes`, next steps  |
| `transcript` | merged meeting `transcriptMd`      | `## Transcript`, a paragraph per turn |
| `category`   | merged meeting `category`          | `kind`                                |
| `source`     | merged meeting `source`            | `provider`                            |
| `sourceId`   | merged meeting `sourceId`          | `external_id`                         |

`sections` is split by its headings: `## Summary` becomes the Summary;
`## Details` the Notes, with `## Decisions` under them as `### Decisions`;
`## Next steps` the Provider next steps (`- [Owner] Title: description`). Text
before the first of those headings is Summary, and any other heading stays in
the section it is in.

The mapper reads other fields too, for a workflow shaped differently: add a
row with that name. `summary`, `decisions`, `nextSteps` and `details` give the
four parts separately (one given on its own wins over its part of
`sections`); `date`, `start` and `end` give a meeting's real day and times
(Granola's Notion Date is its real start). Never give a Gemini meeting's
arrival as `date` or `start`: it would be taken as when the meeting began.

`title`, a day (`stated` or `date`), a start time, `source` and `sourceId`
are required. Without a start time (in `start`, `stated` or `date`, or worked
out from `arrived`), the mapper stops with "start: the meeting has no start
time" rather than inventing one.

**When a Gemini meeting began.** A Gemini meeting's notes arrive about when
it ended, so the day and start come from the email itself:

1. `stated` — the email's subject. The mapper reads the **last** date in it
   (`Oct 6, 2026`, `October 6 2026`, `2026/10/06`, `2026-10-06`; a date in
   the meeting's title comes before it) and a time right after it, if any
   (`10:00`, `2:30 PM`; a zone after the time is not read: it is taken as
   your local clock). Gemini's doc title,
   `Title - 2026/10/06 10:00 PDT - Notes by Gemini`, works too. When `stated`
   is given, `date` is not read at all. Words with no date in them are refused.
2. `arrived` — when the email arrived (an instant). When nothing gives a
   start time, the start is the arrival less the transcript's length —
   Gemini's "Transcription ended after 00:51:49" line, else its last
   `### hh:mm:ss` section stamp (a little short) — and the file says
   `start_approximate: true`. With no transcript, the start is the arrival
   itself, still marked approximate.

The order is: `start`, then the time in `stated`, then the time in `date`,
then (Granola) the first stamped turn, then `arrived` less the transcript.

`attendees` is an **Array** row: the mapper reads `{ name, email }` records.
It reads `Name — email` lines too; for those, make the row a **String**.

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
commit failed**, and the run goes on. Notion already has the meeting.
**Email me: meeting not in Atlas** then sends you the meeting's title and
Source ID, the error, and the execution number to open in n8n. If that email
cannot be sent either, nothing stops: the execution still shows the error.
To be told another way (Slack, say), swap that node for one that posts there,
reading the same expressions.

## 5. Dry run, then swap

**This dry run is the real test of the Code nodes.** The tests run the
mapper under Node; n8n's Code node sandbox is close but not the same. The
mapper uses `Buffer` (which n8n documents) to read GitHub's files, and falls
back to `atob`; it uses `Intl.Segmenter` and the time zone database where
present. A sandbox without them shows up here, not in the tests.

In the inactive copy:

1. Select **Commit meeting file** and **Commit meeting file (other path)** and
   press **D** to deactivate them. (A deactivated n8n node passes its input
   on rather than stopping the flow, so deactivate the two commits — they are
   last — not the lookups.) The lookups still run; they only read.
2. Deactivate every node that writes to Notion, so the test cannot touch it:
   the People create, the Meeting page create, and the transcript appends
   after it (and any Code node between them that reads an append's output).
3. Run the copy on one recent email: your manual test trigger, or pin a past
   execution's trigger data and press **Test workflow**.
4. Open **Map meeting to Atlas file**'s output. Check `path`, `commitMessage`
   and `content`: the date and start are right (fix `timeZone` if not; a
   start worked out from the arrival says `start_approximate: true`), the
   attendees are split, the transcript has one
   `**Speaker** [~00:09:44] … ^t0001` paragraph per turn. Check **Atlas commit
   failed** received nothing.
5. Optional, on the Mac: copy `content` into a file and run
   `pnpm validate:meeting that-file.md` in the Atlas repo. `ok` means Atlas
   will accept it.
6. Reactivate both commit nodes (leave the Notion writes off), run once more,
   and look in `pkm-space` on GitHub for `Inbox/Meetings/<date> <title>.md`
   and a commit `Meeting: <title> (gemini)`. Within a minute of the Mac
   being awake, it is in Atlas's Inbox.
7. Reactivate the Notion writes. Then, in one sitting, **activate the copy and
   deactivate the original**, so each email is handled by exactly one of
   them. Both poll on the same schedule, so an email that arrives while both
   are active can reach Notion twice (both runs pass the "already synced"
   lookup together); Atlas writes it once either way. To go back, do the
   reverse: activate the original, deactivate the copy.

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
  file into `Inbox/Meetings/`.
- Atlas checks it against the contract. A valid meeting shows in the
  **Inbox**, byte for byte as committed.
- A file that breaks the contract is never deleted or silently fixed: it gets
  `atlas_import_error:` naming the problem and is listed in the Inbox.
- A second copy of a meeting already in the vault is marked
  `atlas_duplicate_of: [[…]]` and archived; un-archiving restores it.
- Each outcome is one entry in Activity.

## Changing the mapper

Edit `tools/n8n/meeting-*.ts`, run `pnpm n8n:build`, then in n8n replace the
three Code nodes' code (**Map meeting to Atlas file**, **Same meeting?**,
**Same meeting at the other path?**) with the new `jsCode` from the JSON — or
delete the twelve nodes and paste the file again. A test fails while the JSON
is out of date with the mapper.

The node names the fields are read from are `EXAMPLE_SOURCES` in
`workflow.ts`; `meetingWorkflow(scripts, sources)` builds the same nodes for
other names. The notification's address is `NOTIFY_TO`, a placeholder.
