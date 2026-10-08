/**
 * End to end over MCP: the SDK's own client talks to the server through an
 * in-memory transport, and the server talks HTTP to a fake Atlas. Each test
 * checks the exact REST request a tool call became.
 */

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { AtlasClient, NOT_RUNNING } from './client.ts';
import type { Connection } from './connection.ts';
import { createAtlasServer } from './server.ts';
import { closedPort, errorBody, startFakeAtlas, type FakeAtlas } from './testing/fake-atlas.ts';

const TOKEN = 'e2e-token';
const NOTE = {
  path: 'Tasks/Call Sam.md',
  title: 'Call Sam',
  type: 'task',
  modified: 42,
  properties: {},
  body: 'hi',
};
const ROWS = { columns: ['title'], rows: [['Call Sam']], truncated: false, sql: 'SELECT 1' };

const ALL_TOOLS = [
  'atlas_accept_proposal',
  'atlas_add_image',
  'atlas_add_to_view',
  'atlas_append_to_note',
  'atlas_archive',
  'atlas_archived',
  'atlas_automation_dry_run',
  'atlas_automation_log',
  'atlas_automations',
  'atlas_backlinks',
  'atlas_calendar',
  'atlas_capture_task',
  'atlas_create_note',
  'atlas_daily_note',
  'atlas_list_notes',
  'atlas_list_templates',
  'atlas_list_type_views',
  'atlas_list_types',
  'atlas_list_views',
  'atlas_move_card',
  'atlas_profile',
  'atlas_proposals',
  'atlas_query',
  'atlas_quick_add',
  'atlas_quick_add_types',
  'atlas_read_note',
  'atlas_read_template',
  'atlas_refresh_source',
  'atlas_reject_proposal',
  'atlas_rename_tag',
  'atlas_replace_note_body',
  'atlas_run_query',
  'atlas_run_view',
  'atlas_save_artifact',
  'atlas_search',
  'atlas_sql',
  'atlas_status',
  'atlas_tagged_notes',
  'atlas_tags',
  'atlas_unarchive',
  'atlas_update_properties',
];

let atlas: FakeAtlas;
let mcp: Client;

async function connectMcp(connect: () => Promise<Connection>): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createAtlasServer(new AtlasClient({ connect })).connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

beforeEach(async () => {
  atlas = await startFakeAtlas(() => ({ status: 200, body: { note: NOTE } }));
  mcp = await connectMcp(async () => ({ baseUrl: atlas.baseUrl, token: TOKEN }));
});

afterEach(async () => {
  await mcp.close();
  await atlas.close();
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await mcp.callTool({ name, arguments: args });
  const [first] = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: first?.text ?? '' };
}

