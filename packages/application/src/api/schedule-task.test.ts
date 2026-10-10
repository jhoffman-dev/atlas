/**
 * P31-02 (API keeper): POST /v1/tasks/schedule makes a block for a task, as a
 * task let go on the calendar's empty time does in the app. The schedule a
 * block is sized by is read for real against SQLite.
 */
import { describe, expect, it } from 'vitest';
import { TASK_SCHEDULE_QUERY_MARK } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { apiFixture, bodyOf, codeOf, TODAY } from '../testing/api-fixture.ts';
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

const task = (estimate: number) => jsonNote({ type: 'task', status: 'next-action', estimate });

const FILES: Record<string, string> = {
  '.atlas/types/task.md': TASK_TYPE,
  'Quarterly report.md': task(120),
  'Call Mara.md': task(20),
  'Admin.md': jsonNote({
    type: 'block',
    start: '2026-10-12T09:00',
    end: '2026-10-12T10:00',
    tasks: ['[[Quarterly report]]'],
  }),
  'Notes/Lease.md': jsonNote({ type: 'note' }),
};

/** The schedule's questions answered by SQLite over the files. */
function scheduleIndex(files: Record<string, string>): Pick<IndexPort, 'query'> {
  const real = atlasQueryIndex({ files, markdown: jsonMarkdown() });
  return {
    query: async (sql, parameters) =>
      sql.startsWith(TASK_SCHEDULE_QUERY_MARK)
        ? real(sql, parameters)
        : { columns: [], rows: [], truncated: false },
  };
}

function fixture(files: Record<string, string> = FILES) {
  return apiFixture({ files, markdown: jsonMarkdown(), index: scheduleIndex(files) });
}

const schedule = (api: ReturnType<typeof fixture>, body: unknown) =>
  api.send({ method: 'POST', path: '/v1/tasks/schedule', body });

const written = (api: ReturnType<typeof fixture>, path: string) => api.files.get(path)?.text;

describe('POST /v1/tasks/schedule', () => {
  it('makes a block for the task from the start for the minutes asked, and answers it', async () => {
    const api = fixture();

    const response = await schedule(api, {
      task: 'Call Mara.md',
      start: '2026-10-13T14:00',
      minutes: 45,
    });

    expect(response.status).toBe(201);
    expect(bodyOf(response)['note']).toMatchObject({ path: 'Call Mara block.md', type: 'block' });
    expect(written(api, 'Call Mara block.md')).toBe(
      [
        '---',
        'type: block',
        'start: 2026-10-13T14:00',
        'end: 2026-10-13T14:45',
        'tasks: [[Call Mara]]',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('sizes the block to what the task still needs when no minutes are asked', async () => {
    const api = fixture();

    // Two hours estimated, one already set aside in Admin: an hour from 23:30.
    const response = await schedule(api, {
      task: 'Quarterly report.md',
      start: '2026-10-14T23:30',
    });

    expect(response.status).toBe(201);
    expect(written(api, 'Quarterly report block.md')).toContain(
      'start: 2026-10-14T23:30\nend: 2026-10-15T00:30\n',
    );
  });

  it('starts from the Block template when the vault has one', async () => {
    const api = fixture({
      ...FILES,
      '.atlas/templates/Block.md': '---\ncolour: teal\n---\n## Agenda\n',
    });

    await schedule(api, { task: 'Call Mara.md', start: '2026-10-13T14:00', minutes: 20 });

    expect(written(api, 'Call Mara block.md')).toBe(
      [
        '---',
        'colour: teal',
        'type: block',
        'start: 2026-10-13T14:00',
        'end: 2026-10-13T14:20',
        'tasks: [[Call Mara]]',
        '---',
        '## Agenda',
        '',
      ].join('\n'),
    );
  });

  it('numbers a second block for the same task, splitting it', async () => {
    const api = fixture({ ...FILES, 'Call Mara block.md': jsonNote({ type: 'block' }) });

    const response = await schedule(api, {
      task: 'Call Mara.md',
      start: '2026-10-13T14:00',
      minutes: 10,
    });

    expect(bodyOf(response)['note']).toMatchObject({ path: 'Call Mara block 2.md' });
  });

  it.each([
    [{ start: '2026-10-13T14:00' }, /task/],
    [{ task: 'Call Mara.md' }, /start/],
    [{ task: 'Call Mara.md', start: '2026-10-13' }, /wall-clock time to the minute/],
    [{ task: 'Call Mara.md', start: '2026-02-30T09:00', minutes: 30 }, /needs a day and a time/],
    [{ task: 'Call Mara.md', start: 'tomorrow', minutes: 30 }, /wall-clock time to the minute/],
    [{ task: 'Call Mara.md', start: '2026-10-13T14:00', minutes: 0 }, /minutes/],
    [{ task: 'Call Mara.md', start: '2026-10-13T14:00', minutes: 1441 }, /minutes/],
    [{ task: 'Call Mara.md', start: '2026-10-13T14:00', minutes: 2.5 }, /minutes/],
    [{ task: 'Notes/Lease.md', start: '2026-10-13T14:00' }, /not one/],
    [{ task: '.atlas/types/task.md', start: '2026-10-13T14:00' }, /task/],
  ])('refuses %j as invalid, and makes nothing', async (body, message) => {
    const api = fixture();

    const response = await schedule(api, body);

    expect(codeOf(response)).toBe('invalid');
    expect((response.body as { error: { message: string } }).error.message).toMatch(message);
    expect(api.writes).toEqual([]);
  });

  // Adversarial (P31-02): a start written with a zone names another moment than
  // its wall-clock digits. An agent's `toISOString()` is UTC; written as local
  // time, the block silently lands hours away from when it was asked for.
  it.each([
    '2026-10-13T14:00Z',
    '2026-10-13T14:00:00.000Z',
    '2026-10-13T14:00-07:00',
    '2026-10-13T14:00 or so',
  ])(
    'refuses a start of %j, which is not wall-clock time, rather than misplace the block',
    async (start) => {
      const api = fixture();

      const response = await schedule(api, { task: 'Call Mara.md', start, minutes: 30 });

      expect(codeOf(response)).toBe('invalid');
      expect(api.writes).toEqual([]);
    },
  );

  it('says why a start with a zone is refused', async () => {
    const api = fixture();

    const response = await schedule(api, {
      task: 'Call Mara.md',
      start: '2026-10-13T14:00Z',
      minutes: 30,
    });

    expect((response.body as { error: { message: string } }).error.message).toMatch(
      /wall-clock time to the minute, written 2026-10-12T09:00, with no seconds, zone or offset/,
    );
  });

  it('is not_found for a task that is not there', async () => {
    const api = fixture();

    const response = await schedule(api, { task: 'Gone.md', start: '2026-10-13T14:00' });

    expect(codeOf(response)).toBe('not_found');
    expect(api.writes).toEqual([]);
  });

  it('is a write, said in the Activity log', async () => {
    const api = fixture();

    await schedule(api, { task: 'Call Mara.md', start: '2026-10-13T14:00', minutes: 20 });

    expect(api.activity.reports.map((report) => report.message).join('\n')).toMatch(
      /tasks\/schedule/,
    );
  });

  it('dates nothing: a block is no task, so the task rules leave it as asked', async () => {
    const api = fixture();

    await schedule(api, { task: 'Call Mara.md', start: '2026-10-13T14:00', minutes: 20 });

    expect(written(api, 'Call Mara block.md')).not.toContain(TODAY);
  });
});
