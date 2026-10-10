/** The Inbox: what waits there to be filed, and filing it under a project or an area. */

import { z } from 'zod';
import { defineTool } from './define.ts';
import { noInput, notePath } from './inputs.ts';

export const inbox = defineTool({
  name: 'atlas_inbox',
  title: 'What waits in the Inbox',
  description:
    'The notes waiting in the Inbox to be filed, as its page lists them, newest first: ' +
    '{ items: [{ path, title, type, arrivedIn, importOutcome, importError }], truncated }. ' +
    'arrivedIn is the folder of the Inbox it came in ("Meetings", or "" for the Inbox ' +
    'itself). importOutcome is what the meeting import made of a meeting file: imported, ' +
    'duplicate, error (importError says why) or pending while it waits; null for any other ' +
    'note. Proposals are not listed: they are answered with atlas_proposals, ' +
    'atlas_accept_proposal and atlas_reject_proposal, never filed. File an item with ' +
    'atlas_process_inbox_item. Read-only.',
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

export const inboxTools = [inbox, processInboxItem];
