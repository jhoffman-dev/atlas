/** Tools that describe the vault as a whole: status, search, types, views, and whose it is. */

import { z } from 'zod';
import { defineTool, definedOnly } from './define.ts';
import { includeArchived, limit, noInput } from './inputs.ts';

const READ_ONLY = { readOnlyHint: true } as const;

export const status = defineTool({
  name: 'atlas_status',
  title: 'Atlas status',
  description:
    'Check that Atlas is running and which vault it has open: { app, version, vault, index }. ' +
    'When "vault" is null no vault is open and every other tool fails with "no_vault". Call this ' +
    'first if another tool reports a connection problem.',
  inputSchema: noInput,
  annotations: READ_ONLY,
  call: (client) => client.status(),
});

export const search = defineTool({
  name: 'atlas_search',
  title: 'Search notes',
  description:
    'Full-text search across the notes in the vault. Returns { hits: [{ path, title, snippet }] }, ' +
    "best match first, with the matching words in the snippet wrapped in << and >>. Use a hit's " +
    '"path" with atlas_read_note to read the whole note. Archived notes are left out unless ' +
    'includeArchived is true; then each archived hit carries "archived": true.',
  inputSchema: z.object({
    q: z.string().min(1).describe('The words to search for.'),
    limit: limit.optional(),
    includeArchived: includeArchived.optional(),
  }),
  annotations: READ_ONLY,
  call: (client, input) => client.search(definedOnly(input)),
});

export const listTypes = defineTool({
  name: 'atlas_list_types',
  title: 'List object types',
  description:
    "List the vault's object types (e.g. Task, Project, Person) and each one's properties: key, " +
    'kind, whether it is required, the allowed options for a select, and the target type for a ' +
    'relation. Read this before creating a typed note, setting properties, or writing a query, so ' +
    'you use real keys and allowed values.',
  inputSchema: noInput,
  annotations: READ_ONLY,
  call: (client) => client.types(),
});

export const listViews = defineTool({
  name: 'atlas_list_views',
  title: 'List saved views',
  description:
    'List the saved views and dashboards: { views: [{ path, title, kind, type, layout, groupBy, ' +
    'subGroupBy, order }] }. "groupBy" is what a board\'s columns or a table\'s groups are, ' +
    '"subGroupBy" its swimlanes or sub-groups (null for none), "order" a view\'s place among its ' +
    "type's tabs (null when never placed). For one type's views in tab order, use " +
    'atlas_list_type_views. Run one with atlas_run_view, passing its "path".',
  inputSchema: noInput,
  annotations: READ_ONLY,
  call: (client) => client.views(),
});

export const listTypeViews = defineTool({
  name: 'atlas_list_type_views',
  title: "List a type's views",
  description:
    "List one type's views in the order its tabs read in Atlas: { type, views: [{ path, title, " +
    'layout, order, virtual }], total, next }. "order" is the view\'s place (null when never ' +
    'placed; those read after the placed ones). When "next" is a number, pass it as "offset" for ' +
    'the next page. A type with no views answers its default table with "virtual": true — not a ' +
    'file yet, so atlas_run_view cannot run it; use atlas_run_query "FROM <type>" (or ' +
    'atlas_query with the type) for its notes. Read-only: adding, renaming, copying, reordering ' +
    'and deleting views stay in the app.',
  inputSchema: z.object({
    type: z.string().min(1).describe("The type's name, as atlas_list_types gives it."),
    limit: limit.max(500).optional(),
    offset: z.number().int().min(0).optional().describe('How many to skip: a previous "next".'),
  }),
  annotations: READ_ONLY,
  call: (client, { type, ...page }) => client.typeViews(type, definedOnly(page)),
});

export const profile = defineTool({
  name: 'atlas_profile',
  title: "The person's name",
  description:
    'Read who uses this vault, as Settings → Profile says: { profile: { name, preferredName, ' +
    'placeholder } }. Use "name" wherever a note needs the person\'s name — an owner, author, ' +
    'assignee or attendee. When "name" is null, write "placeholder" ("[Your name]") or ask; never ' +
    'guess a name from a username, an email address or a path. Read only: the name is set in Settings.',
  inputSchema: noInput,
  annotations: READ_ONLY,
  call: (client) => client.profile(),
});

export const vaultTools = [status, search, listTypes, listViews, listTypeViews, profile];
