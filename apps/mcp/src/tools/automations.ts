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
  'Running a rule, undoing its last run, and making, editing or turning one on or off are done ' +
  'in Atlas, on the Automations page, not through these tools.';

export const automations = defineTool({
  name: 'atlas_automations',
  title: 'List automations',
  description:
    'Every automation in the vault — a rule that archives notes, or sets properties on them, on ' +
    'a schedule or when a note of a type is created or changed — as the Automations page lists ' +
    'it: { automations: [{ id, name, path, enabled, when, note, which, olderThanDays, do, set, ' +
    'schedule, action, lastRun, nextRun, paused }], broken: [{ path, name, problem }] }. "when" ' +
    'is as the rule\'s file writes it ("daily at 03:00", "a meeting is created or changed"); ' +
    '"note" is { type, on: ["created" and/or "changed"] } for a rule a note sets off, which runs ' +
    'once per version of each note of that type its query matches, or null. "which" is the ' +
    'Atlas query naming its notes; "do" is "archive" or "set", with "set" the values it writes. ' +
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
    'heading, summary, trigger?, of?, problem?, capped?, done, left, versions? }], truncated }. ' +
    '"versions" lists, on a run of a rule a note sets off, each note version { path, digest, ' +
    'wrote } it handled, or its own write left; none of them sets it off again. "kind" is ' +
    '"run", "undo", "failed" (its query did not read), "turnedOn" or "seen". "done" lists each ' +
    'note it moved ({ kind: "archived", from, to }) or each property it set, with its value ' +
    'before and after; "left" lists notes it matched and left alone, with why. ' +
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
    'handled as they are now: { automation: { id, name }, plan: { do, set, summary, notes: [{ path, ' +
    'title }], passedOver: [{ path, reason }], passedOverMore, capped, cap } }. "notes" are the ' +
    'notes it would archive, or set "set" on — a note that already holds those values is left ' +
    'out. "capped" is ' +
    'true when more matched than one run may do ("cap"). "passedOver" lists at most 500 notes it ' +
    'would leave alone; "passedOverMore" counts the rest. A rule whose query does not read is ' +
    `"query_failed", with why. ${IN_THE_APP}`,
  inputSchema: z.object({ id }),
  annotations: READ_ONLY,
  call: (client, { id: ruleId }) => client.automationDryRun(ruleId),
});

export const automationTools = [automations, automationLog, automationDryRun];
