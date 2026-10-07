/**
 * The read-only routes that ask the index or the vault's configuration:
 * search, types, views, queries and SQL.
 */

import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '@atlas/domain';
import { apiFixture, bodyOf, codeOf, encoded } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const EMPTY_ROWS = { columns: [], rows: [], truncated: false };

const json = jsonNote;

describe('GET /v1/search', () => {
  it('answers the index hits, leaving out notes in .atlas', async () => {
    const searched: [string, number][] = [];
    const api = apiFixture({
      index: {
        search: async (query, limit) => {
          searched.push([query, limit]);
          return [
            { path: 'Call.md', title: 'Call', snippet: '<<lease>> renewal' },
            { path: '.atlas/templates/Task.md', title: 'Task', snippet: '<<lease>>' },
          ];
        },
      },
    });

    const response = await api.send({
      method: 'GET',
      path: '/v1/search',
      query: { q: 'lease', limit: '5' },
    });

    expect(bodyOf(response)).toEqual({
      hits: [{ path: 'Call.md', title: 'Call', snippet: '<<lease>> renewal' }],
    });
    expect(searched).toHaveLength(1);
    expect(searched[0]?.[1]).toBe(5);
  });

  it('still answers the limit when notes in .atlas were among the first hits', async () => {
    const all = [
      { path: '.atlas/types/Task.md', title: 'Task', snippet: 'x' },
      { path: 'A.md', title: 'A', snippet: 'x' },
      { path: '.atlas/templates/Task.md', title: 'Task', snippet: 'x' },
      { path: 'B.md', title: 'B', snippet: 'x' },
      { path: 'C.md', title: 'C', snippet: 'x' },
    ];
    const api = apiFixture({ index: { search: async (_, limit) => all.slice(0, limit) } });

    const response = await api.send({
      method: 'GET',
      path: '/v1/search',
      query: { q: 'x', limit: '2' },
    });

    expect(bodyOf(response)['hits']).toEqual([
      expect.objectContaining({ path: 'A.md' }),
      expect.objectContaining({ path: 'B.md' }),
    ]);
  });

  it('answers what there is when the index has fewer user-space hits than the limit', async () => {
    const all = [
      { path: '.atlas/types/Task.md', title: 'Task', snippet: 'x' },
      { path: 'A.md', title: 'A', snippet: 'x' },
    ];
    const api = apiFixture({ index: { search: async (_, limit) => all.slice(0, limit) } });

    const response = await api.send({
      method: 'GET',
      path: '/v1/search',
      query: { q: 'x', limit: '5' },
    });

    expect(bodyOf(response)['hits']).toEqual([expect.objectContaining({ path: 'A.md' })]);
  });

  it('never repeats the machine’s paths when the index cannot search', async () => {
    const api = apiFixture({
      index: {
        search: async () => {
          throw new Error('unable to open database file: /Users/j/Vault/.atlas-cache/index.db');
        },
      },
    });
    const response = await api.send({ method: 'GET', path: '/v1/search', query: { q: 'x' } });
    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(response.body)).toContain('unable to open database file');
    expect(JSON.stringify(response.body)).not.toContain('/Users/j');
  });

  it('asks for 20 hits when no limit is given', async () => {
    let asked = 0;
    const api = apiFixture({ index: { search: async (_, limit) => ((asked = limit), []) } });
    await api.send({ method: 'GET', path: '/v1/search', query: { q: 'lease' } });
    expect(asked).toBe(20);
  });

  it('matches nothing, without asking the index, when nothing but quotes was typed', async () => {
    let asked = false;
    const api = apiFixture({ index: { search: async () => ((asked = true), []) } });

    const response = await api.send({ method: 'GET', path: '/v1/search', query: { q: '"" "' } });

    expect(bodyOf(response)).toEqual({ hits: [] });
    expect(asked).toBe(false);
  });

  it('is query_failed when the index cannot run the search', async () => {
    const api = apiFixture({
      index: {
        search: async () => {
          throw new Error('fts5: syntax error');
        },
      },
    });
    const response = await api.send({ method: 'GET', path: '/v1/search', query: { q: 'lease' } });
    expect(codeOf(response)).toBe('query_failed');
    expect(response.status).toBe(422);
  });

  it.each([
    ['no q', {}],
    ['an empty q', { q: '  ' }],
    ['a limit over 100', { q: 'x', limit: '101' }],
  ])('refuses %s as invalid', async (_, query) => {
    const response = await apiFixture().send({ method: 'GET', path: '/v1/search', query });
    expect(codeOf(response)).toBe('invalid');
  });
});