describe('tools/list', () => {
  it('offers one tool per route, each described', async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    for (const tool of tools) expect(tool.description?.length).toBeGreaterThan(40);
  });

  it('points a virtual tab at tools that exist and can read its notes', async () => {
    const { tools } = await mcp.listTools();
    const names = new Set(tools.map((t) => t.name));
    const description = tools.find((t) => t.name === 'atlas_list_type_views')?.description ?? '';

    expect(description).toMatch(/atlas_run_view cannot run it/);
    expect(description).toMatch(/atlas_run_query "FROM <type>"/);
    for (const named of description.match(/atlas_[a-z_]+/g) ?? []) expect(names).toContain(named);
  });

  it('marks reads read-only and destructive writes destructive', async () => {
    const { tools } = await mcp.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    expect(byName.get('atlas_read_note')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('atlas_sql')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('atlas_replace_note_body')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.get('atlas_tags')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('atlas_tagged_notes')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('atlas_rename_tag')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.get('atlas_capture_task')).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(byName.get('atlas_archived')).toMatchObject({ readOnlyHint: true });
    for (const name of ['atlas_archive', 'atlas_unarchive']) {
      expect(byName.get(name)).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    }
    // Automations are read here and run in the app: not one of their tools writes.
    for (const name of ['atlas_automations', 'atlas_automation_log', 'atlas_automation_dry_run']) {
      expect(byName.get(name)).toMatchObject({ readOnlyHint: true });
    }
    // The name is set in Settings; the API never writes `.atlas`.
    expect(byName.get('atlas_profile')).toMatchObject({ readOnlyHint: true });
    // Answering a proposal moves it into the Archive; a second answer is refused.
    expect(byName.get('atlas_proposals')).toMatchObject({ readOnlyHint: true });
    for (const name of ['atlas_accept_proposal', 'atlas_reject_proposal']) {
      expect(byName.get(name)).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      });
    }
    // Templates are edited in the app; the API never writes `.atlas` (ADR-0016).
    for (const name of ['atlas_list_templates', 'atlas_read_template']) {
      expect(byName.get(name)).toMatchObject({ readOnlyHint: true });
    }
  });

  it('points template callers at tools that exist', async () => {
    const { tools } = await mcp.listTools();
    const names = new Set(tools.map((t) => t.name));
    for (const tool of ['atlas_list_templates', 'atlas_read_template', 'atlas_create_note']) {
      const description = tools.find((t) => t.name === tool)?.description ?? '';
      const named = description.match(/atlas_[a-z_]+/g) ?? [];
      expect(named.length).toBeGreaterThan(0);
      for (const each of named) expect(names).toContain(each);
    }
  });

  it('tells the model what it needs to write SQL and where a captured task lands', async () => {
    const { tools } = await mcp.listTools();
    const described = (name: string) => tools.find((t) => t.name === name)?.description ?? '';

    for (const table of ['files(', 'props(', 'links(', 'fts', 'v_<type>', 'sqlite_master']) {
      expect(described('atlas_sql')).toContain(table);
    }
    expect(described('atlas_capture_task')).toContain('at the vault root');
  });

  it('requires ifModified for replace_note_body and not for append', async () => {
    const { tools } = await mcp.listTools();
    const required = (name: string) =>
      tools.find((t) => t.name === name)?.inputSchema.required ?? [];
    expect(required('atlas_replace_note_body')).toContain('ifModified');
    expect(required('atlas_append_to_note')).not.toContain('ifModified');
  });
});

