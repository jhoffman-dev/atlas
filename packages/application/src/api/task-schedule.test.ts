/**
 * P31-01 (API keeper): blocks are notes, and a query of tasks can read each
 * task's schedule — estimate, scheduled, done and over — as the task's page
 * shows it. The schedule's own questions run for real against SQLite.
 */
import { describe, expect, it } from 'vitest';
import { TASK_SCHEDULE_QUERY_MARK } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { apiFixture, bodyOf, codeOf } from '../testing/api-fixture.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';

const TASK_TYPE = jsonNote({
  name: 'task',
  label: 'Task',
  properties: {
    status: { kind: 'select', options: ['next-action', 'archive'], done: 'archive' },
    estimate: 'number',
  },
});

const task = (estimate: number, status = 'next-action') =>
  jsonNote({ type: 'task', status, estimate });
const block = (start: string, end: string, ...tasks: string[]) =>
  jsonNote({ type: 'block', start, end, tasks: tasks.map((name) => `[[${name}]]`) });

const FILES: Record<string, string> = {
  '.atlas/types/task.md': TASK_TYPE,
  'tasks/Quarterly report.md': task(120),
  'tasks/Invoice Larkspur.md': task(20),
  'tasks/Call Mara.md': task(20),
  'tasks/Reply to Tobias.md': task(20, 'archive'),
  'blocks/Monday.md': block('2026-10-12T09:00', '2026-10-12T10:00', 'Quarterly report'),
  'blocks/Tuesday.md': block('2026-10-13T14:00', '2026-10-13T14:30', 'Quarterly report'),
  'blocks/Late.md': block('2026-10-14T23:45', '2026-10-15T00:15', 'Quarterly report'),
  'blocks/Admin.md': block(
    '2026-10-12T13:00',
    '2026-10-12T14:00',
    'Invoice Larkspur',
    'Call Mara',
    'Reply to Tobias',
  ),
  'blocks/Call slot.md': block('2026-10-12T16:00', '2026-10-12T16:30', 'Call Mara'),
};

/** The view's rows as the index would give them; the schedule's questions asked of SQLite. */
function scheduleIndex(
  viewRows: readonly string[],
  files: Record<string, string> = FILES,
): Pick<IndexPort, 'query'> {
  const real = atlasQueryIndex({ files, markdown: jsonMarkdown() });
  return {
    query: async (sql, parameters) =>
      sql.startsWith(TASK_SCHEDULE_QUERY_MARK)
        ? real(sql, parameters)
        : {
            columns: ['path', 'title'],
            rows: viewRows.map((path) => [path, path.replace(/^.*\/|\.md$/g, '')]),
            truncated: false,
          },
  };
}

const send = (body: unknown, index: Pick<IndexPort, 'query'> = scheduleIndex([])) =>
  apiFixture({ files: FILES, markdown: jsonMarkdown(), index }).send({
    method: 'POST',
    path: '/v1/query',
    body,
  });

describe('POST /v1/query with schedule', () => {
  it('adds each task’s schedule as a last column', async () => {
    const index = scheduleIndex([
      'tasks/Quarterly report.md',
      'tasks/Invoice Larkspur.md',
      'tasks/Call Mara.md',
      'tasks/Reply to Tobias.md',
    ]);

    const response = await send({ type: 'task', schedule: true }, index);

    expect(response.status).toBe(200);
    const body = bodyOf(response);
    expect(body['columns']).toEqual(['path', 'title', 'schedule']);
    expect((body['rows'] as unknown[][]).map((row) => [row[0], row[2]])).toEqual([
      ['tasks/Quarterly report.md', { estimate: 120, scheduled: 120, done: 0, overBy: 0 }],
      ['tasks/Invoice Larkspur.md', { estimate: 20, scheduled: 20, done: 0, overBy: 0 }],
      ['tasks/Call Mara.md', { estimate: 20, scheduled: 50, done: 0, overBy: 30 }],
      ['tasks/Reply to Tobias.md', { estimate: 20, scheduled: 0, done: 20, overBy: 0 }],
    ]);
  });

  it('answers the rows as they are without it', async () => {
    const response = await send({ type: 'task' }, scheduleIndex(['tasks/Call Mara.md']));
    expect(bodyOf(response)['columns']).toEqual(['path', 'title']);
  });

  it('reads the type in any case', async () => {
    const response = await send(
      { type: 'Task', schedule: true },
      scheduleIndex(['tasks/Call Mara.md']),
    );
    expect(response.status).toBe(200);
  });

  it('refuses it on a query of another type, which has nothing to schedule', async () => {
    const response = await send({ type: 'block', schedule: true });
    expect(codeOf(response)).toBe('invalid');
    expect(bodyOf(response)['error']).toMatchObject({
      message: 'schedule is for a query of tasks, not block',
    });
  });

  it('refuses it beside a column the schedule would hide', async () => {
    const response = await send({ type: 'task', columns: ['schedule'], schedule: true });
    expect(codeOf(response)).toBe('invalid');
  });

  it('refuses a schedule that is not true or false', async () => {
    expect(codeOf(await send({ type: 'task', schedule: 'yes' }))).toBe('invalid');
  });

  it('is query_failed, never a short answer, when the index cuts the schedule short', async () => {
    const index: Pick<IndexPort, 'query'> = {
      query: async (sql) => ({
        columns: ['path', 'title'],
        rows: [['tasks/Call Mara.md', 'Call Mara']],
        truncated: sql.startsWith(TASK_SCHEDULE_QUERY_MARK),
      }),
    };
    const response = await send({ type: 'task', schedule: true }, index);
    expect(codeOf(response)).toBe('query_failed');
  });

  it('is query_failed when the index cannot read the schedule, without the vault’s paths', async () => {
    const index: Pick<IndexPort, 'query'> = {
      query: async (sql) => {
        if (sql.startsWith(TASK_SCHEDULE_QUERY_MARK)) {
          throw new Error('database is locked at /Users/j/Vault/.atlas/index.db');
        }
        return {
          columns: ['path', 'title'],
          rows: [['tasks/Call Mara.md', 'Call Mara']],
          truncated: false,
        };
      },
    };
    const response = await send({ type: 'task', schedule: true }, index);
    expect(codeOf(response)).toBe('query_failed');
    expect(JSON.stringify(bodyOf(response))).not.toContain('/Users/j');
  });
});
