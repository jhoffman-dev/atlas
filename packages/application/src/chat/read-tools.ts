import type { ModelToolSpec, ToolCall, ToolResult } from '@atlas/domain';
import { routeApiRequest, type ApiRequest, type ApiRouterDeps } from '../api/index.ts';
import { cappedJson } from './capped-json.ts';

/**
 * The chat's read tools (P27-03). Each is one request to the local API's
 * router, answered in-process by the same handlers the MCP server reaches over
 * HTTP — so the chat sees exactly what an MCP client sees, and no rule is
 * written twice. Only these read routes are reachable; none of the API's
 * writes is.
 */

/** A tool result beyond this is cut, so one big answer cannot fill the model's context. */
export const TOOL_RESULT_CHARACTERS = 30_000;

type Input = Readonly<Record<string, unknown>>;
type Call = Pick<ApiRequest, 'method' | 'path' | 'query' | 'body'>;

interface ReadTool {
  readonly spec: ModelToolSpec;
  readonly request: (input: Input) => Call;
}

const str = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', minimum: 1, description });
const ARCHIVED = {
  type: 'boolean',
  description: 'Include archived notes. Only when the person asks about archived notes.',
};
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** A tool call whose arguments the route could not be asked with: told to the model as `invalid`. */
class InvalidToolInput extends Error {}

/**
 * The argument that names the route — a path, a type, a tag — as a path
 * segment. Anything but text would be asked for as "undefined" or
 * "[object Object]" and refused as not found, which tells the model nothing.
 */
function segment(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InvalidToolInput(`${key} must be a non-empty string.`);
  }
  return encodeURIComponent(value);
}
/** The query string as the router reads it: defined values only, as text. */
function query(input: Input, keys: readonly string[]): Record<string, string> {
  const pairs = keys.flatMap((key) => {
    const value = input[key];
    return value === undefined || value === null || value === false ? [] : [[key, String(value)]];
  });
  return Object.fromEntries(pairs);
}
const get = (path: string, q: Record<string, string> = {}): Call => ({
  method: 'GET',
  path,
  query: q,
  body: null,
});
const post = (path: string, body: unknown): Call => ({ method: 'POST', path, query: {}, body });

