/**
 * Adversarial: POST /v1/atlas-query and the views route that now shares its
 * error handling, attacked as a token holder or a prompt-injected MCP client
 * would. The API reaches user space only (paths.ts): notes in `.atlas` and in
 * hidden folders are never read, and no answer carries a path on this machine.
 */

import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf, encoded, OTHER_VAULT } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';

const TYPES: Record<string, string> = {
  '.atlas/types/task.md': jsonNote({
    name: 'task',
    label: 'Task',
    properties: {
      status: { kind: 'select', options: ['todo', 'doing', 'done'] },
      project: { kind: 'relation', target: 'project' },
    },
  }),
  '.atlas/types/project.md': jsonNote({
    name: 'project',
    label: 'Project',
    properties: { secret: 'text' },
  }),
};

const FILES: Record<string, string> = {
  ...TYPES,
  // Notes the API may not read: Atlas's own, and another tool's hidden folder.
  '.atlas/templates/Project.md': jsonNote({ type: 'project', secret: 'atlas-secret' }),
  '.trash/0.md': jsonNote({ type: 'task', status: 'todo' }),
  '.trash/1.md': jsonNote({ type: 'task', status: 'todo' }),
  '.trash/Hidden.md': jsonNote({ type: 'project', secret: 'trash-secret' }),
  // User-space notes that link into them.
  'tasks/A.md': jsonNote({ type: 'task', status: 'doing', project: '[[.trash/Hidden]]' }),
  'tasks/B.md': jsonNote({ type: 'task', status: 'todo', project: '[[.atlas/templates/Project]]' }),
  'tasks/C.md': jsonNote({ type: 'task', status: 'todo' }),
  '.atlas/views/Tasks.md': jsonNote({ atlas: 'view', layout: 'table', query: 'FROM task' }),
  '.atlas/views/First.md': jsonNote({
    atlas: 'view',
    layout: 'table',
    query: 'FROM task SORT BY title LIMIT 1',
  }),
};

type Api = ReturnType<typeof apiFixture>;

function vault(files: Record<string, string> = FILES): Api {
  const markdown = jsonMarkdown();
  return apiFixture({ files, markdown, index: { query: atlasQueryIndex({ files, markdown }) } });
}

/** A vault whose index fails every query with this message. */
function failingVault(message: string, files: Record<string, string> = FILES): Api {
  return apiFixture({
    files,
    markdown: jsonMarkdown(),
    index: {
      query: async () => {
        throw new Error(message);
      },
    },
  });
}

/** Switches the open vault while the index is being read, as a user can mid-request. */
function switchingWhileReading(api: Api, { fail }: { fail: boolean }): Api {
  const query = api.deps.index.query;
  api.deps = {
    ...api.deps,
    index: {
      ...api.deps.index,
      query: async (sql, parameters) => {
        api.open = OTHER_VAULT;
        if (fail) throw new Error('no such table: files');
        return query(sql, parameters);
      },
    },
  };
  return api;
}

const ask = (api: Api, body: unknown) =>
  api.send({ method: 'POST', path: '/v1/atlas-query', body });
const runView = (api: Api, path: string) =>
  api.send({ method: 'POST', path: `/v1/views/${encoded(path)}/run` });

