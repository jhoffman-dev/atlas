import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf, OTHER_VAULT } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import type { ApiQueryGroup } from './contract.ts';
import { MAX_QUERY_TEXT } from './atlas-query.ts';

/* POST /v1/atlas-query: an Atlas query (ADR-0019), run as the query builder runs it. */

const FILES: Record<string, string> = {
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
    properties: { status: { kind: 'select', options: ['active', 'paused'] } },
  }),
  '.atlas/templates/Task.md': jsonNote({ type: 'task', status: 'todo' }),
  'projects/Atlas.md': jsonNote({ type: 'project', status: 'active', title: 'Atlas app' }),
  'projects/Garden.md': jsonNote({ type: 'project', status: 'paused' }),
  'tasks/A.md': jsonNote({ type: 'task', status: 'doing', project: '[[Atlas]]' }),
  'tasks/B.md': jsonNote({ type: 'task', status: 'todo', project: '[[Atlas]]' }),
  'tasks/C.md': jsonNote({ type: 'task', status: 'done', project: '[[Garden]]' }),
  'tasks/D.md': jsonNote({ type: 'task', status: 'todo' }),
  'Archive/tasks/Old.md': jsonNote({ type: 'task', status: 'todo', project: '[[Atlas]]' }),
};

type Api = ReturnType<typeof apiFixture>;

function vault(): Api {
  const markdown = jsonMarkdown();
  return apiFixture({
    files: FILES,
    markdown,
    index: { query: atlasQueryIndex({ files: FILES, markdown }) },
  });
}

const run = (api: Api, body: unknown) =>
  api.send({ method: 'POST', path: '/v1/atlas-query', body });

interface Answer {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
  sql: string;
  groups?: ApiQueryGroup[];
}

async function answerTo(body: unknown, api: Api = vault()): Promise<Answer> {
  const response = await run(api, body);
  expect(response.status).toBe(200);
  return bodyOf(response) as unknown as Answer;
}

const titlesOf = ({ columns, rows }: Answer) => rows.map((row) => row[columns.indexOf('title')]);

const errorOf = (response: { body: unknown }) =>
  (response.body as { error: { message: string; at?: unknown } }).error;

describe('POST /v1/atlas-query', () => {
  it('answers the rows a query finds, with the SQL it ran, and no groups when it has none', async () => {
    const answer = await answerTo({ query: 'FROM task WHERE status != done SORT BY title' });

    expect(titlesOf(answer)).toEqual(['A', 'B', 'D']);
    expect(answer.columns.slice(0, 3)).toEqual(['path', 'title', 'type']);
    expect(answer.truncated).toBe(false);
    expect(answer.sql).toContain('/* atlas-query */');
    expect(answer).not.toHaveProperty('groups');
  });

  it('asks across types at once, and never lists what Atlas keeps in .atlas', async () => {
    const answer = await answerTo({ query: 'FROM task, project SORT BY title' });
    expect(titlesOf(answer)).toEqual(['A', 'Atlas app', 'B', 'C', 'D', 'Garden']);
  });

  it('groups and sub-groups the rows as the app does, a relation named for its note', async () => {
    const answer = await answerTo({
      query: 'FROM task GROUP BY project THEN status SORT BY title',
    });
    const titles = titlesOf(answer);
    const named = (group: ApiQueryGroup): unknown => ({
      label: group.label,
      rows: group.rows.map((at) => titles[at]),
      groups: group.groups.map(named),
    });

    const groups = answer.groups ?? [];
    expect(groups.map(named).slice(0, 2)).toEqual([
      {
        label: 'Atlas app',
        rows: ['A', 'B'],
        groups: [
          // A select's groups come in the type's order: todo before doing.
          { label: 'todo', rows: ['B'], groups: [] },
          { label: 'doing', rows: ['A'], groups: [] },
        ],
      },
      { label: 'Garden', rows: ['C'], groups: [{ label: 'done', rows: ['C'], groups: [] }] },
    ]);
    // The rows with no project come last, with no value.
    expect(groups[2]).toMatchObject({ value: null, rows: [titles.indexOf('D')] });
  });

  it('binds every value: a quote in the text is a value, never SQL', async () => {
    const answer = await answerTo({ query: `FROM task WHERE title = "x' OR 1=1 --"` });
    expect(answer.rows).toEqual([]);
    expect(answer.sql).not.toContain('1=1');
  });
});

describe('POST /v1/atlas-query: archived notes', () => {
  it('leaves the Archive out unless the query says INCLUDE ARCHIVED', async () => {
    const plain = await answerTo({ query: 'FROM task WHERE status = todo SORT BY title' });
    const archived = await answerTo({
      query: 'FROM task WHERE status = todo INCLUDE ARCHIVED SORT BY title',
    });

    expect(titlesOf(plain)).toEqual(['B', 'D']);
    expect(titlesOf(archived)).toEqual(['B', 'D', 'Old']);
  });

  it('refuses includeArchived in the body, pointing at the words that do it', async () => {
    const response = await run(vault(), { query: 'FROM task', includeArchived: true });
    expect(codeOf(response)).toBe('invalid');
    expect(errorOf(response).message).toMatch(/INCLUDE ARCHIVED/);
  });
});

