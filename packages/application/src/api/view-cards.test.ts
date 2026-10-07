/**
 * Issue #6 through the local API: a card moved on a board to a column, a
 * lane or both — finishing and rolling a task forward exactly as a drag does
 * — and a note added inside a view's group, given that group's values.
 */

import { describe, expect, it } from 'vitest';
import type { IndexPort } from '../index/ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const TASK = jsonNote({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['todo', 'doing', 'done'] },
    area: { kind: 'select', options: ['home', 'work'] },
    points: 'number',
    flagged: 'checkbox',
    tags: 'multiSelect',
    project: { kind: 'relation', target: 'project' },
  },
});
/** A type with no status: a board by its stage finishes work in its last column. */
const STEP = jsonNote({
  name: 'step',
  label: 'Step',
  properties: { stage: { kind: 'select', options: ['open', 'shipped'] } },
});

const view = (display: Record<string, unknown>, type = 'task') =>
  jsonNote({ atlas: 'view', type, columns: ['title'], ...display });

const BODY = '\n# Weekly review\n\nKeep  these   bytes.\n';
const WEEKLY = `---\ntype: task\nstatus: doing\narea: home\ndue: 2026-01-05\nrecurrence: every week\n---\n${BODY}`;

/** jsonMarkdown, remembering every set of properties a new note's frontmatter was made from. */
function recordingMarkdown(): MarkdownPort & { made: Record<string, unknown>[] } {
  const base = jsonMarkdown();
  const made: Record<string, unknown>[] = [];
  return {
    ...base,
    made,
    updateFrontmatter: (frontmatter, changes) => {
      if (frontmatter === null) made.push({ ...changes });
      return base.updateFrontmatter(frontmatter, changes);
    },
  };
}

function vault(files: Record<string, string> = {}, index: Partial<IndexPort> = {}) {
  const markdown = recordingMarkdown();
  const api = apiFixture({
    markdown,
    index,
    files: {
      '.atlas/types/task.md': TASK,
      '.atlas/types/step.md': STEP,
      '.atlas/views/Board.md': view({ layout: 'board', groupBy: 'area', subGroupBy: 'status' }),
      '.atlas/views/Status.md': view({ layout: 'board', groupBy: 'status' }),
      '.atlas/views/Table.md': view({ layout: 'table', groupBy: 'points', subGroupBy: 'flagged' }),
      '.atlas/views/Plain.md': view({ layout: 'table' }),
      '.atlas/views/Tags.md': view({ layout: 'board', groupBy: 'tags' }),
      '.atlas/views/Steps.md': view({ layout: 'board', groupBy: 'stage' }, 'step'),
      '.atlas/views/Projects.md': view({ layout: 'board', groupBy: 'project' }),
      '.atlas/views/Query.md': jsonNote({ atlas: 'view', layout: 'board', query: 'FROM task' }),
      '.atlas/dashboards/Home.md': jsonNote({ atlas: 'dashboard', widgets: [] }),
      'Weekly.md': WEEKLY,
      'Ship.md': '---\ntype: step\nstage: open\n---\n',
      'Recipe.md': '---\ntype: recipe\narea: home\n---\n',
      ...files,
    },
  });
  return { api, markdown };
}

type Api = ReturnType<typeof vault>['api'];

/** An index answering the board's run with these rows of path, title, status and area. */
const rowsAnswering = (rows: unknown[][]): Partial<IndexPort> => ({
  query: async (text) =>
    text.includes('graph:')
      ? { columns: [], rows: [], truncated: false }
      : { columns: ['path', 'title', 'status', 'area'], rows, truncated: false },
});

const move = (api: Api, body: unknown, board = '.atlas/views/Board.md') =>
  api.send({ method: 'POST', path: `/v1/views/${encoded(board)}/move`, body });

const add = (api: Api, body: unknown, at = '.atlas/views/Table.md') =>
  api.send({ method: 'POST', path: `/v1/views/${encoded(at)}/notes`, body });

