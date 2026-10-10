/** The Inbox: filing what waits there under a project or an area. */

import { z } from 'zod';
import { defineTool } from './define.ts';
import { notePath } from './inputs.ts';

export const processInboxItem = defineTool({
  name: 'atlas_process_inbox_item',
  title: 'Process an Inbox note',
  description:
    "File a note from the Inbox under a project or an area, as the Inbox's Process does in " +
    "Atlas: it moves into the project's folder (Projects/Atlas.md files into Projects/Atlas/), " +
    'keeping its name, and gets project: "[[Atlas]]" linking it; links to it in other notes are ' +
    'rewritten. Captured tasks wait in Inbox/ and imported meetings in Inbox/Meetings/ — list ' +
    'them with atlas_list_notes and folder "Inbox". "project" must be a note of type project or ' +
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

export const inboxTools = [processInboxItem];
