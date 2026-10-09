/** Checklists: a line of a note's checklist made a task of its own (P30-03). */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { notePath } from './inputs.ts';

export const promoteChecklistLine = defineTool({
  name: 'atlas_promote_checklist_line',
  title: 'Make a checklist line a task',
  description:
    'Make one "- [ ]" line of a note\'s checklist a task of its own, as "Make task" does in ' +
    "Atlas. The task is a new note beside the line's, named by the line's words, with type " +
    'task, status inbox (archive, dated completed, when the line is ticked), "source" a link to ' +
    'the line ("[[Plan#^k3x9q1]]") and "project" whatever the line\'s note is filed under — or ' +
    'that note, when it is a project or an area. The line becomes a link to the task, keeping ' +
    'its box. Name the line by "text", its words without the box; when two lines say the same, ' +
    'also give "line", its place among the note\'s boxes counting from 0 in the order written, ' +
    'nested ones after the line they are under. Returns { note, task }, both as they now are. ' +
    'Refused with "not_found" when no line says the text, "unsaved_in_app" when the note has ' +
    'unsaved edits open in Atlas, and "conflict" when it changed while the task was made. A ' +
    'note\'s progress through its checklist is the "progress" field of atlas_run_query and the ' +
    'progress column of atlas_query and atlas_run_view.',
  inputSchema: z.object({
    path: notePath.describe('The note the line is in, e.g. "Tasks/Plan the launch.md".'),
    text: z
      .string()
      .min(1)
      .describe('The line\'s words as written, without its box, e.g. "Order chairs".'),
    line: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Its place among the note's boxes, from 0; only when two lines say the same."),
  }),
  // A new note and one changed line, undone only in the app; a second call finds the line a link.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  call: (client, { path, ...body }) => client.promoteChecklistLine(path, definedOnly(body)),
});

export const checklistTools = [promoteChecklistLine];
