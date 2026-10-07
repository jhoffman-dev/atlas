/**
 * The Archive through the API (A20-05, P23-03): archiving and restoring notes
 * in a batch, listing what is archived, and reaching archived notes from
 * search and views only when asked.
 */

import { describe, expect, it } from 'vitest';
import type { SearchScope } from '../index/ports.ts';
import { apiFixture, bodyOf, codeOf, encoded, TODAY } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';

const archive = (paths: unknown) => ({
  method: 'POST' as const,
  path: '/v1/archive',
  body: { paths },
});
const unarchive = (paths: unknown) => ({
  method: 'POST' as const,
  path: '/v1/unarchive',
  body: { paths },
});

describe('POST /v1/archive', () => {
  it('moves each note under Archive/, stamped with the day and where it was, body untouched', async () => {
    const api = apiFixture({
      files: {
        'Projects/Lease.md': 'status: open\n\nThe  lease *body*,  byte for byte.\n',
        'Call.md': 'Just a call.\n',
      },
    });

    const response = await api.send(archive(['Projects/Lease.md', 'Call.md']));

    expect(response.status).toBe(200);
    expect(bodyOf(response)).toEqual({
      moves: [
        { from: 'Projects/Lease.md', to: 'Archive/Projects/Lease.md' },
        { from: 'Call.md', to: 'Archive/Call.md' },
      ],
      failed: [],
      linksUpdated: 0,
    });
    expect(api.files.has('Projects/Lease.md')).toBe(false);
    const lease = api.files.get('Archive/Projects/Lease.md')?.text ?? '';
    expect(lease).toContain(`archived: ${TODAY}`);
    expect(lease).toContain('archivedFrom: Projects/Lease.md');
    expect(lease.endsWith('status: open\n\nThe  lease *body*,  byte for byte.\n')).toBe(true);
  });

  it('tells the panes to follow each move, never saving their typing (A20-06)', async () => {
    const api = apiFixture({ files: { 'Call.md': 'x\n' } });

    await api.send(archive(['Call.md']));

    // The API never saves typing for someone (ADR-0016); a pane with some is left alone instead.
    expect(api.flushed).toEqual([]);
    expect(api.followed).toEqual([{ from: 'Call.md', to: 'Archive/Call.md' }]);
  });

  it('rewrites the links each move leaves behind, and counts them', async () => {
    const api = apiFixture({
      files: {
        'Projects/Lease.md': 'lease\n',
        'Index.md': 'See [[Projects/Lease]].\n',
      },
    });

    const response = await api.send(archive(['Projects/Lease.md']));

    expect(bodyOf(response)['linksUpdated']).toBe(1);
    expect(api.files.get('Index.md')?.text).toBe('See [[Archive/Projects/Lease]].\n');
  });

  it('reports each path it will not archive, and archives the rest', async () => {
    const api = apiFixture({
      files: {
        'Call.md': 'x\n',
        '.atlas/types/Task.md': 'name: task\n',
        'Archive/Old.md': 'archived: 2026-01-01\n',
        'Projects/plan.txt': 'text\n',
        '.hidden/Note.md': 'hidden\n',
      },
    });

    const response = await api.send(
      archive([
        '.atlas/types/Task.md',
        'Projects/plan.txt',
        'Archive/Old.md',
        '../Outside.md',
        'Missing.md',
        '.hidden/Note.md',
        'Call.md',
      ]),
    );

    expect(response.status).toBe(200);
    const body = bodyOf(response);
    expect(body['moves']).toEqual([{ from: 'Call.md', to: 'Archive/Call.md' }]);
    const failed = body['failed'] as { path: string; reason: string }[];
    expect(failed.map((each) => each.path).sort()).toEqual(
      [
        '.atlas/types/Task.md',
        'Projects/plan.txt',
        'Archive/Old.md',
        '../Outside.md',
        'Missing.md',
        '.hidden/Note.md',
      ].sort(),
    );
    for (const each of failed) expect(each.reason).not.toBe('');
    // A path the API may not reach is told apart from one with nothing there.
    const reasonFor = (path: string) => failed.find((each) => each.path === path)?.reason;
    expect(reasonFor('.atlas/types/Task.md')).not.toBe(reasonFor('Missing.md'));
    expect(reasonFor('.hidden/Note.md')).not.toBe(reasonFor('Missing.md'));
    expect(api.files.get('.atlas/types/Task.md')?.text).toBe('name: task\n');
    expect(api.files.has('Archive/Old.md')).toBe(true);
    expect(api.files.get('.hidden/Note.md')?.text).toBe('hidden\n');
    expect(api.writes.map((write) => write.path)).toEqual(['Archive/Call.md']);
  });

  it('finds a note however the request cases it, and answers the vault spelling', async () => {
    const api = apiFixture({ files: { 'Projects/Lease.md': 'x\n' }, caseInsensitive: true });

    const response = await api.send(archive(['projects/lease.md']));

    expect(bodyOf(response)['moves']).toEqual([
      { from: 'Projects/Lease.md', to: 'Archive/Projects/Lease.md' },
    ]);
  });

  it('archives a path named twice once', async () => {
    const api = apiFixture({ files: { 'Call.md': 'x\n' } });

    const response = await api.send(archive(['Call.md', 'Call.md']));

    expect(bodyOf(response)['moves']).toEqual([{ from: 'Call.md', to: 'Archive/Call.md' }]);
    expect(bodyOf(response)['failed']).toEqual([]);
  });

  it.each([
    ['no body', null],
    ['a body that is not an object', ['Call.md']],
    ['no paths', {}],
    ['paths that are not a list', { paths: 'Call.md' }],
    ['an empty list', { paths: [] }],
    ['a path that is not text', { paths: ['Call.md', 7] }],
    [
      'more paths than one request may name',
      { paths: Array.from({ length: 101 }, (_, at) => `N${at}.md`) },
    ],
  ])('refuses %s as invalid, moving nothing', async (_, body) => {
    const api = apiFixture({ files: { 'Call.md': 'x\n' } });

    const response = await api.send({ method: 'POST', path: '/v1/archive', body });

    expect(codeOf(response)).toBe('invalid');
    expect(api.files.has('Call.md')).toBe(true);
  });

  it('refuses with no_vault when no vault is open', async () => {
    const api = apiFixture({ files: { 'Call.md': 'x\n' } });
    api.open = null;

    expect(codeOf(await api.send(archive(['Call.md'])))).toBe('no_vault');
  });
});

