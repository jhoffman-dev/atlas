/** Tools that change notes through a saved view's groups: a board's card moves, and "+ New" in a group. */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { ifModified, notePath } from './inputs.ts';

const viewPath = z
  .string()
  .min(1)
  .describe("The view's path exactly as atlas_list_views returned it.");

const groupValue = (what: string) =>
  z
    .string()
    .nullable()
    .optional()
    .describe(
      `The ${what}'s "value" exactly as atlas_run_view's groups answer it; null for its "No value" group.`,
    );

export const moveCard = defineTool({
  name: 'atlas_move_card',
  title: 'Move a card on a board',
  description:
    'Move a note on a board view to another column ("group"), swimlane ("subGroup"), or both, ' +
    'exactly as dragging the card in Atlas does: one write, and a move into the done column (or ' +
    'done lane) finishes the task, rolling a repeating one forward to its next date. Such a ' +
    'finishing move needs ifModified (the note\'s "modified" from atlas_read_note), so a retry ' +
    'is refused as stale rather than finishing the task twice; without it the move is refused. ' +
    "A group must be one of the board's own (atlas_run_view lists them), matched as the board " +
    'matches it; a group the card is already in is left alone. The view must be a board ' +
    '(atlas_list_views shows its layout, groupBy and subGroupBy). Returns { note, moved }; ' +
    '"moved" is false when nothing changed.',
  inputSchema: z.object({
    path: viewPath,
    note: notePath,
    group: groupValue('column'),
    subGroup: groupValue('swimlane'),
    ifModified: ifModified.optional(),
  }),
  // Not idempotent: the same move into done, sent twice, finishes a repeating task twice.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  call: (client, { path, ...body }) => client.moveCard(path, definedOnly(body)),
});

export const addViewNote = defineTool({
  name: 'atlas_add_to_view',
  title: "Add a note in a view's group",
  description:
    'Add a note of a saved view\'s type inside one of its groups, as "+ New" in that group does: ' +
    "it is given the group's value (and its sub-group's), typed as the property stores it — a " +
    'number as a number, a checkbox ticked. Made at the vault root, named "New <type>" unless ' +
    'a name is given, and numbered past any note already called that. Returns { note }.',
  inputSchema: z.object({
    path: viewPath,
    name: z.string().optional().describe('The new note\'s name. Omit for "New <type>".'),
    group: groupValue('group'),
    subGroup: groupValue('sub-group'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  call: (client, { path, ...body }) => client.addViewNote(path, definedOnly(body)),
});

export const viewTools = [moveCard, addViewNote];
