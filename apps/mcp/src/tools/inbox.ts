/** The Inbox: what waits there, clarifying a task, and filing a note under a project or an area. */

import { z } from 'zod';
import { defineTool } from './define.ts';
import { noInput, notePath } from './inputs.ts';

export const inbox = defineTool({
  name: 'atlas_inbox',
  title: 'What waits in the Inbox',
  description:
    'What waits in the Inbox, as its page lists it, newest first: every note in Inbox/, and ' +
    'every task whose status is inbox wherever it lives (imported into Tasks/, say): ' +
    '{ items: [{ path, title, type, arrivedIn, importOutcome, importError, task }], truncated }. ' +
    'task is null for a note that is not a task, else what it says already: { status, project, ' +
    'waitingOn, waitingOnNames, defer, due } — project and waitingOn are paths. A task given ' +
    'another status has left the list, with or without a project. arrivedIn is the folder of ' +
    'the Inbox it came in ("Meetings", or "" for the Inbox itself, or a task living ' +
    'elsewhere). importOutcome is what the meeting import made of a meeting file: imported, ' +
    'duplicate, error (importError says why) or pending while it waits; null for any other ' +
    'note. Proposals are not listed: they are answered with atlas_proposals, ' +
    'atlas_accept_proposal and atlas_reject_proposal, never filed. Clarify a task with ' +
    'atlas_clarify_inbox_item; file any other note with atlas_process_inbox_item. Read-only.',
  inputSchema: noInput,
  annotations: { readOnlyHint: true },
  call: (client) => client.inbox(),
});

export const processInboxItem = defineTool({
  name: 'atlas_process_inbox_item',
  title: 'Process an Inbox note',
  description:
    "File a note from the Inbox under a project or an area, as the Inbox's Process does in " +
    "Atlas: it moves into the project's folder (Projects/Atlas.md files into Projects/Atlas/), " +
    'keeping its name, and gets project: "[[Atlas]]" linking it; links to it in other notes are ' +
    'rewritten. Captured tasks wait in Inbox/ and imported meetings in Inbox/Meetings/ — list ' +
    'what waits with atlas_inbox. A proposal (type proposal, wherever it is) is refused: answer ' +
    'it with atlas_accept_proposal or atlas_reject_proposal. "project" must be a note of type project or ' +
    'area, still in use (not in the Inbox, not archived); anything else is refused before the ' +
    'note moves. Returns { moves: [{ from, to }], failed: [{ path, reason, code? }], ' +
    'linksUpdated }: a note that could not be filed — not in the Inbox, or open in Atlas with ' +
    'unsaved typing (code "unsaved_in_app"), which is never saved for you — is listed in ' +
    '"failed" rather than moved.',
  inputSchema: z.object({
    path: notePath.describe('The note waiting in the Inbox, e.g. "Inbox/Call Sam.md".'),
    project: notePath.describe(
      'The project or area to file it under, by its path, e.g. "Projects/Atlas.md".',
    ),
  }),
  // A move that filing elsewhere undoes, so not destructive; a second call finds nothing in the Inbox.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  call: (client, { path, project }) => client.processInbox({ paths: [path], project }),
});

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable()
  .optional();

export const clarifyInboxItem = defineTool({
  name: 'atlas_clarify_inbox_item',
  title: 'Clarify an Inbox task',
  description:
    "Decide what one item waiting in the Inbox is, as a row of Atlas's Inbox page does (GTD's " +
    'clarify step). Everything given is written in ONE save of the note, the rest of the file ' +
    'kept byte for byte: status (inbox, backlog, next-action, in-progress, waiting, someday, ' +
    'longterm, archive), waitingOn (optional: the path of a note of type person), defer and ' +
    'due (YYYY-MM-DD), contexts. A key left out is left as the note has it; null clears ' +
    'waitingOn, defer or due, and [] clears contexts. The GTD rules hold: status "waiting" ' +
    'never needs waitingOn; "archive" dates the task completed today. "project" (a note of type project or area, still in use) files a note ' +
    "that is in Inbox/ — moved into the project's folder and linked, as " +
    'atlas_process_inbox_item does — and only links a task that lives elsewhere. A task given a ' +
    'status other than inbox leaves the Inbox even with no project. Only a task takes a status, ' +
    'a wait or a date; asTask: true first makes a plain note (no type) a task. A proposal is ' +
    'refused: answer it with atlas_accept_proposal or atlas_reject_proposal. Anything refused ' +
    'writes nothing. It works on any task in use, not only one atlas_inbox lists, but never ' +
    "an archived one; a status the vault's Task type does not declare is refused; waitingOn " +
    'is written only when the task is, or is being made, waiting. Returns { path, movedFrom, failed: [{ path, reason, code? }], linksUpdated }: ' +
    'path is where the note is now, movedFrom where it was if it was filed. A note open in ' +
    'Atlas with unsaved typing is refused ("unsaved_in_app"); it is never saved for you. One ' +
    'that changed on disk while being clarified is "conflict": read it again and retry.',
  inputSchema: z.object({
    path: notePath.describe(
      'The note to clarify, as atlas_inbox lists it, e.g. "Inbox/Call Sam.md".',
    ),
    status: z
      .enum([
        'inbox',
        'backlog',
        'next-action',
        'in-progress',
        'waiting',
        'someday',
        'longterm',
        'archive',
      ])
      .optional()
      .describe('The GTD status to give it.'),
    project: notePath
      .optional()
      .describe('The project or area to file it under, by its path, e.g. "Projects/Atlas.md".'),
    waitingOn: notePath
      .nullable()
      .optional()
      .describe(
        'The person it waits on, by their path, e.g. "People/Mara Quill.md"; null clears it.',
      ),
    defer: day.describe('The day it comes back into view, YYYY-MM-DD; null clears it.'),
    due: day.describe('The day it is due, YYYY-MM-DD; null clears it.'),
    contexts: z
      .array(z.string().min(1))
      .optional()
      .describe('Where it can be done, e.g. ["@desk"]; [] clears them.'),
    asTask: z.boolean().optional().describe('Make a plain note a task before clarifying it.'),
  }),
  // One write that the next call replaces, never a delete; filing twice finds nothing to file.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  call: (client, body) => client.clarifyInbox(withoutUndefined(body)),
});

/** The input with the keys the caller left out dropped, so a key left out stays left out. */
function withoutUndefined<Input extends Record<string, unknown>>(input: Input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as {
    [Key in keyof Input]: Exclude<Input[Key], undefined>;
  };
}

export const inboxTools = [inbox, processInboxItem, clarifyInboxItem];