describe('POST /v1/atlas-query: mistakes in the text', () => {
  it.each([
    [
      'a field no listed type has',
      'FROM task\nWHERE stauts = x',
      { line: 2, column: 7, start: 16, end: 22 },
      /no field called stauts/,
    ],
    ['a type that does not exist', 'FROM tsk', { line: 1, column: 6, start: 5, end: 8 }, /tsk/],
    ['a clause cut short', 'FROM task SORT BY', { line: 1, column: 18 }, /./],
  ])('answers %s with invalid, and its line and column', async (_, query, at, reason) => {
    const response = await run(vault(), { query });

    expect(response.status).toBe(400);
    expect(codeOf(response)).toBe('invalid');
    const error = errorOf(response);
    expect(error.at).toMatchObject(at);
    expect(error.message).toMatch(reason);
    expect(error.message.startsWith(`Line ${at.line}, column ${at.column}: `)).toBe(true);
  });

  it('refuses a query of more than 2000 conditions, the checker’s cap', async () => {
    const conditions = Array.from({ length: 2001 }, () => 'status = todo').join(' OR ');
    const response = await run(vault(), { query: `FROM task WHERE ${conditions}` });

    expect(codeOf(response)).toBe('invalid');
    expect(errorOf(response).message).toMatch(/2000 conditions at most/);
    expect(errorOf(response).at).toMatchObject({ line: 1 });
  });

  it.each([
    ['no body', null],
    ['no query', {}],
    ['a blank query', { query: '   ' }],
    ['a query that is not text', { query: 3 }],
    ['a query longer than the cap', { query: `FROM task ${' '.repeat(MAX_QUERY_TEXT)}` }],
  ])('refuses %s with invalid', async (_, body) => {
    expect(codeOf(await run(vault(), body))).toBe('invalid');
  });
});

describe('POST /v1/atlas-query: limits', () => {
  it('answers at most `limit` rows, saying more matched', async () => {
    const answer = await answerTo({ query: 'FROM task SORT BY title', limit: 2 });
    expect(titlesOf(answer)).toEqual(['A', 'B']);
    expect(answer.truncated).toBe(true);
  });

  it('says nothing more matched when the limit holds every row', async () => {
    const answer = await answerTo({ query: 'FROM task SORT BY title', limit: 4 });
    expect(titlesOf(answer)).toEqual(['A', 'B', 'C', 'D']);
    expect(answer.truncated).toBe(false);
  });

  it("keeps the text's own LIMIT when it is smaller than the one asked for", async () => {
    const answer = await answerTo({ query: 'FROM task SORT BY title LIMIT 1', limit: 3 });
    expect(titlesOf(answer)).toEqual(['A']);
    expect(answer.truncated).toBe(true);
  });

  it("takes the limit asked for when it is smaller than the text's LIMIT", async () => {
    const answer = await answerTo({ query: 'FROM task SORT BY title LIMIT 3', limit: 1 });
    expect(titlesOf(answer)).toEqual(['A']);
  });

  it.each([0, 5001, -1, 2.5, 'ten', true])('refuses a limit of %j', async (limit) => {
    expect(codeOf(await run(vault(), { query: 'FROM task', limit }))).toBe('invalid');
  });

  it('says more matched when a window at the row cap comes back full', async () => {
    const api = apiFixture({
      files: FILES,
      markdown: jsonMarkdown(),
      index: {
        query: async () => ({
          columns: ['path', 'title', 'type'],
          rows: Array.from({ length: 5000 }, (_, at) => [`tasks/${at}.md`, `${at}`, 'task']),
          truncated: false,
        }),
      },
    });
    const answer = await answerTo({ query: 'FROM task', limit: 5000 }, api);
    expect(answer.rows).toHaveLength(5000);
    expect(answer.truncated).toBe(true);
  });
});

describe('POST /v1/atlas-query: the vault it names', () => {
  it('answers no_vault when the vault is switched while the index is read', async () => {
    const api = vault();
    const query = api.deps.index.query;
    api.deps = {
      ...api.deps,
      index: {
        ...api.deps.index,
        query: async (sql, parameters) => {
          api.open = OTHER_VAULT;
          return query(sql, parameters);
        },
      },
    };
    expect(codeOf(await run(api, { query: 'FROM task' }))).toBe('no_vault');
  });

  it("answers query_failed with the index's reason, and no paths on this machine", async () => {
    const api = apiFixture({
      files: FILES,
      markdown: jsonMarkdown(),
      index: {
        query: async () => {
          throw new Error('unable to open /Users/j/Vault/.atlas-cache/index.db');
        },
      },
    });
    const response = await run(api, { query: 'FROM task' });
    expect(codeOf(response)).toBe('query_failed');
    expect(errorOf(response).message).not.toContain('/Users/');
  });
});
