/** Timeblocking: putting a task into time on the calendar. */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { notePath } from './inputs.ts';

export const scheduleTask = defineTool({
  name: 'atlas_schedule_task',
  title: 'Schedule a task into a block',
  description:
    'Set time aside for a task on the calendar, as dragging it onto empty time in Atlas does: ' +
    'makes a new block note (type: block) from "start" for "minutes", linking the task in its ' +
    '"tasks", from the Block template when the vault has one, at the top of the vault, named ' +
    '"<task> block" (numbered when taken). Call it again to split a task across another block. ' +
    'Times are local wall-clock with no offset, e.g. "2026-10-12T09:00": a block running past ' +
    'midnight ends the next day. Without "minutes" the block is as long as the task still needs ' +
    '(its estimate less what its blocks already give it), or 30 when it has no estimate or needs ' +
    'nothing more. Returns the new block note. "task" must be a note of type task; a start with ' +
    'no time, or minutes outside 1 to 1440, is refused as invalid. To add a task to a block ' +
    'that is already there, change the block\'s "tasks" with atlas_update_properties; to see ' +
    'what each task has scheduled, atlas_query with "schedule": true.',
  inputSchema: z.object({
    task: notePath.describe('The task to schedule, by its path, e.g. "Quarterly report.md".'),
    start: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'local wall-clock time, "2026-10-12T09:00"')
      .describe(
        'When the block starts: local wall-clock time to the minute, "2026-10-12T09:00" — no ' +
          'seconds, "Z" or offset; convert a UTC time to the local clock first.',
      ),
    minutes: z
      .number()
      .int()
      .min(1)
      .max(1440)
      .optional()
      .describe('How long the block runs, in minutes. Omit to size it to what the task needs.'),
  }),
  // A new note each call, undone by deleting it: not destructive, and not idempotent.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  call: (client, input) => client.scheduleTask(definedOnly(input)),
});

export const scheduleTools = [scheduleTask];
