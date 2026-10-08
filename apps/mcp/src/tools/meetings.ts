/** Meetings: what arrived, and what the import made of each (ADR-0027). */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { includeArchived, limit } from './inputs.ts';

export const meetings = defineTool({
  name: 'atlas_meetings',
  title: 'List meetings',
  description:
    'List meetings, newest first by date and start time: { meetings: [{ path, title, date, ' +
    'start, end, kind, provider, externalId, importOutcome, importError, duplicateOf }], ' +
    'truncated, next }. Meetings arrive as files in Inbox/Meetings/ and Atlas imports each, ' +
    'stamping "importOutcome": imported, duplicate or error (null: not imported yet). ' +
    '"importError" is non-null for a file that broke the meeting import contract: it says why, ' +
    'the file stays where it landed, and fixing the file (atlas_update_properties or ' +
    'atlas_replace_note_body) makes Atlas import it and clear the error. A second copy of a ' +
    'meeting is archived with "duplicateOf" linking the first, so it is listed only with ' +
    'includeArchived. A key the file lacks is null. When "next" is a number, pass it as ' +
    '"offset" for the next page. Read a meeting itself with atlas_read_note.',
  inputSchema: z.object({
    since: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe('Keep meetings on or after this day, YYYY-MM-DD.'),
    limit: limit.max(500).optional(),
    offset: z.number().int().min(0).optional().describe('How many to skip: a previous "next".'),
    includeArchived: includeArchived.optional(),
  }),
  annotations: { readOnlyHint: true },
  call: (client, input) => client.meetings(definedOnly(input)),
});

export const meetingTools = [meetings];