describe('GET /v1/types', () => {
  it('answers each type with its properties', async () => {
    const api = apiFixture({
      markdown: jsonMarkdown(),
      files: {
        '.atlas/types/task.md': json({
          name: 'task',
          label: 'Task',
          properties: {
            status: { kind: 'select', options: ['todo', 'done'], required: true },
            project: { kind: 'relation', target: 'project', many: true },
          },
        }),
      },
    });

    const response = await api.send({ method: 'GET', path: '/v1/types' });

    expect(bodyOf(response)).toEqual({
      types: [
        {
          name: 'task',
          label: 'Task',
          properties: [
            expect.objectContaining({
              key: 'status',
              kind: 'select',
              options: ['todo', 'done'],
              required: true,
            }),
            expect.objectContaining({
              key: 'project',
              kind: 'relation',
              target: 'project',
              many: true,
            }),
          ],
        },
      ],
    });
  });
});

describe('GET /v1/types, with a Thumbnail property (U-15)', () => {
  it('reports the kind, so a client knows the value is auto, false, or a chosen picture', async () => {
    const api = apiFixture({
      markdown: jsonMarkdown(),
      files: {
        '.atlas/types/recipe.md': json({
          name: 'recipe',
          properties: { thumbnail: { kind: 'thumbnail' }, cuisine: 'text' },
        }),
      },
    });

    const response = await api.send({ method: 'GET', path: '/v1/types' });

    const [recipe] = bodyOf(response)['types'] as { properties: { key: string; kind: string }[] }[];
    expect(recipe?.properties.map(({ key, kind }) => [key, kind])).toEqual([
      ['thumbnail', 'thumbnail'],
      ['cuisine', 'text'],
    ]);
  });
});

const VIEW = {
  atlas: 'view',
  type: 'task',
  layout: 'board',
  groupBy: 'status',
  filters: [{ key: 'status', operator: 'isNot', value: 'done' }],
};
const DASHBOARD = {
  atlas: 'dashboard',
  widgets: [{ kind: 'number', type: 'task', title: 'Open' }],
};

describe('GET /v1/views', () => {
  it('lists views and dashboards with what each is, and where a view sits among its tabs', async () => {
    const api = apiFixture({
      markdown: jsonMarkdown(),
      files: {
        '.atlas/views/Board.md': json({ ...VIEW, order: 3 }),
        '.atlas/views/Unplaced.md': json({ atlas: 'view', type: 'task', layout: 'list' }),
        '.atlas/dashboards/Home.md': json(DASHBOARD),
      },
    });

    const response = await api.send({ method: 'GET', path: '/v1/views' });

    expect(bodyOf(response)).toEqual({
      views: [
        {
          path: '.atlas/views/Board.md',
          title: 'Board',
          kind: 'view',
          type: 'task',
          layout: 'board',
          groupBy: 'status',
          subGroupBy: null,
          order: 3,
        },
        {
          path: '.atlas/views/Unplaced.md',
          title: 'Unplaced',
          kind: 'view',
          type: 'task',
          layout: 'list',
          groupBy: null,
          subGroupBy: null,
          order: null,
        },
        {
          path: '.atlas/dashboards/Home.md',
          title: 'Home',
          kind: 'dashboard',
          type: null,
          layout: null,
          groupBy: null,
          subGroupBy: null,
          order: null,
        },
      ],
    });
  });
});

describe('GET /v1/views and the views lifted to the top', () => {
  it('lists Today and Inbox too: they are views, and their paths run like any other', async () => {
    const api = apiFixture({
      markdown: jsonMarkdown(),
      files: {
        '.atlas/views/Inbox.md': json({ atlas: 'view', type: 'task', layout: 'list' }),
        '.atlas/views/Board.md': json(VIEW),
      },
    });

    const response = await api.send({ method: 'GET', path: '/v1/views' });
    const views = bodyOf(response)['views'] as { path: string; type: string | null }[];

    expect(views.map(({ path, type }) => [path, type])).toEqual([
      ['.atlas/views/Inbox.md', 'task'],
      ['.atlas/views/Board.md', 'task'],
    ]);
  });
});