const READ_TOOLS: readonly ReadTool[] = [
  {
    spec: {
      name: 'atlas_search',
      description:
        'Full-text search across the notes. Returns { hits: [{ path, title, snippet }] }, best first. ' +
        'Read a hit with atlas_read_note.',
      inputSchema: object(
        {
          q: str('The words to search for.'),
          limit: int('At most this many hits.'),
          includeArchived: ARCHIVED,
        },
        ['q'],
      ),
    },
    request: (input) => get('/v1/search', query(input, ['q', 'limit', 'includeArchived'])),
  },
  {
    spec: {
      name: 'atlas_read_note',
      description: 'Read one note: its properties, its markdown body, and "modified".',
      inputSchema: object({ path: str('The note\'s vault path, e.g. "Projects/Q3.md".') }, [
        'path',
      ]),
    },
    request: (input) => get(`/v1/notes/${segment(input, 'path')}`),
  },
  {
    spec: {
      name: 'atlas_list_notes',
      description:
        'List notes, optionally in a folder or of a type: { notes: [{ path, title, type, modified }], next }.',
      inputSchema: object({
        folder: str('Vault-relative folder.'),
        type: str('Only notes of this type.'),
        limit: int('At most this many.'),
        cursor: str('The "next" of the previous page.'),
      }),
    },
    request: (input) => get('/v1/notes', query(input, ['folder', 'type', 'limit', 'cursor'])),
  },
  {
    spec: {
      name: 'atlas_backlinks',
      description:
        'The notes that link to this one: { backlinks: [{ path, title, type, modified }] }.',
      inputSchema: object({ path: str("The note's vault path.") }, ['path']),
    },
    request: (input) => get(`/v1/notes/${segment(input, 'path')}/backlinks`),
  },
  {
    spec: {
      name: 'atlas_list_types',
      description: "The vault's object types and each one's properties.",
      inputSchema: object({}),
    },
    request: () => get('/v1/types'),
  },
  {
    spec: {
      name: 'atlas_list_views',
      description:
        'The saved views and dashboards: { views: [{ path, title, kind, type, layout, order }] }.',
      inputSchema: object({}),
    },
    request: () => get('/v1/views'),
  },
  {
    spec: {
      name: 'atlas_list_type_views',
      description:
        "One type's views in the order its tabs read: { type, views: [{ path, title, layout, " +
        'order, virtual }], total, next }. When "next" is a number, pass it as "offset" for the ' +
        'next page. A virtual one is the default table of a type with no views: not a file, so ' +
        'atlas_run_view cannot run it; use atlas_run_query "FROM <type>" for its notes.',
      inputSchema: object(
        {
          type: str("The type's name, from atlas_list_types."),
          limit: int('At most this many views.'),
          offset: {
            type: 'integer',
            minimum: 0,
            description: 'How many to skip: a previous "next".',
          },
        },
        ['type'],
      ),
    },
    request: (input) =>
      get(`/v1/types/${segment(input, 'type')}/views`, query(input, ['limit', 'offset'])),
  },
  {
    spec: {
      name: 'atlas_list_templates',
      description:
        'The templates and what makes notes from each: { templates: [{ name, path, uses }], ' +
        'typesWithoutTemplate }. A use is a type\'s new notes, "daily", "capture" or "artifact"; ' +
        'none means only the New menu offers it.',
      inputSchema: object({}),
    },
    request: () => get('/v1/templates'),
  },
  {
    spec: {
      name: 'atlas_read_template',
      description:
        'Read one template by name: { template: { name, path, uses, properties, body } } — what ' +
        'a note made from it starts with.',
      inputSchema: object({ name: str("The template's name, from atlas_list_templates.") }, [
        'name',
      ]),
    },
    request: (input) => get(`/v1/templates/${segment(input, 'name')}`),
  },
  {
    spec: {
      name: 'atlas_run_view',
      description:
        'Run a saved view (rows) or dashboard ({ widgets }) by its path from atlas_list_views.',
      inputSchema: object({ path: str("The view's path."), includeArchived: ARCHIVED }, ['path']),
    },
    request: (input) =>
      post(`/v1/views/${segment(input, 'path')}/run`, {
        ...(input['includeArchived'] === true && { includeArchived: true }),
      }),
  },
  {
    spec: {
      name: 'atlas_run_query',
      description:
        'Run an Atlas query, e.g. "FROM task WHERE status != done SORT BY due". Clauses: FROM, WHERE ' +
        '(AND, OR, NOT, = != < > CONTAINS, IS EMPTY), SORT BY, GROUP BY, SHOW, INCLUDE ARCHIVED, LIMIT. ' +
        'Returns { columns, rows, truncated }.',
      inputSchema: object(
        { query: str('The Atlas query text.'), limit: int('At most this many rows.') },
        ['query'],
      ),
    },
    request: (input) =>
      post('/v1/atlas-query', {
        query: input['query'],
        ...(input['limit'] !== undefined && { limit: input['limit'] }),
      }),
  },
  {
    spec: {
      name: 'atlas_calendar',
      description:
        "A view's notes as its calendar shows them for a range: { range, days, events, unscheduled }.",
      inputSchema: object(
        {
          path: str("The view's path."),
          range: { type: 'string', enum: ['month', 'week', '3day', 'day', 'agenda'] },
          anchor: str('A day in the range, YYYY-MM-DD. Omit for today.'),
        },
        ['path'],
      ),
    },
    request: (input) =>
      post(`/v1/views/${segment(input, 'path')}/calendar`, {
        ...(input['range'] !== undefined && { range: input['range'] }),
        ...(input['anchor'] !== undefined && { anchor: input['anchor'] }),
      }),
  },
  {
    spec: {
      name: 'atlas_tags',
      description:
        "Every tag in the vault's notes, nested: { tags: [{ name, count, total, children }] }.",
      inputSchema: object({ sort: { type: 'string', enum: ['name', 'frequency'] } }),
    },
    request: (input) => get('/v1/tags', query(input, ['sort'])),
  },
  {
    spec: {
      name: 'atlas_tagged_notes',
      description:
        'The notes using a tag or one nested under it: { tag, notes: [{ path, title }] }.',
      inputSchema: object(
        { tag: str('The tag, with or without "#".'), limit: int('At most this many.') },
        ['tag'],
      ),
    },
    request: (input) => get(`/v1/tags/${segment(input, 'tag')}/notes`, query(input, ['limit'])),
  },
  {
    spec: {
      name: 'atlas_archived',
      description:
        'List archived notes, newest first. Only when the person asks about the archive.',
      inputSchema: object({
        search: str('Words the title or path must hold.'),
        limit: int('At most this many.'),
      }),
    },
    request: (input) => get('/v1/archive', query(input, ['search', 'limit'])),
  },
];

const BY_NAME = new Map(READ_TOOLS.map((tool) => [tool.spec.name, tool]));

export const READ_TOOL_SPECS: readonly ModelToolSpec[] = READ_TOOLS.map((tool) => tool.spec);

export function isReadTool(name: string): boolean {
  return BY_NAME.has(name);
}

/**
 * Runs a read tool through the router, as the MCP server's call would, and
 * answers with what the model is told. A refusal is a result, not a throw: the
 * model can read it and try again.
 */
export async function runReadTool({
  call,
  api,
  requestId,
}: {
  call: ToolCall;
  api: ApiRouterDeps;
  requestId: string;
}): Promise<ToolResult> {
  const tool = BY_NAME.get(call.name);
  if (tool === undefined) {
    return {
      callId: call.id,
      name: call.name,
      content: `There is no tool "${call.name}".`,
      isError: true,
    };
  }
  let request: Call;
  try {
    request = tool.request(call.input);
  } catch (error) {
    if (!(error instanceof InvalidToolInput)) throw error;
    return {
      callId: call.id,
      name: call.name,
      content: `invalid: ${error.message}`,
      isError: true,
    };
  }
  const response = await routeApiRequest({ id: requestId, ...request }, api);
  const failed = response.status >= 400;
  const content = failed
    ? capped(errorText(response.body))
    : cappedJson(response.body, TOOL_RESULT_CHARACTERS);
  return { callId: call.id, name: call.name, content, isError: failed };
}

function errorText(body: unknown): string {
  const error = (body as { error?: { code?: string; message?: string } }).error;
  return error === undefined
    ? 'The tool failed.'
    : `${error.code ?? 'error'}: ${error.message ?? ''}`;
}

/** An error's words, cut like any other answer; they are prose, so a cut cannot break them. */
function capped(text: string): string {
  return text.length > TOOL_RESULT_CHARACTERS
    ? `${text.slice(0, TOOL_RESULT_CHARACTERS)}… (cut: ask for fewer results)`
    : text;
}