describe('POST /v1/unarchive', () => {
  it('puts a note back where it came from, without its stamps', async () => {
    const api = apiFixture({
      files: {
        'Archive/Projects/Lease.md':
          '---\narchived: 2026-09-01\narchivedFrom: Projects/Lease.md\nstatus: open\n---\nbody\n',
      },
    });

    const response = await api.send(unarchive(['Archive/Projects/Lease.md']));

    expect(bodyOf(response)).toEqual({
      moves: [{ from: 'Archive/Projects/Lease.md', to: 'Projects/Lease.md' }],
      failed: [],
      linksUpdated: 0,
    });
    const text = api.files.get('Projects/Lease.md')?.text ?? '';
    expect(text).not.toContain('archived');
    expect(text).toContain('status: open');
    expect(text.endsWith('body\n')).toBe(true);
  });

  it('reports a note that is not archived, or not reachable, and restores the rest', async () => {
    const api = apiFixture({
      files: {
        'Call.md': 'x\n',
        'Archive/Old.md': 'y\n',
        '.atlas/views/Board.md': 'z\n',
        'Archive/.obsidian/Note.md': 'w\n',
      },
    });

    const response = await api.send(
      unarchive([
        'Call.md',
        '.atlas/views/Board.md',
        'Archive/.obsidian/Note.md',
        'Archive/Old.md',
      ]),
    );

    const body = bodyOf(response);
    expect(body['moves']).toEqual([{ from: 'Archive/Old.md', to: 'Old.md' }]);
    expect((body['failed'] as { path: string }[]).map((each) => each.path).sort()).toEqual(
      ['Call.md', '.atlas/views/Board.md', 'Archive/.obsidian/Note.md'].sort(),
    );
    expect(api.files.has('Call.md')).toBe(true);
  });

  it('refuses a body without paths as invalid', async () => {
    const api = apiFixture();

    expect(codeOf(await api.send({ method: 'POST', path: '/v1/unarchive', body: {} }))).toBe(
      'invalid',
    );
  });
});