describe('POST /v1/views/{path}/run', () => {
  const vault = (index = {}) =>
    apiFixture({
      markdown: jsonMarkdown(),
      index,
      files: {
        '.atlas/views/Board.md': json(VIEW),
        '.atlas/views/Typeless.md': json({ atlas: 'view' }),
        '.atlas/views/Sql.md': json({ atlas: 'view', sql: 'SELECT path, title FROM files' }),
        '.atlas/dashboards/Home.md': json(DASHBOARD),
        'Plain.md': '# Plain\n',
      },
    });
  const run = (api: ReturnType<typeof vault>, path: string) =>
    api.send({ method: 'POST', path: `/v1/views/${encoded(path)}/run` });

  it.each([
    ['in another case', '.atlas/views/board.md'],
    ['with its folder in another case', '.atlas/Views/BOARD.md'],
  ])('runs a view named %s, as the vault spells it', async (_, asked) => {
    const api = vault({
      query: async () => ({ columns: ['path'], rows: [['Call.md']], truncated: false }),
    });

    const response = await run(api, asked);

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toMatchObject({ rows: [['Call.md']] });
  });

  it("answers a view's rows and the SQL that found them", async () => {
    const asked: unknown[][] = [];
    const api = vault({
      query: async (_: string, parameters: readonly unknown[]) => {
        asked.push([...parameters]);
        return { columns: ['path', 'title'], rows: [['Call.md', 'Call']], truncated: false };
      },
    });

    const response = await run(api, '.atlas/views/Board.md');

    expect(bodyOf(response)).toMatchObject({
      columns: ['path', 'title'],
      rows: [['Call.md', 'Call']],
      truncated: false,
      sql: expect.stringContaining('FROM'),
    });
    expect(asked[0]).toContain('done');
  });

  it("leaves Atlas's own notes in .atlas out of a view's rows", async () => {
    const api = vault({
      query: async () => ({
        columns: ['path', 'title'],
        rows: [
          ['.atlas/templates/Task.md', 'Task'],
          ['Call.md', 'Call'],
        ],
        truncated: false,
      }),
    });

    const response = await run(api, '.atlas/views/Board.md');

    expect(bodyOf(response)['rows']).toEqual([['Call.md', 'Call']]);
  });

  it("answers a dashboard's widgets", async () => {
    const api = vault({
      query: async () => ({ columns: ['value'], rows: [[3]], truncated: false }),
    });

    const response = await run(api, '.atlas/dashboards/Home.md');

    expect(bodyOf(response)['widgets']).toEqual([
      expect.objectContaining({ data: { shape: 'number', value: '3' } }),
    ]);
  });

  it('runs a SQL view read-only and answers its rows with the SQL', async () => {
    const asked: string[] = [];
    const api = vault({
      query: async (sql: string) => {
        asked.push(sql);
        return { columns: ['path', 'title'], rows: [['Call.md', 'Call']], truncated: false };
      },
    });

    const response = await run(api, '.atlas/views/Sql.md');

    expect(bodyOf(response)).toMatchObject({
      rows: [['Call.md', 'Call']],
      sql: 'SELECT path, title FROM files',
    });
    expect(asked).toEqual(['SELECT path, title FROM files']);
  });

  it('answers a SQL view the index cannot run as query_failed, without its paths', async () => {
    const api = vault({
      query: async () => {
        throw new Error('no such table at /Users/j/Vault/.atlas-cache/index.db');
      },
    });

    const response = await run(api, '.atlas/views/Sql.md');

    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(response.body)).not.toContain('/Users/j');
  });

  it('is not_found for a note that is neither a view nor a dashboard', async () => {
    expect(codeOf(await run(vault(), 'Plain.md'))).toBe('not_found');
  });

  it('is not_found for a view that does not exist', async () => {
    expect(codeOf(await run(vault(), '.atlas/views/Gone.md'))).toBe('not_found');
  });

  it('is invalid for a view that does not say which type it lists', async () => {
    expect(codeOf(await run(vault(), '.atlas/views/Typeless.md'))).toBe('invalid');
  });

  it('is query_failed when the index cannot run the view', async () => {
    const api = vault({
      query: async () => {
        throw new Error('no such table: v_task');
      },
    });
    const response = await run(api, '.atlas/views/Board.md');
    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(response.body)).toContain('no such table');
  });
});

