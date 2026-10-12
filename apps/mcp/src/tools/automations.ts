/**
 * Automations, read-only: `/v1/automations/...`. Running, undoing, and making
 * or editing a rule stay in the app — rules and logs live in `.atlas`, which
 * the API never writes, and a run changes many notes at once (ADR-0016).
 */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { limit, noInput } from './inputs.ts';

const READ_ONLY = { readOnlyHint: true } as const;

const id = z
  .string()
  .min(1)
  .describe('The automation\'s "id", exactly as atlas_automations listed it.');

const IN_THE_APP =
  'Running a rule, undoing its last run, and making, editing or turning one on or off — the ' +
  '"After a meeting" switch among them — are done in Atlas, on the Automations page, not ' +
  'through these tools.';

export const automations = defineTool({
  name: 'atlas_automations',
  title: 'List automations',
  description:
    'Every automation in the vault — a rule that archives notes, sets properties on them, asks ' +
    'Claude about them, or runs several steps on each, on a schedule or when a note of a type is ' +
    'created or changed — as the ' +
    'Automations page lists it: { automations: [{ id, name, path, enabled, when, note, which, ' +
    'olderThanDays, do, set, claude, steps, schedule, action, lastRun, nextRun, paused }], broken: [{ ' +
    'path, name, problem }] }. "when" ' +
    'is as the rule\'s file writes it ("daily at 03:00", "a meeting is created or changed"); ' +
    '"note" is { type, on: ["created" and/or "changed"] } for a rule a note sets off, which runs ' +
    'once per version of each note of that type its query matches, or null. "which" is the ' +
    'Atlas query naming its notes; "do" is "archive", "set", "claude" or "steps", with "set" the values ' +
    'it writes, and "claude" { prompt, tools, output, folder }: the prompt note, the read tools ' +
    'Claude may call, and what it writes — "proposals", "meeting-items" (a meeting\'s action ' +
    'items, decisions and follow-ups, each citing a transcript turn) or "term-suggestions" (the ' +
    'spellings in a meeting that look like misheard names, each a "term" proposal) waiting in ' +
    'the Inbox, or "note", one new note in "folder". A Claude step never edits a note. ' +
    'A "steps" rule (the "After a meeting" rule) has "steps", [{ do, action, claude }], what it ' +
    'does to each note in order, and "set" and "claude" null: "do" is "correct-terms" (puts a ' +
    'meeting\'s misheard spellings right), "link-meeting" (links its people and companies) or ' +
    '"claude", with "claude" as above for a Claude step and null for the others, and "action" ' +
    'the step in words. The two meeting steps are deterministic and recorded on the meeting; ' +
    'the import has already done both for a meeting it let in, so there they write nothing and ' +
    'say "already". "steps" is null for any other rule. ' +
    '"lastRun" is { at, kind, trigger, summary } or null, "trigger" "note" for a run a note set ' +
    'off; "nextRun" is a local time or null; "paused" says why the app is holding it back. A ' +
    `rule under "broken" cannot be read and never runs. ${IN_THE_APP}`,
  inputSchema: noInput,
  annotations: READ_ONLY,
  call: (client) => client.automations(),
});

export const automationLog = defineTool({
  name: 'atlas_automation_log',
  title: "Read an automation's log",
  description:
    "An automation's log, newest first: { automation: { id, name }, entries: [{ kind, at, " +
    'heading, summary, trigger?, of?, problem?, capped?, count?, done, left, versions?, went?, ' +
    'claude?, steps? }], ' +
    'truncated }. "versions" lists, on a run of a rule a note sets off, each note version ' +
    '{ path, digest, wrote } it handled, or its own write left; none of them sets it off again. ' +
    '"went" lists paths a note it had handled left — deleted, moved, renamed, archived or ' +
    'replaced: a new note there is new to it. "kind" is ' +
    '"run", "undo", "failed" (its query did not read, or its Claude step failed), "turnedOn", ' +
    '"seen" or "letGo" (held back, it heard more syncs\' news than it keeps and let "count" of ' +
    'them go; a run by hand takes the notes they named). "done" lists each note it moved ({ kind: "archived", from, to }), each property it ' +
    'set, with its value before and after, or each note a Claude step made ({ kind: "proposed" ' +
    'or "created", path }), or what a step did to a meeting ({ kind: "corrected" or "linked", ' +
    'path, count }: how many misheard spellings it put right, or links it added; "uncorrected" ' +
    'and "unlinked" on an undo that took them back); "left" lists notes it matched and left ' +
    'alone, with why. "steps", on a run or failed entry of a rule of several steps, is { note, ' +
    'records: [{ step, outcome, said }] }: such a rule logs one entry per note (per meeting), ' +
    'and this is that note and each step in order — "step" is "correct-terms", "link-meeting" ' +
    'or "claude <output>"; "outcome" is "done", "already" (done before the step ran: the import ' +
    'corrects and links a meeting as it lets it in), "nothing" (it ran and found nothing to ' +
    'do), "failed" or "skipped" (not run, because an earlier step failed); "said" is what it ' +
    'did or why not. A failed step makes the entry "failed": its "done" is what the earlier ' +
    'steps did, which stays, and a run by hand takes the note again. "claude" is ' +
    '{ model, ms }: the model a Claude step asked and how long it took — with "cut", ' +
    '[{ path, shown, of }], when a note was too long to show it whole: the characters it read, ' +
    'of how many; "asks", how many times the model was asked (what the hourly cap counts); ' +
    '"alreadyMade", how many proposals it answered with were made before and so not made again; ' +
    '"dropped" and "adjusted", [{ title, reason }], for each item of an answer it left out, or ' +
    'kept with a fault put right (a due date that was no date); and "warnings", what to know of the run; ' +
    'on a rule of several steps it sums every Claude step that ran. ' +
    'An unknown id is "not_found"; a rule that cannot be read is "invalid".',
  inputSchema: z.object({
    id,
    limit: limit.max(100).optional().describe('At most this many entries, 1 to 100. Default 20.'),
  }),
  annotations: READ_ONLY,
  call: (client, { id: ruleId, ...query }) => client.automationLog(ruleId, definedOnly(query)),
});

export const automationDryRun = defineTool({
  name: 'atlas_automation_dry_run',
  title: 'Dry-run an automation',
  description:
    "What an automation would do if it ran now, found as the app's Dry run finds it and with " +
    'nothing written — for a rule a note sets off, the notes its query matches that it has not ' +
    'handled as they are now: { automation: { id, name }, plan: { do, set, claude, steps, summary, notes: ' +
    '[{ path, title }], passedOver: [{ path, reason }], passedOverMore, capped, cap } }. "notes" ' +
    'are the notes it would archive, set "set" on — a note that already holds those values is ' +
    'left out — or ask Claude about, with the prompt and tools under "claude"; Claude is not ' +
    'asked. For a rule of several steps ("do": "steps"), "steps" is [{ do, action, claude }], ' +
    'the steps a run would carry out on each note in order, as atlas_automations lists them, ' +
    'and "summary" names them; no step is run, so nothing is corrected or linked. "steps" is ' +
    'null for any other rule. "capped" is ' +
    'true when more matched than one run may do ("cap"). "passedOver" lists at most 500 notes it ' +
    'would leave alone; "passedOverMore" counts the rest. A rule whose query does not read is ' +
    `"query_failed", with why. ${IN_THE_APP}`,
  inputSchema: z.object({ id }),
  annotations: READ_ONLY,
  call: (client, { id: ruleId }) => client.automationDryRun(ruleId),
});

export const automationTools = [automations, automationLog, automationDryRun];
