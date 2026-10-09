/**
 * P31-01: each task's estimate, scheduled and done, read from an index built
 * from the notes the way refreshing it builds it, so the compiled queries run
 * for real against SQLite.
 */
import { describe, expect, it } from 'vitest';
import { GTD_STATUS_PROPERTY, type ObjectType } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { jsonMarkdown, jsonNote } from '../testing/json-markdown.ts';
import { readTaskSchedules, ScheduleIncompleteError } from './task-schedules.ts';

const GTD_TASK: ObjectType = { name: 'task', label: 'Task', properties: [GTD_STATUS_PROPERTY] };

const indexOf = (notes: Record<string, unknown>) => {
  const files = Object.fromEntries(
    Object.entries(notes).map(([path, frontmatter]) => [path, jsonNote(frontmatter)]),
  );
  return { query: atlasQueryIndex({ files, markdown: jsonMarkdown() }) };
};

const task = (estimate: unknown, status = 'next-action') => ({ type: 'task', status, estimate });
const block = (start: string, end: string, ...tasks: string[]) => ({
  type: 'block',
  start,
  end,
  tasks: tasks.map((name) => `[[${name}]]`),
});

describe('readTaskSchedules', () => {
  it('reads a 2h task split over three blocks as 2h scheduled of 2h', async () => {
    const index = indexOf({
      'tasks/Quarterly report.md': task(120),
      'blocks/Monday.md': block('2026-10-12T09:00', '2026-10-12T10:00', 'Quarterly report'),
      'blocks/Tuesday.md': block('2026-10-13T14:00', '2026-10-13T14:30', 'Quarterly report'),
      'blocks/Wednesday.md': block('2026-10-14T16:30', '2026-10-14T17:00', 'Quarterly report'),
    });

    const schedules = await readTaskSchedules({
      index,
      paths: ['tasks/Quarterly report.md'],
      taskType: GTD_TASK,
    });

    expect(schedules.get('tasks/Quarterly report.md')).toEqual({
      estimate: 120,
      scheduled: 120,
      done: 0,
      overBy: 0,
    });
  });

  it('shares a container among all its tasks, asked about or not, and reports over-scheduling', async () => {
    const index = indexOf({
      'tasks/Invoice Larkspur.md': task(20),
      'tasks/Call Mara.md': task(20),
      'tasks/Reply to Tobias.md': task(20),
      'tasks/Draft.md': task(30),
      'blocks/Admin.md': block(
        '2026-10-12T13:00',
        '2026-10-12T14:00',
        'Invoice Larkspur',
        'Call Mara',
        'Reply to Tobias',
      ),
      'blocks/Focus.md': block('2026-10-12T09:00', '2026-10-12T10:00', 'Draft'),
    });

    const schedules = await readTaskSchedules({
      index,
      paths: ['tasks/Call Mara.md', 'tasks/Draft.md'],
      taskType: GTD_TASK,
    });

    expect(Object.fromEntries(schedules)).toEqual({
      'tasks/Call Mara.md': { estimate: 20, scheduled: 20, done: 0, overBy: 0 },
      'tasks/Draft.md': { estimate: 30, scheduled: 60, done: 0, overBy: 30 },
    });
  });

  it('reads a task in no block as scheduled for nothing, and leaves out what is not a task', async () => {
    const index = indexOf({ 'tasks/Later.md': task('1h30m'), 'Atlas.md': { type: 'project' } });

    const schedules = await readTaskSchedules({
      index,
      paths: ['tasks/Later.md', 'Atlas.md'],
      taskType: GTD_TASK,
    });

    expect(Object.fromEntries(schedules)).toEqual({
      'tasks/Later.md': { estimate: 90, scheduled: 0, done: 0, overBy: 0 },
    });
  });

  it('reads done by the status the vault’s Task type is ticked with', async () => {
    const index = indexOf({
      'tasks/Shipped.md': task(60, 'done'),
      'tasks/Archived.md': task(60, 'archive'),
    });
    const ownTask: ObjectType = {
      name: 'task',
      label: 'Task',
      properties: [{ ...GTD_STATUS_PROPERTY, options: ['backlog', 'done'], done: 'done' }],
    };
    const paths = ['tasks/Shipped.md', 'tasks/Archived.md'];

    const own = await readTaskSchedules({ index, paths, taskType: ownTask });
    const gtd = await readTaskSchedules({ index, paths, taskType: GTD_TASK });
    const none = await readTaskSchedules({ index, paths, taskType: null });

    expect([own, gtd, none].map((each) => paths.map((path) => each.get(path)?.done))).toEqual([
      [60, 0],
      [0, 60],
      [0, 0],
    ]);
  });

  it('reads tasks a page at a time, so any number can be asked about', async () => {
    const notes: Record<string, unknown> = {};
    const paths: string[] = [];
    for (let at = 0; at < 450; at += 1) {
      notes[`tasks/Task ${at}.md`] = task(30);
      paths.push(`tasks/Task ${at}.md`);
    }
    notes['blocks/Last.md'] = block('2026-10-12T09:00', '2026-10-12T10:00', 'Task 449');
    const asked: number[] = [];
    const real = indexOf(notes);
    const index: Pick<IndexPort, 'query'> = {
      query: async (sql, parameters) => {
        asked.push(parameters.filter((value) => String(value).startsWith('tasks/')).length);
        return real.query(sql, parameters);
      },
    };

    const schedules = await readTaskSchedules({ index, paths, taskType: GTD_TASK });

    expect(schedules.size).toBe(450);
    expect(schedules.get('tasks/Task 449.md')).toMatchObject({ scheduled: 60, overBy: 30 });
    // Two questions a page — the tasks, then their blocks — of 200, 200 and 50 tasks.
    expect(asked).toEqual([200, 200, 200, 200, 50, 50]);
  });

  it('asks nothing when no task is asked about', async () => {
    const index = { query: async () => Promise.reject(new Error('not asked')) };
    expect((await readTaskSchedules({ index, paths: [], taskType: GTD_TASK })).size).toBe(0);
  });

  it('refuses a schedule the index cut short, rather than answering it wrong', async () => {
    const index: Pick<IndexPort, 'query'> = {
      query: async () => ({ columns: ['path'], rows: [], truncated: true }),
    };
    await expect(
      readTaskSchedules({ index, paths: ['tasks/Draft.md'], taskType: GTD_TASK }),
    ).rejects.toBeInstanceOf(ScheduleIncompleteError);
  });

  it('passes on a query the index could not run', async () => {
    const index = { query: async () => Promise.reject(new Error('the index is busy')) };
    await expect(
      readTaskSchedules({ index, paths: ['tasks/Draft.md'], taskType: GTD_TASK }),
    ).rejects.toThrow('the index is busy');
  });
});