/** An index holding these archived rows, answering the Archive's query with its LIMIT and OFFSET. */
function archiveIndex(rows: readonly (readonly unknown[])[]) {
  const asked: (readonly unknown[])[] = [];
  return {
    asked,
    index: {
      query: async (_sql: string, parameters: readonly unknown[] = []) => {
        asked.push(parameters);
        const [limit, offset] = parameters.slice(-2) as [number, number];
        return {
          columns: ['path', 'title', 'archived', 'archivedFrom'],
          rows: rows.slice(offset, offset + limit),
          truncated: false,
        };
      },
    },
  };
}

const ROWS = [
  ['Archive/Projects/Lease.md', 'Lease', '2026-09-20', 'Projects/Lease.md'],
  ['Archive/Call.md', 'Call', '2026-09-10', 'Call.md'],
  ['Archive/Old.md', 'Old', null, null],
];

describe('GET /v1/archive', () => {
  it('lists archived notes with where each came from and the day it went', async () => {
    const { index } = archiveIndex(ROWS);
    const api = apiFixture({ index });

    const response = await api.send({ method: 'GET', path: '/v1/archive' });

    expect(bodyOf(response)).toEqual({
      notes: [
        {
          path: 'Archive/Projects/Lease.md',
          title: 'Lease',
          from: 'Projects/Lease.md',
          archivedOn: '2026-09-20',
        },
        { path: 'Archive/Call.md', title: 'Call', from: 'Call.md', archivedOn: '2026-09-10' },
        { path: 'Archive/Old.md', title: 'Old', from: 'Old.md', archivedOn: null },
      ],
      truncated: false,
      next: null,
    });
  });

  it('pages by offset, saying where the next page starts until there is none', async () => {
    const { index } = archiveIndex(ROWS);
    const api = apiFixture({ index });
    const page = (offset?: string) =>
      api.send({
        method: 'GET',
        path: '/v1/archive',
        query: { limit: '2', ...(offset !== undefined && { offset }) },
      });

    const first = bodyOf(await page());
    expect((first['notes'] as { path: string }[]).map((note) => note.path)).toEqual([
      'Archive/Projects/Lease.md',
      'Archive/Call.md',
    ]);
    expect(first).toMatchObject({ truncated: true, next: 2 });

    const second = bodyOf(await page('2'));
    expect((second['notes'] as { path: string }[]).map((note) => note.path)).toEqual([
      'Archive/Old.md',
    ]);
    expect(second).toMatchObject({ truncated: false, next: null });
  });

  it('says where the next page starts counting from the offset asked for', async () => {
    const api = apiFixture({ index: archiveIndex(ROWS).index });

    const response = await api.send({
      method: 'GET',
      path: '/v1/archive',
      query: { limit: '1', offset: '1' },
    });

    expect(bodyOf(response)).toMatchObject({
      notes: [expect.objectContaining({ path: 'Archive/Call.md' })],
      truncated: true,
      next: 2,
    });
  });

  it('hands the search to the index', async () => {
    const { index, asked } = archiveIndex([]);
    const api = apiFixture({ index });

    await api.send({ method: 'GET', path: '/v1/archive', query: { search: 'lease' } });

    expect(asked[0]?.some((value) => typeof value === 'string' && value.includes('[lL]'))).toBe(
      true,
    );
  });

  it.each([
    [{ limit: '0' }],
    [{ limit: '501' }],
    [{ limit: 'ten' }],
    [{ offset: '-1' }],
    [{ offset: '1.5' }],
  ])('refuses %j as invalid', async (query) => {
    const api = apiFixture({ index: archiveIndex(ROWS).index });

    expect(codeOf(await api.send({ method: 'GET', path: '/v1/archive', query }))).toBe('invalid');
  });
});