describe('POST /v1/query', () => {
  const query = (body: unknown, index = {}) =>
    apiFixture({ index }).send({ method: 'POST', path: '/v1/query', body });

  it('compiles the query as a saved view would and answers its rows', async () => {
    let ran = '';
    const response = await query(
      {
        type: 'task',
        columns: ['status'],
        filters: [
          { key: 'status', operator: 'is', value: 'todo' },
          { key: 'due', operator: 'isNotEmpty' },
        ],
        sorts: [{ key: 'due', direction: 'desc' }],
        limit: 10,
      },
      {
        query: async (sql: string) => {
          ran = sql;
          return { columns: ['path'], rows: [], truncated: true };
        },
      },
    );

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({ columns: ['path'], rows: [], truncated: true, sql: ran });
    expect(ran).toContain('ORDER BY');
  });

  it('is invalid when the compiler refuses a key it cannot name', async () => {
    const response = await query({ type: 'task', columns: ['bad"key'] });
    expect(codeOf(response)).toBe('invalid');
  });

  it('is query_failed when the index cannot run it', async () => {
    const response = await query(
      { type: 'nosuchtype' },
      {
        query: async () => {
          throw new Error('no such table: v_nosuchtype');
        },
      },
    );
    expect(codeOf(response)).toBe('query_failed');
  });

  it("leaves Atlas's own notes in .atlas out of the rows", async () => {
    const response = await query(
      { type: 'task' },
      {
        query: async () => ({
          columns: ['path', 'title'],
          rows: [
            ['A.md', 'A'],
            ['.ATLAS/templates/Task.md', 'Task'],
            ['.atlas/templates/Task.md', 'Task'],
          ],
          truncated: false,
        }),
      },
    );
    expect(bodyOf(response)['rows']).toEqual([['A.md', 'A']]);
  });

  describe('with notes in .atlas among the matching rows', () => {
    // An index that honours the query's LIMIT, the last parameter, over rows
    // in path order, as SQLite would.
    const MATCHING = ['.atlas/templates/Task.md', 'A.md', 'B.md', 'C.md'];
    const limited = {
      query: async (_: string, parameters: readonly unknown[]) => ({
        columns: ['path'],
        rows: MATCHING.slice(0, Number(parameters.at(-1))).map((path) => [path]),
        truncated: false,
      }),
    };

    it('fills the limit with user notes and says more match', async () => {
      const response = await query({ type: 'task', limit: 2 }, limited);
      expect(bodyOf(response)).toMatchObject({ rows: [['A.md'], ['B.md']], truncated: true });
    });

    it('fills the page when more notes in .atlas than the page holds come first', async () => {
      const crowded = {
        query: async (_: string, parameters: readonly unknown[]) => ({
          columns: ['path'],
          rows: ['.atlas/templates/A.md', '.atlas/templates/B.md', '.atlas/types/C.md', 'D.md']
            .slice(0, Number(parameters.at(-1)))
            .map((path) => [path]),
          truncated: false,
        }),
      };
      const response = await query({ type: 'task', limit: 1 }, crowded);
      expect(bodyOf(response)).toMatchObject({ rows: [['D.md']], truncated: false });
    });

    it('says nothing more matches when every matching row was seen', async () => {
      const response = await query({ type: 'task', limit: 4 }, limited);
      expect(bodyOf(response)).toMatchObject({
        rows: [['A.md'], ['B.md'], ['C.md']],
        truncated: false,
      });
    });
  });

  it('never repeats the machine’s paths when the index cannot run it', async () => {
    const response = await query(
      { type: 'task' },
      {
        query: async () => {
          throw new Error("cannot open the index for reading: 'C:\\Users\\j\\index.db' is locked");
        },
      },
    );
    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(response.body)).toContain('is locked');
    expect(JSON.stringify(response.body)).not.toContain('Users');
  });

  it.each([
    ['a body that is not an object', [], 'body'],
    ['no type', {}, 'type'],
    ['columns that are not an array', { type: 't', columns: 'status' }, 'columns'],
    ['an empty column', { type: 't', columns: [''] }, 'columns[0]'],
    ['a filter that is not an object', { type: 't', filters: ['x'] }, 'filters[0]'],
    ['a filter with no key', { type: 't', filters: [{ operator: 'is' }] }, 'filters[0].key'],
    [
      'an unknown operator',
      { type: 't', filters: [{ key: 'a', operator: 'like' }] },
      'filters[0].operator',
    ],
    [
      'a filter value that is an object',
      { type: 't', filters: [{ key: 'a', operator: 'is', value: {} }] },
      'filters[0].value',
    ],
    ['a sort that is not an object', { type: 't', sorts: [1] }, 'sorts[0]'],
    [
      'a sort in no direction',
      { type: 't', sorts: [{ key: 'a', direction: 'up' }] },
      'sorts[0].direction',
    ],
    ['a limit of zero', { type: 't', limit: 0 }, 'limit'],
    ['a limit over the ceiling', { type: 't', limit: 5001 }, 'limit'],
  ])('refuses %s as invalid, naming the field', async (_, body, field) => {
    const response = await query(body);
    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain(field);
  });
});