interface Rows {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

const rowsOf = (response: { body: unknown }) => bodyOf(response as never) as unknown as Rows;
const column = ({ columns, rows }: Rows, name: string) =>
  rows.map((row) => row[columns.indexOf(name)]);
const messageOf = (response: { body: unknown }) =>
  (response.body as { error: { message: string } }).error.message;

describe('POST /v1/atlas-query: notes the API may not read (adversarial)', () => {
  it('never reads a property of a hidden-folder note through a relation hop', async () => {
    // Why: rowsWithin drops rows whose own path is hidden, but a user-space note
    // whose relation points into `.trash` hands its values back one hop away.
    const response = await ask(vault(), { query: 'FROM task SORT BY title SHOW project.secret' });
    expect(column(rowsOf(response), 'project.secret')).not.toContain('trash-secret');
  });

  it('never reads a property of a note in .atlas through a relation hop', async () => {
    // Why: the compiled SQL keeps `.atlas` out of `n.path` only; the hop's join
    // on `h.dst` reads `.atlas/templates/…` like any other note.
    const response = await ask(vault(), { query: 'FROM task SORT BY title SHOW project.secret' });
    expect(column(rowsOf(response), 'project.secret')).not.toContain('atlas-secret');
  });

  it('cannot use WHERE on a hop as an oracle for a hidden note’s values', async () => {
    const response = await ask(vault(), {
      query: 'FROM task WHERE project.secret = "trash-secret"',
    });
    expect(rowsOf(response).rows).toEqual([]);
  });

  it('fills the page to its limit when enough readable notes match', async () => {
    // Why: one row past the limit is fetched and hidden rows are dropped after
    // the fact, so two `.trash` notes sorting first leave one row of two.
    // docs/api/v1.md: "a page is filled to its `limit` when enough notes match".
    const response = await ask(vault(), { query: 'FROM task SORT BY title', limit: 2 });
    expect(column(rowsOf(response), 'title')).toEqual(['A', 'B']);
  });
});

describe('POST /v1/atlas-query: the vault it names (adversarial)', () => {
  it('answers no_vault, not query_failed, when the index fails after a switch', async () => {
    // Why: answerAtlasQuery turns every index failure into ApiError('query_failed'),
    // and the router only checks the vault for errors that are not ApiErrors.
    const api = switchingWhileReading(vault(), { fail: true });
    expect(codeOf(await ask(api, { query: 'FROM task' }))).toBe('no_vault');
  });
});

describe('POST /v1/atlas-query: error bodies (adversarial)', () => {
  it('leaves no part of a path with a space in it in a query_failed message', async () => {
    // Why: messageWithoutPaths stops a path at the first space, so a vault in
    // "My Vault" (or iCloud's "Mobile Documents") leaks everything after it.
    const api = failingVault('unable to open /Users/j/My Vault/.atlas-cache/index.sqlite');
    const response = await ask(api, { query: 'FROM task' });

    expect(codeOf(response)).toBe('query_failed');
    expect(messageOf(response)).not.toContain('.atlas-cache');
  });
});

describe('POST /v1/views/{path}/run with an Atlas query view (adversarial)', () => {
  it('lists no note from a hidden folder, as /v1/atlas-query does not', async () => {
    // Why: runQueryView returns answer.result as it came from the index; only
    // the atlas-query route drops rows the API may not read.
    const response = await runView(vault(), '.atlas/views/Tasks.md');
    const paths = column(rowsOf(response), 'path') as string[];
    expect(paths.filter((path) => path.startsWith('.'))).toEqual([]);
  });

  it('answers no_vault when the vault is switched while the index is read', async () => {
    // Why: the query view path never calls assertStillOpen, so the old vault's
    // rows are answered 200 after the switch.
    const api = switchingWhileReading(vault(), { fail: false });
    expect(codeOf(await runView(api, '.atlas/views/Tasks.md'))).toBe('no_vault');
  });

  it('says more matched when the view’s own LIMIT cut the rows short', async () => {
    // docs/api/v1.md: "for a query or a view, its limit ... cut it short".
    const response = await runView(vault(), '.atlas/views/First.md');
    const rows = rowsOf(response);
    expect(rows.rows).toHaveLength(1);
    expect(rows.truncated).toBe(true);
  });
});

describe('POST /v1/views/{path}/run with a dashboard (adversarial)', () => {
  const DASHBOARD = {
    ...TYPES,
    '.atlas/dashboards/Home.md': jsonNote({
      atlas: 'dashboard',
      widgets: [
        { kind: 'number', type: 'task', title: 'Open' },
        { kind: 'query', title: 'Tasks', query: 'FROM task' },
      ],
    }),
  };

  it('puts no path on this machine in a failed widget’s message', async () => {
    // Why: runWidget hands a failed type-widget's index error back verbatim;
    // only the SQL and Atlas-query widgets pass it through messageWithoutPaths.
    const api = failingVault('unable to open /Users/j/Vault/.atlas-cache/index.sqlite', DASHBOARD);
    const response = await runView(api, '.atlas/dashboards/Home.md');
    expect(response.status).toBe(200);
    expect(JSON.stringify(bodyOf(response))).not.toContain('/Users/');
  });

  it('lists no note from a hidden folder in a query widget', async () => {
    const files = { ...FILES, ...DASHBOARD };
    const response = await runView(vault(files), '.atlas/dashboards/Home.md');
    const widgets = bodyOf(response)['widgets'] as { data: { rows?: { path: string }[] } }[];
    const paths = (widgets[1]?.data.rows ?? []).map((row) => row.path);
    expect(paths).toContain('tasks/A.md');
    expect(paths.filter((path) => path.startsWith('.'))).toEqual([]);
  });

  it('answers no_vault when the vault is switched while its widgets run', async () => {
    const api = switchingWhileReading(vault({ ...FILES, ...DASHBOARD }), { fail: false });
    expect(codeOf(await runView(api, '.atlas/dashboards/Home.md'))).toBe('no_vault');
  });
});
