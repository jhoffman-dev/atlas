import type { BoardRow, RowGroup } from '@atlas/domain';
import { describe, expect, it } from 'vitest';
import { apiFixture, bodyOf, codeOf, encoded, OTHER_VAULT } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { toApiGroup } from './atlas-query-answer.ts';
import { MAX_QUERY_TEXT } from './atlas-query.ts';
import type { ApiQueryGroup } from './contract.ts';

/* A24-02: the review's findings on /v1/atlas-query and the views route. */

const FILES: Record<string, string> = {
  '.atlas/types/task.md': jsonNote({
    name: 'task',
    label: 'Task',
    properties: { project: { kind: 'relation', target: 'project' } },
  }),
  '.atlas/types/project.md': jsonNote({ name: 'project', label: 'Project', properties: {} }),
  '.atlas/templates/Project.md': jsonNote({ type: 'project', title: 'Secret plans' }),
  'projects/Atlas.md': jsonNote({ type: 'project', title: 'Atlas app' }),
  'tasks/A.md': jsonNote({ type: 'task', project: '[[Atlas]]' }),
  'tasks/B.md': jsonNote({ type: 'task', project: '[[.atlas/templates/Project]]' }),
  '.atlas/views/Tasks.md': jsonNote({ atlas: 'view', type: 'task', layout: 'table' }),
  '.atlas/views/Sql.md': jsonNote({
    atlas: 'view',
    layout: 'table',
    sql: 'SELECT path FROM files',
  }),
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

const ask = (api: Api, body: unknown) =>
  api.send({ method: 'POST', path: '/v1/atlas-query', body });

describe('POST /v1/atlas-query: group labels', () => {
  it('names a relation’s group by a note the API may read, never by a note in .atlas', async () => {
    const response = await ask(vault(), { query: 'FROM task GROUP BY project' });
    const groups = bodyOf(response)['groups'] as ApiQueryGroup[];
    const labels = groups.map((group) => group.label);
    expect(labels).toContain('Atlas app');
    expect(labels).not.toContain('Secret plans');
  });
});

describe('POST /v1/atlas-query: the text cap', () => {
  it('counts characters, not UTF-16 units', async () => {
    // Every emoji is one character and two units: this text is under the cap
    // in characters and over it in units.
    const padding = '😀'.repeat(MAX_QUERY_TEXT / 2);
    const response = await ask(vault(), { query: `FROM task WHERE title = "${padding}"` });
    expect(response.status).toBe(200);
  });

  it('still refuses a text over the cap in characters', async () => {
    const padding = '😀'.repeat(MAX_QUERY_TEXT);
    const response = await ask(vault(), { query: `FROM task WHERE title = "${padding}"` });
    expect(codeOf(response)).toBe('invalid');
  });
});

describe('POST /v1/views/{path}/run: a vault switch', () => {
  /** Switches the open vault while the index is read, as a user can mid-request. */
  function switching(): Api {
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
    return api;
  }

  it.each([
    ['a type view', '.atlas/views/Tasks.md'],
    ['a SQL view', '.atlas/views/Sql.md'],
  ])('answers no_vault for %s run across it', async (_, path) => {
    const response = await switching().send({
      method: 'POST',
      path: `/v1/views/${encoded(path)}/run`,
    });
    expect(codeOf(response)).toBe('no_vault');
  });
});

describe('toApiGroup', () => {
  it('refuses a grouped row that is not one of the rows answered', () => {
    const row: BoardRow = { path: 'tasks/A.md', title: 'A', values: {} };
    const group: RowGroup = {
      id: '/x',
      field: 'status',
      kind: 'select',
      label: 'x',
      value: 'x',
      tone: null,
      rows: [row],
      subgroups: [],
    };
    expect(() => toApiGroup(group, new Map())).toThrow();
  });
});