describe('tools/call → REST', () => {
  it('reads a note: GET with the path as one encoded segment and the bearer token', async () => {
    const result = await call('atlas_read_note', { path: 'Tasks/Call Sam.md' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ note: NOTE });
    expect(atlas.requests).toEqual([
      {
        method: 'GET',
        url: '/v1/notes/Tasks%2FCall%20Sam.md',
        authorization: `Bearer ${TOKEN}`,
        contentType: undefined,
        body: null,
      },
    ]);
  });

  it('updates properties: PATCH with set, and ifModified only when given', async () => {
    await call('atlas_update_properties', {
      path: 'Tasks/Call Sam.md',
      set: { status: 'done', due: null },
      ifModified: 42,
    });
    await call('atlas_update_properties', { path: 'a.md', set: { x: 1 } });
    expect(atlas.requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      {
        method: 'PATCH',
        url: '/v1/notes/Tasks%2FCall%20Sam.md/properties',
        body: { set: { status: 'done', due: null }, ifModified: 42 },
      },
      { method: 'PATCH', url: '/v1/notes/a.md/properties', body: { set: { x: 1 } } },
    ]);
  });

  it.each([
    ['atlas_status', {}, 'GET', '/v1/status', null],
    ['atlas_list_notes', { type: 'task', limit: 5 }, 'GET', '/v1/notes?type=task&limit=5', null],
    ['atlas_search', { q: 'lease sam' }, 'GET', '/v1/search?q=lease+sam', null],
    ['atlas_list_types', {}, 'GET', '/v1/types', null],
    ['atlas_list_views', {}, 'GET', '/v1/views', null],
    ['atlas_list_templates', {}, 'GET', '/v1/templates', null],
    ['atlas_read_template', { name: 'Reading list' }, 'GET', '/v1/templates/Reading%20list', null],
    ['atlas_read_template', { name: 'A/B' }, 'GET', '/v1/templates/A%2FB', null],
    [
      'atlas_list_type_views',
      { type: 'reading list' },
      'GET',
      '/v1/types/reading%20list/views',
      null,
    ],
    [
      'atlas_list_type_views',
      { type: 'task', limit: 50, offset: 100 },
      'GET',
      '/v1/types/task/views?limit=50&offset=100',
      null,
    ],
    ['atlas_backlinks', { path: 'P/Q.md' }, 'GET', '/v1/notes/P%2FQ.md/backlinks', null],
    [
      'atlas_create_note',
      { folder: 'Tasks', name: 'Call Sam', template: 'Task', properties: { status: 'todo' } },
      'POST',
      '/v1/notes',
      { folder: 'Tasks', name: 'Call Sam', template: 'Task', properties: { status: 'todo' } },
    ],
    [
      'atlas_append_to_note',
      { path: 'Daily/2026-09-22.md', markdown: '- met Sam' },
      'POST',
      '/v1/notes/Daily%2F2026-09-22.md/append',
      { markdown: '- met Sam' },
    ],
    [
      'atlas_replace_note_body',
      { path: 'A/B.md', markdown: 'new', ifModified: 7 },
      'PUT',
      '/v1/notes/A%2FB.md/body',
      { markdown: 'new', ifModified: 7 },
    ],
    [
      'atlas_run_view',
      { path: '.atlas/views/Board.md' },
      'POST',
      '/v1/views/.atlas%2Fviews%2FBoard.md/run',
      null,
    ],
    [
      'atlas_query',
      {
        type: 'task',
        filters: [
          { key: 'status', operator: 'isNot', value: 'done' },
          { key: 'due', operator: 'isEmpty' },
        ],
        sorts: [{ key: 'due', direction: 'asc' }],
      },
      'POST',
      '/v1/query',
      {
        type: 'task',
        filters: [
          { key: 'status', operator: 'isNot', value: 'done' },
          { key: 'due', operator: 'isEmpty' },
        ],
        sorts: [{ key: 'due', direction: 'asc' }],
      },
    ],
    [
      'atlas_sql',
      { sql: 'SELECT title FROM notes WHERE type = ?', params: ['task'] },
      'POST',
      '/v1/sql',
      { sql: 'SELECT title FROM notes WHERE type = ?', params: ['task'] },
    ],
    ['atlas_daily_note', {}, 'POST', '/v1/daily', null],
    ['atlas_capture_task', { text: 'Call Sam' }, 'POST', '/v1/capture', { text: 'Call Sam' }],
    ['atlas_quick_add_types', {}, 'GET', '/v1/quick-add', null],
    ['atlas_profile', {}, 'GET', '/v1/profile', null],
    [
      'atlas_quick_add',
      { type: 'task', name: 'Call Sam', values: { status: 'doing' } },
      'POST',
      '/v1/quick-add',
      { type: 'task', name: 'Call Sam', values: { status: 'doing' } },
    ],
    [
      'atlas_calendar',
      { path: '.atlas/views/Plan.md', range: 'agenda', anchor: '2026-09-22', days: 14 },
      'POST',
      '/v1/views/.atlas%2Fviews%2FPlan.md/calendar',
      { range: 'agenda', anchor: '2026-09-22', days: 14 },
    ],
    [
      'atlas_calendar',
      { path: '.atlas/views/Plan.md' },
      'POST',
      '/v1/views/.atlas%2Fviews%2FPlan.md/calendar',
      {},
    ],
    [
      'atlas_move_card',
      { path: '.atlas/views/Board.md', note: 'Tasks/Call.md', group: 'done', subGroup: null },
      'POST',
      '/v1/views/.atlas%2Fviews%2FBoard.md/move',
      { note: 'Tasks/Call.md', group: 'done', subGroup: null },
    ],
    [
      'atlas_add_to_view',
      { path: '.atlas/views/Board.md', group: '3', name: 'Plan' },
      'POST',
      '/v1/views/.atlas%2Fviews%2FBoard.md/notes',
      { group: '3', name: 'Plan' },
    ],
    [
      'atlas_refresh_source',
      { path: 'Sources/Issues.md' },
      'POST',
      '/v1/sources/Sources%2FIssues.md/refresh',
      null,
    ],
    ['atlas_tags', {}, 'GET', '/v1/tags', null],
    ['atlas_tags', { sort: 'frequency' }, 'GET', '/v1/tags?sort=frequency', null],
    [
      'atlas_tagged_notes',
      { tag: 'para/resource', limit: 5, cursor: 'abc' },
      'GET',
      '/v1/tags/para%2Fresource/notes?limit=5&cursor=abc',
      null,
    ],
    ['atlas_tagged_notes', { tag: '#idea' }, 'GET', '/v1/tags/%23idea/notes', null],
    [
      'atlas_rename_tag',
      { tag: 'idea', to: 'concept', dryRun: true },
      'POST',
      '/v1/tags/idea/rename',
      { to: 'concept', dryRun: true },
    ],
    [
      'atlas_rename_tag',
      { tag: 'para/x', to: 'area', merge: true, dryRun: false },
      'POST',
      '/v1/tags/para%2Fx/rename',
      { to: 'area', merge: true, dryRun: false },
    ],
    [
      'atlas_rename_tag',
      { tag: 'idea', to: 'concept' },
      'POST',
      '/v1/tags/idea/rename',
      { to: 'concept', dryRun: true },
    ],
    [
      'atlas_archive',
      { paths: ['Projects/Lease.md', 'Call.md'] },
      'POST',
      '/v1/archive',
      { paths: ['Projects/Lease.md', 'Call.md'] },
    ],
    [
      'atlas_unarchive',
      { paths: ['Archive/Call.md'] },
      'POST',
      '/v1/unarchive',
      { paths: ['Archive/Call.md'] },
    ],
    ['atlas_archived', {}, 'GET', '/v1/archive', null],
    ['atlas_automations', {}, 'GET', '/v1/automations', null],
    ['atlas_automation_log', { id: 'tidy' }, 'GET', '/v1/automations/tidy/log', null],
    [
      'atlas_automation_log',
      { id: 'Tidy done/tasks', limit: 5 },
      'GET',
      '/v1/automations/Tidy%20done%2Ftasks/log?limit=5',
      null,
    ],
    ['atlas_automation_dry_run', { id: 'tidy' }, 'POST', '/v1/automations/tidy/dry-run', null],
    ['atlas_proposals', {}, 'GET', '/v1/proposals', null],
    [
      'atlas_accept_proposal',
      { path: 'Inbox/Proposals/Send the file.md' },
      'POST',
      '/v1/proposals/Inbox%2FProposals%2FSend%20the%20file.md/accept',
      null,
    ],
    [
      'atlas_reject_proposal',
      { path: 'Inbox/Proposals/Send the file.md' },
      'POST',
      '/v1/proposals/Inbox%2FProposals%2FSend%20the%20file.md/reject',
      null,
    ],
    [
      'atlas_archived',
      { search: 'lease', limit: 10, offset: 20 },
      'GET',
      '/v1/archive?search=lease&limit=10&offset=20',
      null,
    ],
    [
      'atlas_search',
      { q: 'lease', includeArchived: true },
      'GET',
      '/v1/search?q=lease&includeArchived=true',
      null,
    ],
    [
      'atlas_run_view',
      { path: '.atlas/views/Board.md', includeArchived: true },
      'POST',
      '/v1/views/.atlas%2Fviews%2FBoard.md/run',
      { includeArchived: true },
    ],
    [
      'atlas_query',
      { type: 'task', includeArchived: true },
      'POST',
      '/v1/query',
      { type: 'task', includeArchived: true },
    ],
  ])('%s → %s %s', async (tool, args, method, url, body) => {
    const result = await call(tool, args);
    expect(result.isError).toBe(false);
    expect(atlas.requests).toEqual([
      expect.objectContaining({ method, url, body, authorization: `Bearer ${TOKEN}` }),
    ]);
  });

  it('returns what a batch did, failures and all, as its answer rather than an error', async () => {
    const outcome = {
      moves: [{ from: 'Call.md', to: 'Archive/Call.md' }],
      failed: [
        { path: '.atlas/types/Task.md', reason: 'Atlas keeps its own files where they are.' },
      ],
      linksUpdated: 2,
    };
    atlas.respondWith(() => ({ status: 200, body: outcome }));

    const result = await call('atlas_archive', { paths: ['Call.md', '.atlas/types/Task.md'] });

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual(outcome);
  });

  it('returns the answer as JSON text', async () => {
    atlas.respondWith(() => ({ status: 200, body: ROWS }));
    expect(JSON.parse((await call('atlas_sql', { sql: 'SELECT 1' })).text)).toEqual(ROWS);
  });

  it('refuses a replace without ifModified before any request is made', async () => {
    const result = await call('atlas_replace_note_body', { path: 'a.md', markdown: 'x' });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/ifModified/);
    expect(atlas.requests).toEqual([]);
  });

  it.each([
    ['atlas_calendar', { path: 'v.md', range: 'year' }],
    ['atlas_calendar', { path: 'v.md', range: 'agenda', days: 367 }],
    ['atlas_quick_add', { type: 'task', name: 'x', values: { estimate: 3 } }],
    ['atlas_quick_add', { type: 'task' }],
    ['atlas_refresh_source', {}],
    ['atlas_tags', { sort: 'size' }],
    ['atlas_tagged_notes', {}],
    ['atlas_rename_tag', { tag: 'idea' }],
    ['atlas_rename_tag', { tag: 'idea', to: '' }],
    ['atlas_rename_tag', { tag: 'idea', to: 'x', dryRun: 'yes' }],
    ['atlas_read_note', { path: '..' }],
    ['atlas_backlinks', { path: '.' }],
    ['atlas_update_properties', { path: '..', set: { x: 1 } }],
    ['atlas_append_to_note', { path: '..', markdown: 'x' }],
    ['atlas_replace_note_body', { path: '..', markdown: 'x', ifModified: 1 }],
    ['atlas_run_view', { path: '..' }],
    ['atlas_calendar', { path: '.' }],
    ['atlas_refresh_source', { path: '..' }],
    ['atlas_archive', { paths: [] }],
    ['atlas_archive', { paths: Array.from({ length: 101 }, (_, at) => `N${at}.md`) }],
    ['atlas_unarchive', { paths: [''] }],
    ['atlas_archived', { offset: -1 }],
    ['atlas_list_type_views', { type: '' }],
    ['atlas_read_template', {}],
    ['atlas_read_template', { name: '' }],
    ['atlas_list_type_views', { type: 'task', limit: 0 }],
    ['atlas_list_type_views', { type: 'task', limit: 501 }],
    ['atlas_list_type_views', { type: 'task', offset: -1 }],
    ['atlas_archived', { limit: 501 }],
    ['atlas_automation_log', {}],
    ['atlas_automation_log', { id: '' }],
    ['atlas_automation_log', { id: 'tidy', limit: 101 }],
    ['atlas_automation_log', { id: '..' }],
    ['atlas_automation_dry_run', {}],
    ['atlas_automation_dry_run', { id: '.' }],
    ['atlas_search', { q: 'x', includeArchived: 'yes' }],
    ['atlas_run_query', {}],
    ['atlas_run_query', { query: '' }],
    ['atlas_run_query', { query: 'FROM task', limit: 0 }],
    ['atlas_run_query', { query: 'FROM task', limit: 5001 }],
    ['atlas_run_query', { query: 'FROM task', limit: 2.5 }],
  ])('refuses %s with %j before any request is made', async (tool, args) => {
    const result = await call(tool, args);
    expect(result.isError).toBe(true);
    expect(atlas.requests).toEqual([]);
  });

  it('refuses an unknown filter operator before any request is made', async () => {
    const result = await call('atlas_query', {
      type: 'task',
      filters: [{ key: 'status', operator: 'like', value: 'x' }],
    });
    expect(result.isError).toBe(true);
    expect(atlas.requests).toEqual([]);
  });
});