const textOf = (api: Api, path: string) => api.files.get(path)?.text ?? '';

/** The `modified` a caller reads a note at, which a move that finishes it must carry. */
const modifiedOf = (api: Api, path: string) => api.files.get(path)?.modified ?? 0;

describe('POST /v1/views/{path}/move', () => {
  it('moves a card to another column and lane in one write, keeping the body byte for byte', async () => {
    const { api } = vault();

    const response = await move(api, { note: 'Weekly.md', group: 'work', subGroup: 'todo' });

    expect(response.status).toBe(200);
    expect(bodyOf(response)['moved']).toBe(true);
    expect(api.writes.filter((write) => write.path === 'Weekly.md')).toHaveLength(1);
    const text = textOf(api, 'Weekly.md');
    expect(text).toContain('area: work');
    expect(text).toContain('status: todo');
    expect(text.endsWith(BODY)).toBe(true);
  });

  it('finishes a repeating task dropped into the done lane by rolling it forward once', async () => {
    const { api } = vault();

    await move(api, {
      note: 'Weekly.md',
      group: 'work',
      subGroup: 'done',
      ifModified: modifiedOf(api, 'Weekly.md'),
    });

    const text = textOf(api, 'Weekly.md');
    expect(text).toContain('area: work');
    expect(text).toContain('status: todo');
    expect(text).toContain('due: 2026-01-12');
  });

  it('finishes a repeating task dropped into the done column of a board by status', async () => {
    const { api } = vault();

    await move(
      api,
      { note: 'Weekly.md', group: 'done', ifModified: modifiedOf(api, 'Weekly.md') },
      '.atlas/views/Status.md',
    );

    expect(textOf(api, 'Weekly.md')).toContain('due: 2026-01-12');
  });

  it('finishes a type with no status in its last column, as the plain board reads it', async () => {
    const { api } = vault({
      'Ship.md': '---\ntype: step\nstage: open\ndue: 2026-01-05\nrecurrence: every week\n---\n',
    });

    await move(
      api,
      { note: 'Ship.md', group: 'shipped', ifModified: modifiedOf(api, 'Ship.md') },
      '.atlas/views/Steps.md',
    );

    const text = textOf(api, 'Ship.md');
    expect(text).toContain('stage: open');
    expect(text).toContain('due: 2026-01-12');
  });

  it('writes nothing for a group the card is already in, so a done task is not rolled forward again', async () => {
    const { api } = vault({
      'Done.md':
        '---\ntype: task\nstatus: done\narea: home\ndue: 2026-01-05\nrecurrence: every week\n---\n',
    });

    const response = await move(api, { note: 'Done.md', group: 'home', subGroup: 'done' });

    expect(response.status).toBe(200);
    expect(bodyOf(response)['moved']).toBe(false);
    expect(api.writes).toEqual([]);
    expect(api.activity.reports).toEqual([]);
  });

  it('moves only the lane when only the lane is asked, leaving the column alone', async () => {
    const { api } = vault();

    await move(api, { note: 'Weekly.md', subGroup: 'todo' });

    const text = textOf(api, 'Weekly.md');
    expect(text).toContain('area: home');
    expect(text).toContain('status: todo');
  });

  it('moves a card into "No value" when the group asked is null, removing the property', async () => {
    const { api } = vault();

    await move(api, { note: 'Weekly.md', group: null });

    expect(textOf(api, 'Weekly.md')).not.toContain('area:');
  });

  it('logs a move that wrote in the Activity log', async () => {
    const { api } = vault();

    await move(api, { note: 'Weekly.md', group: 'work' });

    expect(api.activity.reports).toHaveLength(1);
  });

  it('refuses a write when the note changed since it was read', async () => {
    const { api } = vault();

    const response = await move(api, { note: 'Weekly.md', group: 'work', ifModified: 1 });

    expect(codeOf(response)).toBe('conflict');
    expect(api.writes).toEqual([]);
  });

  it('refuses a move that would finish a task without ifModified, saying why', async () => {
    const { api } = vault();

    const response = await move(
      api,
      { note: 'Weekly.md', group: 'done' },
      '.atlas/views/Status.md',
    );

    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(bodyOf(response))).toContain('ifModified');
    expect(api.writes).toEqual([]);
  });

  it('refuses a retried move into done as stale, so a repeating task is rolled forward once', async () => {
    const { api } = vault();
    const request = { note: 'Weekly.md', group: 'done', ifModified: modifiedOf(api, 'Weekly.md') };

    expect((await move(api, request, '.atlas/views/Status.md')).status).toBe(200);
    expect(codeOf(await move(api, request, '.atlas/views/Status.md'))).toBe('conflict');

    expect(textOf(api, 'Weekly.md')).toContain('due: 2026-01-12');
  });

  it('matches a group spelled with spaces to its column, finishing the task as "done" does', async () => {
    const { api } = vault();

    await move(
      api,
      { note: 'Weekly.md', group: ' done ', ifModified: modifiedOf(api, 'Weekly.md') },
      '.atlas/views/Status.md',
    );

    expect(textOf(api, 'Weekly.md')).toContain('due: 2026-01-12');
  });

  it("refuses a lane that is not one of the board's lanes, naming the ones it has", async () => {
    const { api } = vault();

    const response = await move(api, { note: 'Weekly.md', subGroup: 'Todo' });

    expect(codeOf(response)).toBe('invalid');
    expect(JSON.stringify(bodyOf(response))).toContain('todo');
    expect(api.writes).toEqual([]);
  });

  it('moves a card to a value another card already has, though the type does not declare it', async () => {
    const { api } = vault({}, rowsAnswering([['Odd.md', 'Odd', 'blocked', 'home']]));

    const response = await move(api, { note: 'Weekly.md', subGroup: 'blocked' });

    expect(bodyOf(response)['moved']).toBe(true);
    expect(textOf(api, 'Weekly.md')).toContain('status: blocked');
  });

  it('leaves a card linked to several notes alone in the column of its first, keeping the rest', async () => {
    const linked = '---\ntype: task\nproject: [[A]], [[B]]\n---\n';
    const { api } = vault({ 'Linked.md': linked });

    const response = await move(
      api,
      { note: 'Linked.md', group: '[[a]]' },
      '.atlas/views/Projects.md',
    );

    expect(bodyOf(response)['moved']).toBe(false);
    expect(textOf(api, 'Linked.md')).toBe(linked);
  });

  it('refuses a relation column for a note the board has no column for', async () => {
    const { api } = vault();

    const response = await move(
      api,
      { note: 'Weekly.md', group: '[[Nowhere]]' },
      '.atlas/views/Projects.md',
    );

    expect(codeOf(response)).toBe('invalid');
    expect(api.writes).toEqual([]);
  });

  it('refuses to move a dashboard note that says the type, as a card of it', async () => {
    const dashboard = jsonNote({ atlas: 'dashboard', type: 'task', widgets: [] });
    const { api } = vault({ 'Mine.md': dashboard });

    const response = await move(api, { note: 'Mine.md', group: 'work' });

    expect(codeOf(response)).toBe('invalid');
    expect(textOf(api, 'Mine.md')).toBe(dashboard);
  });

  it.each([
    ['a view that is not a board', '.atlas/views/Table.md', { note: 'Weekly.md', group: '3' }],
    [
      'a lane on a board with none',
      '.atlas/views/Status.md',
      { note: 'Weekly.md', subGroup: 'home' },
    ],
    [
      'a board grouped by a field holding several values',
      '.atlas/views/Tags.md',
      { note: 'Weekly.md', group: 'x' },
    ],
    ['a query view', '.atlas/views/Query.md', { note: 'Weekly.md', group: 'done' }],
    ['no group or lane', '.atlas/views/Board.md', { note: 'Weekly.md' }],
    ['a group that is not text', '.atlas/views/Board.md', { note: 'Weekly.md', group: 3 }],
    ['a note of another type', '.atlas/views/Board.md', { note: 'Recipe.md', group: 'work' }],
    ['a note in .atlas', '.atlas/views/Board.md', { note: '.atlas/views/Plain.md', group: 'work' }],
    ['no note', '.atlas/views/Board.md', { group: 'work' }],
  ])('refuses %s as invalid, writing nothing', async (_, board, body) => {
    const { api } = vault();

    const response = await move(api, body, board);

    expect(codeOf(response)).toBe('invalid');
    expect(api.writes).toEqual([]);
  });

  it('answers not_found for a dashboard, and for a note that is not there', async () => {
    const { api } = vault();

    expect(
      codeOf(await move(api, { note: 'Weekly.md', group: 'work' }, '.atlas/dashboards/Home.md')),
    ).toBe('not_found');
    expect(codeOf(await move(api, { note: 'Gone.md', group: 'work' }))).toBe('not_found');
  });

  it('refuses with no_vault when another vault opened before the write', async () => {
    const { api } = vault();
    api.open = null;

    const response = await move(api, { note: 'Weekly.md', group: 'work' });

    expect(codeOf(response)).toBe('no_vault');
    expect(api.writes).toEqual([]);
  });
});