describe('POST /v1/sql', () => {
  const sql = (body: unknown, index = {}) =>
    apiFixture({ index }).send({ method: 'POST', path: '/v1/sql', body });

  it('runs on the index, with its parameters, and reports when the row cap cut it short', async () => {
    const asked: [string, readonly unknown[]][] = [];
    const response = await sql(
      { sql: 'SELECT path FROM files WHERE title = ? OR ? IS NULL', params: ['Call', null] },
      {
        query: async (text: string, parameters: readonly unknown[]) => {
          asked.push([text, parameters]);
          return { columns: ['path'], rows: [['Call.md']], truncated: true };
        },
      },
    );

    expect(bodyOf(response)).toEqual({
      columns: ['path'],
      rows: [['Call.md']],
      truncated: true,
      sql: 'SELECT path FROM files WHERE title = ? OR ? IS NULL',
    });
    expect(asked[0]?.[1]).toEqual(['Call', null]);
  });

  it("is query_failed, with the database's reason, when the read-only connection refuses", async () => {
    const response = await sql(
      { sql: 'DELETE FROM files' },
      {
        query: async () => {
          throw new Error('attempt to write a readonly database');
        },
      },
    );

    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(response.body)).toContain('readonly');
  });

  it('never repeats the machine’s paths in the database’s reason', async () => {
    const response = await sql(
      { sql: 'SELECT 1' },
      {
        query: async () => {
          throw new Error('unable to open database: /Users/j/Other/x.db (code 14)');
        },
      },
    );
    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(response.body)).toContain('unable to open database');
    expect(JSON.stringify(response.body)).not.toContain('/Users/j');
  });

  it('keeps a lone slash the database quotes back, which is not a path', async () => {
    const response = await sql(
      { sql: 'SELECT /' },
      {
        query: async () => {
          throw new Error('near "/": syntax error');
        },
      },
    );
    expect(JSON.stringify(response.body)).toContain('near \\"/\\": syntax error');
  });

  it.each([
    ['  -- a comment\n attach database ? as other'],
    ['/* hidden */ Vacuum'],
    ['\nDETACH other'],
  ])('refuses %j without handing it to the index', async (text) => {
    let ran = false;
    const response = await sql({ sql: text }, { query: async () => ((ran = true), EMPTY_ROWS) });
    expect(codeOf(response)).toBe('invalid');
    expect(ran).toBe(false);
  });

  it.each([['SELECT 1 AS attach'], ['WITH vacuum AS (SELECT 1) SELECT * FROM vacuum']])(
    'hands %j to the index, which only names the words',
    async (text) => {
      let ran = false;
      const response = await sql({ sql: text }, { query: async () => ((ran = true), EMPTY_ROWS) });
      expect(response.status).toBe(200);
      expect(ran).toBe(true);
    },
  );

  it.each([
    ['no sql', {}, 'sql'],
    ['empty sql', { sql: ' ' }, 'sql'],
    ['params that are not an array', { sql: 'SELECT 1', params: 'x' }, 'params'],
    ['a parameter that is an object', { sql: 'SELECT ?', params: [{}] }, 'params[0]'],
    ['a parameter that is a boolean', { sql: 'SELECT ?', params: [1, true] }, 'params[1]'],
  ])('refuses %s as invalid, naming the field', async (_, body, field) => {
    const response = await sql(body);
    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(response.body)).toContain(field);
  });
});

// Keeps the helper honest: a JSON block reads back as what was written.
it('reads JSON frontmatter back as written', () => {
  const { frontmatter } = splitFrontmatter(json(VIEW));
  expect(jsonMarkdown().frontmatterProperties(frontmatter)).toEqual(VIEW);
});