describe('atlas_run_query', () => {
  it('posts the query, and the limit only when given, to /v1/atlas-query', async () => {
    atlas.respondWith(() => ({ status: 200, body: ROWS }));
    await call('atlas_run_query', { query: 'FROM task GROUP BY status' });
    await call('atlas_run_query', { query: 'FROM task', limit: 5000 });

    expect(atlas.requests).toEqual([
      expect.objectContaining({
        method: 'POST',
        url: '/v1/atlas-query',
        body: { query: 'FROM task GROUP BY status' },
      }),
      expect.objectContaining({ body: { query: 'FROM task', limit: 5000 } }),
    ]);
  });

  it('returns the rows and groups as JSON text', async () => {
    const answer = {
      ...ROWS,
      groups: [{ label: 'open', value: 'open', rows: [0], groups: [] }],
    };
    atlas.respondWith(() => ({ status: 200, body: answer }));
    const result = await call('atlas_run_query', { query: 'FROM task GROUP BY status' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual(answer);
  });

  it('passes a mistake in the text on with where it is', async () => {
    atlas.respondWith(() => ({
      status: 400,
      body: errorBody('invalid', 'Line 2, column 7: A task has no field called stauts.'),
    }));
    const result = await call('atlas_run_query', { query: 'FROM task\nWHERE stauts = x' });
    expect(result).toEqual({
      isError: true,
      text: 'invalid: Line 2, column 7: A task has no field called stauts.',
    });
  });
});

describe('tools/call errors', () => {
  it('turns an API error body into an isError result with code: message', async () => {
    atlas.respondWith(() => ({
      status: 409,
      body: errorBody('conflict', 'Tasks/Call Sam.md changed since you read it'),
    }));
    const result = await call('atlas_replace_note_body', {
      path: 'Tasks/Call Sam.md',
      markdown: 'x',
      ifModified: 1,
    });
    expect(result).toEqual({
      isError: true,
      text: 'conflict: Tasks/Call Sam.md changed since you read it',
    });
  });

  it.each([
    ['atlas_automation_log', 404, 'not_found', 'No automation has id "gone"'],
    ['atlas_automation_dry_run', 400, 'invalid', 'The automation “Broken” cannot be read'],
  ])('passes %s a %i refusal on as the tool error', async (tool, status, code, message) => {
    atlas.respondWith(() => ({ status, body: errorBody(code, message) }));

    const result = await call(tool, { id: 'gone' });

    expect(result).toEqual({ isError: true, text: `${code}: ${message}` });
  });

  it('says Atlas is not running when nothing listens, with no stack trace', async () => {
    const port = await closedPort();
    const closed = await connectMcp(async () => ({
      baseUrl: `http://127.0.0.1:${port}`,
      token: TOKEN,
    }));
    const result = await closed.callTool({ name: 'atlas_status', arguments: {} });
    await closed.close();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: NOT_RUNNING }]);
  });

  it('reports an unexpected failure by message only', async () => {
    const broken = await connectMcp(async () => {
      throw new RangeError('something odd');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await broken.callTool({ name: 'atlas_status', arguments: {} });
    await broken.close();
    expect(result.content).toEqual([
      { type: 'text', text: 'Atlas MCP server error: something odd' },
    ]);
    expect(result.isError).toBe(true);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
