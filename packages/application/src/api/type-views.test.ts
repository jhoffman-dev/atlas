/**
 * Issue #11 through the local API: a type's views, in the order its tabs read
 * (ADR-0023) — placed views by their `order:`, then the unplaced in the old
 * layout-then-name order — and the virtual default table of a type with none.
 */

import { describe, expect, it } from 'vitest';
import type { IndexPort } from '../index/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded, OTHER_VAULT } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const TASK = jsonNote({ name: 'task', label: 'Task', properties: { status: 'text' } });
const PROJECT = jsonNote({ name: 'project', label: 'Project', properties: {} });

const view = (display: Record<string, unknown>) =>
  jsonNote({ atlas: 'view', type: 'task', ...display });

function vault({
  files = {},
  index = {},
}: { files?: Record<string, string>; index?: Partial<IndexPort> } = {}) {
  return apiFixture({
    markdown: jsonMarkdown(),
    index,
    files: { '.atlas/types/task.md': TASK, '.atlas/types/project.md': PROJECT, ...files },
  });
}

const typeViews = (api: ReturnType<typeof vault>, name: string) =>
  api.send({ method: 'GET', path: `/v1/types/${encoded(name)}/views` });

describe('GET /v1/types/{name}/views', () => {
  it("answers the type's views in tab order: placed by order, then unplaced by layout and name", async () => {
    const api = vault({
      files: {
        '.atlas/views/Zebra table.md': view({ layout: 'table' }),
        '.atlas/views/Alpha table.md': view({ layout: 'table' }),
        '.atlas/views/Plan.md': view({ layout: 'board', groupBy: 'status' }),
        '.atlas/views/Second.md': view({ layout: 'list', order: 2 }),
        '.atlas/views/First.md': view({ layout: 'gallery', order: 1, title: 'Due dates' }),
        '.atlas/views/Projects.md': jsonNote({ atlas: 'view', type: 'project', layout: 'table' }),
      },
    });

    const response = await typeViews(api, 'task');

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      type: 'task',
      views: [
        {
          path: '.atlas/views/First.md',
          title: 'Due dates',
          layout: 'gallery',
          order: 1,
          virtual: false,
        },
        {
          path: '.atlas/views/Second.md',
          title: 'Second',
          layout: 'list',
          order: 2,
          virtual: false,
        },
        {
          path: '.atlas/views/Plan.md',
          title: 'Plan',
          layout: 'board',
          order: null,
          virtual: false,
        },
        {
          path: '.atlas/views/Alpha table.md',
          title: 'Alpha table',
          layout: 'table',
          order: null,
          virtual: false,
        },
        {
          path: '.atlas/views/Zebra table.md',
          title: 'Zebra table',
          layout: 'table',
          order: null,
          virtual: false,
        },
      ],
      total: 5,
      next: null,
    });
  });

  it('includes a view kept outside .atlas, which the index finds', async () => {
    const marks = [
      ['Work/Mine.md', 'atlas', 'view'],
      ['Work/Mine.md', 'type', 'task'],
      ['Work/Mine.md', 'order', 5],
    ];
    const api = vault({
      files: { '.atlas/views/Board.md': view({ layout: 'board', order: 9 }) },
      index: {
        query: async () => ({
          columns: ['path', 'key', 'value', 'title'],
          rows: marks.map((mark) => [...mark, 'Mine']),
          truncated: false,
        }),
      },
    });

    const { views } = bodyOf(await typeViews(api, 'task')) as { views: { path: string }[] };

    expect(views.map((entry) => entry.path)).toEqual(['Work/Mine.md', '.atlas/views/Board.md']);
  });

  it('answers the virtual default table, named as the app names it, for a type with no views', async () => {
    const api = vault({
      // The name the default would take is already a view's (of another type),
      // so it is numbered past it, as the app's tab would be.
      files: { '.atlas/views/Task table.md': jsonNote({ atlas: 'view', type: 'project' }) },
    });

    expect(bodyOf(await typeViews(api, 'task'))).toEqual({
      type: 'task',
      views: [
        {
          path: '.atlas/views/Task table 2.md',
          title: 'Task table 2',
          layout: 'table',
          order: null,
          virtual: true,
        },
      ],
      total: 1,
      next: null,
    });
  });

  it('writes nothing, even for the virtual default', async () => {
    const api = vault();

    await typeViews(api, 'task');

    expect(api.writes).toEqual([]);
  });

  it('decodes the type name from its segment', async () => {
    const api = apiFixture({
      markdown: jsonMarkdown(),
      files: {
        '.atlas/types/reading-list.md': jsonNote({ name: 'reading list', label: 'Reading list' }),
        '.atlas/views/Shelf.md': jsonNote({ atlas: 'view', type: 'reading list' }),
      },
    });

    const body = bodyOf(await api.send({ method: 'GET', path: '/v1/types/reading%20list/views' }));

    expect(body['type']).toBe('reading list');
    expect(body['views']).toEqual([expect.objectContaining({ path: '.atlas/views/Shelf.md' })]);
  });

  it('is not_found for a type the vault does not define', async () => {
    const api = vault({
      files: { '.atlas/views/Orphan.md': jsonNote({ atlas: 'view', type: 'ghost' }) },
    });

    const response = await typeViews(api, 'ghost');

    expect(response.status).toBe(404);
    expect(codeOf(response)).toBe('not_found');
  });

  it('matches the type by its exact name', async () => {
    expect(codeOf(await typeViews(vault(), 'Task'))).toBe('not_found');
  });

  it('is invalid for a name that is not validly percent-encoded', async () => {
    const response = await vault().send({ method: 'GET', path: '/v1/types/%E0%A4%A/views' });

    expect(codeOf(response)).toBe('invalid');
  });

  it('answers no_vault when the vault is switched while the views are read', async () => {
    const api = vault();
    api.deps = {
      ...api.deps,
      index: {
        ...api.deps.index,
        query: async () => {
          api.open = OTHER_VAULT;
          return { columns: [], rows: [], truncated: false };
        },
      },
    };

    expect(codeOf(await typeViews(api, 'task'))).toBe('no_vault');
  });

  it('answers a page at a time, in tab order, with the total and where the next page starts', async () => {
    const files: Record<string, string> = {};
    for (const at of [1, 2, 3, 4, 5]) {
      files[`.atlas/views/V${at}.md`] = view({ layout: 'table', order: at });
    }
    const api = vault({ files });
    const page = async (query: Record<string, string>) =>
      bodyOf(await api.send({ method: 'GET', path: `/v1/types/task/views`, query })) as {
        views: { title: string }[];
        total: number;
        next: number | null;
      };

    const first = await page({ limit: '2' });
    const last = await page({ limit: '2', offset: '4' });

    expect(first.views.map((each) => each.title)).toEqual(['V1', 'V2']);
    expect([first.total, first.next]).toEqual([5, 2]);
    expect(last.views.map((each) => each.title)).toEqual(['V5']);
    expect([last.total, last.next]).toEqual([5, null]);
  });

  it('is invalid for a limit or an offset that is not a whole number', async () => {
    const api = vault();
    const send = (query: Record<string, string>) =>
      api.send({ method: 'GET', path: '/v1/types/task/views', query });

    expect(codeOf(await send({ limit: '0' }))).toBe('invalid');
    expect(codeOf(await send({ limit: '501' }))).toBe('invalid');
    expect(codeOf(await send({ offset: '-1' }))).toBe('invalid');
    expect(codeOf(await send({ offset: '0x2' }))).toBe('invalid');
  });
});
