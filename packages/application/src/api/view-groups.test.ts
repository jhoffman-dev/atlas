/**
 * Issue #6 through the local API: a saved view's groups and sub-groups — a
 * table's groups, a board's columns and swimlanes — answered with its rows, as
 * the app draws them.
 */

import { describe, expect, it } from 'vitest';
import type { IndexPort } from '../index/ports.ts';
import { apiFixture, bodyOf, encoded } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const TASK = jsonNote({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['todo', 'doing', 'done'] },
    area: { kind: 'select', options: ['home', 'work'] },
    project: { kind: 'relation', target: 'project' },
    tags: 'multiSelect',
  },
});

const VIEWS = {
  '.atlas/views/Table.md': { layout: 'table', groupBy: 'area', subGroupBy: 'status' },
  '.atlas/views/Board.md': { layout: 'board', groupBy: 'status', subGroupBy: 'area' },
  '.atlas/views/Gallery.md': { layout: 'gallery', groupBy: 'area', subGroupBy: 'status' },
  '.atlas/views/List.md': { layout: 'list', groupBy: 'area' },
  '.atlas/views/Plain.md': { layout: 'table' },
  '.atlas/views/Tags.md': { layout: 'table', groupBy: 'tags' },
  '.atlas/views/Projects.md': { layout: 'board', groupBy: 'project' },
};

/** Rows as the index answers whichever columns were asked for. */
const ROWS: Record<string, unknown>[] = [
  { path: 'A.md', title: 'A', status: 'todo', area: 'home', project: '[[Atlas]]' },
  { path: 'B.md', title: 'B', status: 'done', area: 'work', project: null },
  { path: 'C.md', title: 'C', status: 'todo', area: 'work', project: '[[Atlas]]' },
];

function vault() {
  const sql: string[] = [];
  const index: Partial<IndexPort> = {
    query: async (text: string) => {
      if (text.includes('graph:namedNotes')) {
        return {
          columns: ['path', 'title'],
          rows: [['Projects/Atlas.md', 'Atlas']],
          truncated: false,
        };
      }
      sql.push(text);
      const columns = [
        'path',
        'title',
        ...['status', 'area', 'project'].filter((key) => text.includes(`"${key}"`)),
      ];
      return {
        columns,
        rows: ROWS.map((row) => columns.map((column) => row[column] ?? null)),
        truncated: false,
      };
    },
    notesOfType: async (type: string) =>
      type === 'project'
        ? [
            { path: 'Projects/Atlas.md', title: 'Atlas' },
            { path: 'Projects/Garden.md', title: 'Garden' },
            { path: '.atlas/templates/Project.md', title: 'Project' },
          ]
        : [],
  };
  const files = Object.fromEntries(
    Object.entries(VIEWS).map(([path, display]) => [
      path,
      jsonNote({ atlas: 'view', type: 'task', columns: ['title'], ...display }),
    ]),
  );
  const api = apiFixture({
    markdown: jsonMarkdown(),
    index,
    files: { '.atlas/types/task.md': TASK, ...files },
  });
  return { api, sql };
}

const run = async (api: ReturnType<typeof vault>['api'], view: string) =>
  bodyOf(await api.send({ method: 'POST', path: `/v1/views/${encoded(view)}/run` }));

/** Each group as `label: row titles`, with its sub-groups nested. */
type Group = { label: string; value: string | null; rows: number[]; groups: Group[] };
const outline = (body: Record<string, unknown>): unknown => {
  const rows = body['rows'] as unknown[][];
  const titleAt = (body['columns'] as string[]).indexOf('title');
  const shape = (group: Group): unknown => ({
    [group.label]:
      group.groups.length > 0
        ? group.groups.map(shape)
        : group.rows.map((place) => rows[place]?.[titleAt]),
  });
  return (body['groups'] as Group[]).map(shape);
};

describe("GET /v1/views: a view's grouping", () => {
  it('names what each view groups and sub-groups by', async () => {
    const { api } = vault();

    const views = bodyOf(await api.send({ method: 'GET', path: '/v1/views' }))['views'] as {
      title: string;
      groupBy: string | null;
      subGroupBy: string | null;
    }[];

    expect(views.find((view) => view.title === 'Board')).toMatchObject({
      groupBy: 'status',
      subGroupBy: 'area',
    });
    expect(views.find((view) => view.title === 'Plain')).toMatchObject({
      groupBy: null,
      subGroupBy: null,
    });
  });
});

describe('POST /v1/views/{path}/run: groups', () => {
  it("answers a table's groups and their sub-groups, in the type's order", async () => {
    const { api } = vault();

    const body = await run(api, '.atlas/views/Table.md');

    expect(outline(body)).toEqual([
      { home: [{ todo: ['A'] }] },
      { work: [{ todo: ['C'] }, { done: ['B'] }] },
    ]);
  });

  it('reads what it groups by without adding it to the columns answered', async () => {
    const { api, sql } = vault();

    const body = await run(api, '.atlas/views/Table.md');

    expect(sql[0]).toContain('"area"');
    expect(sql[0]).toContain('"status"');
    expect(body['columns']).toEqual(['path', 'title']);
    expect(body['rows']).toEqual([
      ['A.md', 'A'],
      ['B.md', 'B'],
      ['C.md', 'C'],
    ]);
  });

  it("answers a board's columns — an empty one included — each split into its swimlanes", async () => {
    const { api } = vault();

    const body = await run(api, '.atlas/views/Board.md');

    expect(outline(body)).toEqual([
      { todo: [{ home: ['A'] }, { work: ['C'] }] },
      { doing: [] },
      { done: [{ work: ['B'] }] },
    ]);
    expect((body['groups'] as Group[]).map((group) => group.value)).toEqual([
      'todo',
      'doing',
      'done',
    ]);
  });

  it('gives a gallery its first level only: its groups are its columns', async () => {
    const { api } = vault();

    expect(outline(await run(api, '.atlas/views/Gallery.md'))).toEqual([
      { home: ['A'] },
      { work: ['B', 'C'] },
    ]);
  });

  it('answers no groups for a layout that draws none, nor for a view that groups by nothing', async () => {
    const { api } = vault();

    expect(await run(api, '.atlas/views/List.md')).not.toHaveProperty('groups');
    expect(await run(api, '.atlas/views/Plain.md')).not.toHaveProperty('groups');
  });

  it('groups by nothing a field holding several values, as the app does', async () => {
    const { api } = vault();

    expect(await run(api, '.atlas/views/Tags.md')).not.toHaveProperty('groups');
  });

  it("names a relation's groups for the note, with a column for every note it can point at", async () => {
    const { api } = vault();

    const body = await run(api, '.atlas/views/Projects.md');

    // The template is not a project, so it has no column.
    expect(outline(body)).toEqual([{ Atlas: ['A', 'C'] }, { Garden: [] }, { 'No value': ['B'] }]);
  });
});
