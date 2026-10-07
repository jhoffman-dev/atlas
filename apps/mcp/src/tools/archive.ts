/** The Archive: putting notes in it, taking them out, and finding what is there. */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { limit, notePath } from './inputs.ts';

const paths = z
  .array(notePath)
  .min(1)
  .max(100)
  .describe('1 to 100 note paths, exactly as other tools returned them.');

const OUTCOME =
  'Returns { moves: [{ from, to }], failed: [{ path, reason, code? }], linksUpdated }. A note ' +
  'that cannot move is listed in "failed" with why, and the rest still move — so read "failed" ' +
  'rather than assuming every path moved. A note open in Atlas with unsaved typing is never ' +
  'saved for you: it, or a note linking to one that moved, is left alone and listed with ' +
  'code "unsaved_in_app". A note whose links could not be rewritten is listed too.';

/** A move that unarchiving undoes, so not destructive; running it twice does not do the same thing. */
const MOVES = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;

export const archive = defineTool({
  name: 'atlas_archive',
  title: 'Archive notes',
  description:
    'Put notes in the Archive, as the Archive command in Atlas does: each moves under Archive/ ' +
    'at the path it had (Projects/X.md becomes Archive/Projects/X.md) and is stamped with ' +
    '"archived" (today) and "archivedFrom" (where it was). Links to it in other notes are ' +
    'rewritten so they still open it. Archived notes leave search, views and queries unless ' +
    `asked for. Undo with atlas_unarchive. ${OUTCOME}`,
  inputSchema: z.object({ paths }),
  annotations: MOVES,
  call: (client, input) => client.archive(input),
});

export const unarchive = defineTool({
  name: 'atlas_unarchive',
  title: 'Unarchive notes',
  description:
    'Take notes out of the Archive, each back to its path without Archive/ ' +
    '(Archive/Projects/X.md goes to Projects/X.md, numbered if something has taken that path ' +
    'since), restoring the properties the archive stamp covered and rewriting links to it. ' +
    'Editing "archivedFrom" does not send a note anywhere else. Pass paths under Archive/, as ' +
    `atlas_archived lists them. ${OUTCOME}`,
  inputSchema: z.object({ paths }),
  annotations: MOVES,
  call: (client, input) => client.unarchive(input),
});

export const archived = defineTool({
  name: 'atlas_archived',
  title: 'List archived notes',
  description:
    'List the notes in the Archive, most recently archived first: { notes: [{ path, title, ' +
    'from, archivedOn }], truncated, next }. "from" is where atlas_unarchive puts a note back; ' +
    '"archivedOn" is YYYY-MM-DD, or null. When "next" is a number, pass it as "offset" for the ' +
    'next page. To find an archived note by its text, use atlas_search with includeArchived.',
  inputSchema: z.object({
    search: z
      .string()
      .optional()
      .describe('Keep notes whose title or path holds every one of these words, in any case.'),
    limit: limit.max(500).optional(),
    offset: z.number().int().min(0).optional().describe('How many to skip: a previous "next".'),
  }),
  annotations: { readOnlyHint: true },
  call: (client, input) => client.archived(definedOnly(input)),
});

export const archiveTools = [archive, unarchive, archived];
