/** Tools for the vault's people: `/v1/people/...` (#464). */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';

const notePath = z
  .string()
  .min(1)
  .describe('A person\'s note, vault-relative with its .md: "People/Mara Quill.md".');

export const duplicatePeople = defineTool({
  name: 'atlas_find_duplicate_people',
  title: 'Find duplicate people',
  description:
    'Pairs of Person notes that may be one person, surest first: { pairs: [{ left, right, ' +
    'reasons }] }, each side { path, name }. A reason is "same-email", "same-name" (the same ' +
    'title in two folders), "alias" (an alias of one is the other\'s name), or "similar-email" ' +
    '(the same or a near domain, and local parts that are one without their dots, a first name ' +
    'and a full one, or a typo apart). Pairs the user said are not one person are left out. ' +
    'Offer a pair to the user before merging it with atlas_merge_people.',
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true },
  call: (client) => client.duplicatePeople(),
});

export const mergePeople = defineTool({
  name: 'atlas_merge_people',
  title: 'Merge people',
  description:
    "Merge Person notes into one, as Atlas's People page does. It only previews unless " +
    'confirm is true: { merge: { keep, merge, refusal, notes, links, conflicts, aliasesAdded, ' +
    'emailsAdded, appended, version } }, writing nothing. Show that to the user — above all ' +
    '"conflicts", the values the kept note keeps over a merged one\'s — then call again with ' +
    "confirm true and that preview's version to merge; that also answers { report: { written, notWritten, trashed, " +
    'notTrashed, failures, links } }. Merging joins lists, adds the merged emails and titles ' +
    'to the kept note, appends each merged body under a heading, re-points every link to the ' +
    'merged people at the kept one, and puts the merged notes in the Trash. A note open in ' +
    "Atlas with unsaved typing refuses it, and a confirm whose version is not the preview's " +
    'now — a note changed since — fails with "conflict" and nothing written: preview again.',
  inputSchema: z.object({
    keep: notePath.describe('The person to keep: "People/Mara Quill.md".'),
    merge: z
      .array(notePath)
      .min(1)
      .max(20)
      .describe('The people merged into them, then trashed: ["Mara.md"].'),
    confirm: z
      .boolean()
      .optional()
      .describe('True: make the merge. Absent or false: only say what it would do.'),
    version: z
      .string()
      .min(1)
      .optional()
      .describe('With confirm: the "version" of the preview shown to the user.'),
  }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  // Previews unless told plainly to write: a model that leaves confirm out gets the preview.
  call: (client, { confirm, ...body }) =>
    client.mergePeople(definedOnly({ ...body, confirm: confirm === true })),
});

export const peopleTools = [duplicatePeople, mergePeople];