describe('includeArchived', () => {
  const hits = [
    { path: 'Call.md', title: 'Call', snippet: '<<x>>' },
    { path: 'Archive/Old.md', title: 'Old', snippet: '<<x>>' },
  ];

  function searchIndex() {
    const scopes: (SearchScope | undefined)[] = [];
    return {
      scopes,
      index: {
        search: async (_query: string, _limit: number, scope?: SearchScope) => {
          scopes.push(scope);
          return scope?.skipPrefix === undefined ? hits : hits.slice(0, 1);
        },
      },
    };
  }

  it('leaves the Archive out of search unless asked', async () => {
    const { index, scopes } = searchIndex();
    const api = apiFixture({ index });

    const response = await api.send({ method: 'GET', path: '/v1/search', query: { q: 'x' } });

    expect(scopes[0]).toEqual({ skipPrefix: 'archive/' });
    expect(bodyOf(response)['hits']).toEqual([
      { path: 'Call.md', title: 'Call', snippet: '<<x>>' },
    ]);
  });

  it('searches the Archive too when asked, marking each archived hit', async () => {
    const { index, scopes } = searchIndex();
    const api = apiFixture({ index });

    const response = await api.send({
      method: 'GET',
      path: '/v1/search',
      query: { q: 'x', includeArchived: 'true' },
    });

    expect(scopes[0]).toEqual({});
    expect(bodyOf(response)['hits']).toEqual([
      { path: 'Call.md', title: 'Call', snippet: '<<x>>' },
      { path: 'Archive/Old.md', title: 'Old', snippet: '<<x>>', archived: true },
    ]);
  });

  it('refuses an includeArchived that is not true or false', async () => {
    const api = apiFixture({ index: searchIndex().index });

    const response = await api.send({
      method: 'GET',
      path: '/v1/search',
      query: { q: 'x', includeArchived: 'yes' },
    });

    expect(codeOf(response)).toBe('invalid');
  });

  function viewIndex() {
    const statements: string[] = [];
    return {
      statements,
      index: {
        query: async (sql: string) => {
          statements.push(sql);
          return { columns: ['path'], rows: [], truncated: false };
        },
      },
    };
  }

  const VIEW = { '.atlas/views/Tasks.md': jsonNote({ atlas: 'view', type: 'task' }) };
  const outsideArchive = /'archive\/'/;

  it.each([
    ['a saved view', `/v1/views/${encoded('.atlas/views/Tasks.md')}/run`, {}],
    ['a query', '/v1/query', { type: 'task' }],
  ])('leaves the Archive out of %s unless asked', async (_, path, body) => {
    const { index, statements } = viewIndex();
    const api = apiFixture({ files: VIEW, index, markdown: jsonMarkdown() });

    await api.send({ method: 'POST', path, body });
    await api.send({ method: 'POST', path, body: { ...body, includeArchived: true } });

    expect(statements).toHaveLength(2);
    expect(statements[0]).toMatch(outsideArchive);
    expect(statements[1]).not.toMatch(outsideArchive);
  });

  it('refuses an includeArchived in a view body that is not a boolean', async () => {
    const api = apiFixture({ files: VIEW, index: viewIndex().index, markdown: jsonMarkdown() });

    const response = await api.send({
      method: 'POST',
      path: `/v1/views/${encoded('.atlas/views/Tasks.md')}/run`,
      body: { includeArchived: 'true' },
    });

    expect(codeOf(response)).toBe('invalid');
  });
});
