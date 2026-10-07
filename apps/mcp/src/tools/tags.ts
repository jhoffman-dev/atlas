/** Tools for the vault's tags: `/v1/tags/...`. */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { limit } from './inputs.ts';

const READ_ONLY = { readOnlyHint: true } as const;

const tag = z
  .string()
  .min(1)
  .describe(
    'A tag\'s name, with or without its "#", in any case: "idea", "#Idea", "para/resource". ' +
      'A nested tag is its whole name, parts separated by "/".',
  );

export const listTags = defineTool({
  name: 'atlas_tags',
  title: 'List tags',
  description:
    "Every tag used in the vault's notes, nested as the tags page shows them: " +
    '{ tags: [{ name, label, count, total, children }] }. "count" is uses of that exact tag, ' +
    '"total" includes every tag nested under it, and "name" is how to name it to the other tag ' +
    'tools. Sorted by name, or by total uses with sort "frequency".',
  inputSchema: z.object({
    sort: z.enum(['name', 'frequency']).optional().describe('Default "name".'),
  }),
  annotations: READ_ONLY,
  call: (client, { sort }) => client.tags(sort),
});

export const taggedNotes = defineTool({
  name: 'atlas_tagged_notes',
  title: 'Notes with a tag',
  description:
    'The notes using a tag or any tag nested under it, in path order: ' +
    '{ tag, notes: [{ path, title, uses }], next }. When "next" is not null, call again with it ' +
    'as "cursor" for the next page. Fails with "not_found" when no note uses the tag.',
  inputSchema: z.object({
    tag,
    limit: limit.optional(),
    cursor: z.string().optional().describe('The "next" value from the previous page.'),
  }),
  annotations: READ_ONLY,
  call: (client, { tag: name, ...page }) => client.taggedNotes(name, definedOnly(page)),
});

export const renameTag = defineTool({
  name: 'atlas_rename_tag',
  title: 'Rename a tag',
  description:
    'Rename a tag in every note using it — in the "tags" property and the body, and every tag ' +
    'nested under it (#para/x becomes #area/x) — as the tags page in Atlas does. It only ' +
    'previews unless dryRun is false: { rename: { from, to, files, uses, mergesInto, notes, ' +
    'skipped } }, writing nothing. Show that to the user, then call again with dryRun false to ' +
    'write; that also answers { report: { updated, failed } }. A note open in Atlas with unsaved ' +
    'typing is left alone and listed in "failed"; notes in .atlas (templates), and notes where ' +
    'the new name could not be written so it reads back, are listed in "skipped". When ' +
    '"mergesInto" is not null the new name is a tag in use already (or the parent of one), the ' +
    'two become one and renaming back cannot part them; that fails with "exists" unless merge ' +
    'is true. Renaming a tag to its own name in another case (idea to Idea) rewrites every use ' +
    'to that spelling. If a call times out, the rename may still finish: preview again before ' +
    'retrying.',
  inputSchema: z.object({
    tag,
    to: z.string().min(1).describe('The new name, with or without its "#".'),
    dryRun: z
      .boolean()
      .optional()
      .describe('Unless false, only say what would change. False: rename.'),
    merge: z
      .boolean()
      .optional()
      .describe('True: allow joining a tag in use already, as "mergesInto" names it.'),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
  },
  // Previews unless told plainly to write: a model that leaves dryRun out gets the preview.
  call: (client, { tag: name, dryRun, ...body }) =>
    client.renameTag(name, definedOnly({ ...body, dryRun: dryRun !== false })),
});

export const tagTools = [listTags, taggedNotes, renameTag];
