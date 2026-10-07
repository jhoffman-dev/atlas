/** Tools for the vault's templates: `/v1/templates`. Read-only — templates are edited in the app. */

import { z } from 'zod';
import { defineTool } from './define.ts';
import { noInput } from './inputs.ts';

const READ_ONLY = { readOnlyHint: true } as const;

export const listTemplates = defineTool({
  name: 'atlas_list_templates',
  title: 'List templates',
  description:
    'Every template in the vault and what makes notes from it: { templates: [{ name, path, uses }], ' +
    'typesWithoutTemplate }. Each use is { kind: "type", type, label } (new notes of that type), ' +
    '"daily" (today\'s note), "capture" (captured tasks) or "artifact" (saved artifacts); a ' +
    'template with no uses is offered only by name. "typesWithoutTemplate" names the types whose ' +
    'new notes start empty. Pass a "name" to atlas_create_note as "template", or to ' +
    'atlas_read_template to see what it holds. Read-only: making, renaming, editing and deleting ' +
    'templates stay in the app.',
  inputSchema: noInput,
  annotations: READ_ONLY,
  call: (client) => client.templates(),
});

export const readTemplate = defineTool({
  name: 'atlas_read_template',
  title: 'Read a template',
  description:
    'Read one template by name, in any case: { template: { name, path, uses, properties, body } }. ' +
    '"properties" and "body" are what a note made from it with atlas_create_note starts with. Of ' +
    'two templates with one name, this answers the one atlas_create_note uses. Fails with ' +
    '"not_found" when no template has the name. Read-only.',
  inputSchema: z.object({
    name: z
      .string()
      .min(1)
      .describe('A template\'s name, as atlas_list_templates gives it, e.g. "Person".'),
  }),
  annotations: READ_ONLY,
  call: (client, { name }) => client.template(name),
});

export const templateTools = [listTemplates, readTemplate];