describe('POST /v1/views/{path}/notes', () => {
  it("adds a note of the view's type at the root, given its group's values typed by their kinds", async () => {
    const { api, markdown } = vault();

    const response = await add(api, { group: '3', subGroup: 'true' });

    expect(response.status).toBe(201);
    expect(bodyOf(response)['note']).toMatchObject({ path: 'New task.md' });
    expect(markdown.made).toEqual([{ type: 'task', points: 3, flagged: true }]);
  });

  it('gives a note added to a "No value" group, or the unticked one, nothing for it', async () => {
    const { api, markdown } = vault();

    await add(api, { group: null, subGroup: 'false' });

    expect(markdown.made).toEqual([{ type: 'task' }]);
  });

  it("adds a card to a board's column and lane", async () => {
    const { api, markdown } = vault();

    const response = await add(
      api,
      { group: 'work', subGroup: 'doing', name: 'Plan' },
      '.atlas/views/Board.md',
    );

    expect(bodyOf(response)['note']).toMatchObject({ path: 'Plan.md' });
    expect(markdown.made).toEqual([{ type: 'task', area: 'work', status: 'doing' }]);
  });

  it('numbers the name past a note already called that', async () => {
    const { api } = vault({ 'New task.md': '---\ntype: task\n---\n' });

    const response = await add(api, {});

    expect(bodyOf(response)['note']).toMatchObject({ path: 'New task 2.md' });
    expect(textOf(api, 'New task.md')).toBe('---\ntype: task\n---\n');
  });

  it('cleans a name that would hide the note or leave the root', async () => {
    const { api } = vault();

    const response = await add(api, { name: '../.secret' });

    expect(response.status).toBe(201);
    expect(bodyOf(response)['note']).toMatchObject({ path: 'secret.md' });
  });

  it('adds a plain note of the type to a view that groups by nothing', async () => {
    const { api, markdown } = vault();

    expect((await add(api, {}, '.atlas/views/Plain.md')).status).toBe(201);
    expect(markdown.made).toEqual([{ type: 'task' }]);
  });

  it.each([
    ['a group in a view that draws none', '.atlas/views/Plain.md', { group: 'home' }],
    ['a sub-group in a view that draws none', '.atlas/views/Status.md', { subGroup: 'home' }],
    ['a query view', '.atlas/views/Query.md', {}],
  ])('refuses %s as invalid, making nothing', async (_, at, body) => {
    const { api } = vault();

    const response = await add(api, body, at);

    expect(codeOf(response)).toBe('invalid');
    expect(api.writes).toEqual([]);
  });
});
