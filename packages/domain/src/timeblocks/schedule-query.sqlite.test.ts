import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { indexablePropertiesOf } from '../index/property-value.ts';
import { relationsOf } from '../index/relation-rows.ts';
import { resolveWikiLinkTarget } from '../markdown/resolve-wikilink.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  compileScheduledTasksQuery,
  compileTimeblocksQuery,
  scheduledTaskOf,
  TASK_SCHEDULE_QUERY_MARK,
  timeBlocksOf,
  type FinishedStatus,
  type ScheduledTaskRow,
  type TimeblockRow,
} from './schedule-query.ts';
import { scheduledMinutesByTask } from './scheduling.ts';

/** P31-01: what the schedule reads from the index, run for real against SQLite. */
type Notes = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

function indexOf(notes: Notes): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
      target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);`);
  const paths = Object.keys(notes).map(createVaultPath);
  const resolve = (target: string) => resolveWikiLinkTarget(target, paths);
  for (const [path, frontmatter] of Object.entries(notes)) {
    database.prepare('INSERT INTO files VALUES (?, ?)').run(path, path);
    for (const row of indexablePropertiesOf(frontmatter)) {
      database
        .prepare('INSERT INTO props VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(path, row.key, row.index, row.text, row.number, row.date, row.json);
    }
    for (const relation of relationsOf(frontmatter, resolve)) {
      database
        .prepare('INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?)')
        .run(path, relation.key, relation.index, relation.target, relation.name, relation.path);
    }
  }
  return database;
}

const GTD_FINISHED: FinishedStatus = { key: 'status', value: 'archive' };

function readSchedule(
  notes: Notes,
  paths: readonly string[],
  finished: FinishedStatus | null = GTD_FINISHED,
) {
  const database = indexOf(notes);
  const tasks = compileScheduledTasksQuery({ paths, finished });
  const blocks = compileTimeblocksQuery({ paths, finished });
  return {
    tasks: (
      database.prepare(tasks.sql).all(...tasks.parameters) as unknown as ScheduledTaskRow[]
    ).map(scheduledTaskOf),
    blocks: timeBlocksOf(
      database.prepare(blocks.sql).all(...blocks.parameters) as unknown as TimeblockRow[],
    ),
  };
}

const REPORT = { type: 'task', status: 'next-action', estimate: 120 };
const block = (start: string, end: string, tasks: readonly string[]) => ({
  type: 'block',
  start,
  end,
  tasks: tasks.map((name) => `[[${name}]]`),
});

it('marks both questions, so a stand-in for the host can answer them', () => {
  for (const compile of [compileScheduledTasksQuery, compileTimeblocksQuery]) {
    expect(
      compile({ paths: ['a.md'], finished: null }).sql.startsWith(TASK_SCHEDULE_QUERY_MARK),
    ).toBe(true);
  }
});

describe('compileScheduledTasksQuery', () => {
  it('reads each task asked for with its estimate and whether it is finished', () => {
    const { tasks } = readSchedule(
      {
        'tasks/Report.md': REPORT,
        'tasks/Call.md': { type: 'Task', status: 'archive', estimate: '30m' },
        'tasks/Vague.md': { type: 'task', status: 'inbox' },
        'tasks/Not asked.md': REPORT,
      },
      ['tasks/Report.md', 'tasks/Call.md', 'tasks/Vague.md'],
    );

    expect(tasks).toEqual([
      { path: 'tasks/Call.md', estimate: 30, finished: true },
      { path: 'tasks/Report.md', estimate: 120, finished: false },
      { path: 'tasks/Vague.md', estimate: null, finished: false },
    ]);
  });

  it('leaves out a note that is not a task, and one that is not there', () => {
    const { tasks } = readSchedule({ 'Atlas.md': { type: 'project', estimate: 60 } }, [
      'Atlas.md',
      'Gone.md',
    ]);
    expect(tasks).toEqual([]);
  });

  it('reads finished by the status the Task type is ticked with, or never when it has none', () => {
    const notes = { 'tasks/Old.md': { type: 'task', phase: 'shipped', estimate: 60 } };
    const shipped = { key: 'phase', value: 'shipped' };
    expect(readSchedule(notes, ['tasks/Old.md'], shipped).tasks[0]?.finished).toBe(true);
    expect(readSchedule(notes, ['tasks/Old.md'], GTD_FINISHED).tasks[0]?.finished).toBe(false);
    expect(readSchedule(notes, ['tasks/Old.md'], null).tasks[0]?.finished).toBe(false);
  });

  it('reads no estimate from a list of them', () => {
    const { tasks } = readSchedule({ 't.md': { type: 'task', estimate: [30, 60] } }, ['t.md']);
    expect(tasks[0]?.estimate).toBeNull();
  });
});

describe('compileTimeblocksQuery', () => {
  it('reads every block linking a task asked for, with all the tasks each links, in order', () => {
    const notes = {
      'tasks/Report.md': REPORT,
      'tasks/Call.md': { type: 'task', status: 'next-action', estimate: 20 },
      'tasks/Reply.md': { type: 'task', status: 'archive', estimate: 20 },
      'blocks/Morning.md': block('2026-10-12T09:00', '2026-10-12T10:00', ['Report']),
      'blocks/Admin.md': block('2026-10-12T13:00', '2026-10-12T14:00', ['Reply', 'Call', 'Report']),
      'blocks/Elsewhere.md': block('2026-10-12T15:00', '2026-10-12T16:00', ['Call']),
    };

    const { blocks } = readSchedule(notes, ['tasks/Report.md']);

    expect(blocks).toEqual([
      {
        path: 'blocks/Admin.md',
        start: '2026-10-12T13:00',
        end: '2026-10-12T14:00',
        tasks: [
          { path: 'tasks/Reply.md', estimate: 20, finished: true },
          { path: 'tasks/Call.md', estimate: 20, finished: false },
          { path: 'tasks/Report.md', estimate: 120, finished: false },
        ],
      },
      {
        path: 'blocks/Morning.md',
        start: '2026-10-12T09:00',
        end: '2026-10-12T10:00',
        tasks: [{ path: 'tasks/Report.md', estimate: 120, finished: false }],
      },
    ]);
    // Admin's hour is shared 20 : 120 by what Call and Report have left; Reply is finished.
    expect(Object.fromEntries(scheduledMinutesByTask(blocks))).toEqual({
      'tasks/Reply.md': 0,
      'tasks/Call.md': 9,
      'tasks/Report.md': 60 + 51,
    });
  });

  it('counts only links to tasks: a link to another type, or to nothing, is no task of the block’s', () => {
    const notes = {
      'tasks/Report.md': REPORT,
      'Atlas.md': { type: 'project' },
      'blocks/Focus.md': block('2026-10-12T09:00', '2026-10-12T10:00', ['Report', 'Atlas', 'Gone']),
    };

    const { blocks } = readSchedule(notes, ['tasks/Report.md']);

    expect(blocks.map((each) => each.tasks.map((task) => task.path))).toEqual([
      ['tasks/Report.md'],
    ]);
    expect(scheduledMinutesByTask(blocks).get('tasks/Report.md')).toBe(60);
  });

  it('reads only blocks: another note linking tasks under the same key is no block', () => {
    const notes = {
      'tasks/Report.md': REPORT,
      'Atlas.md': { type: 'project', tasks: ['[[Report]]'] },
    };
    expect(readSchedule(notes, ['tasks/Report.md']).blocks).toEqual([]);
  });

  it('leaves out a Block template in .atlas, and reads a block whose type is written in capitals', () => {
    const notes = {
      'tasks/Report.md': REPORT,
      '.atlas/templates/Block.md': block('2026-10-12T09:00', '2026-10-12T10:00', ['Report']),
      'blocks/Focus.md': {
        ...block('2026-10-12T11:00', '2026-10-12T12:00', ['Report']),
        type: 'Block',
      },
    };

    const { blocks } = readSchedule(notes, ['tasks/Report.md']);

    expect(blocks.map((each) => each.path)).toEqual(['blocks/Focus.md']);
  });

  it('reads a block’s start written as a list as no start, so it gives no time', () => {
    const notes = {
      'tasks/Report.md': REPORT,
      'blocks/Odd.md': {
        ...block('2026-10-12T09:00', '2026-10-12T10:00', ['Report']),
        start: ['2026-10-12T09:00', '2026-10-12T09:30'],
      },
    };

    const { blocks } = readSchedule(notes, ['tasks/Report.md']);

    expect(blocks[0]?.start).toBeNull();
    expect(scheduledMinutesByTask(blocks).get('tasks/Report.md')).toBe(0);
  });

  it('reads nothing when no block links the tasks asked for, or none are asked for', () => {
    const notes = {
      'tasks/Report.md': REPORT,
      'blocks/Focus.md': block('2026-10-12T09:00', '2026-10-12T10:00', ['Report']),
    };
    expect(readSchedule(notes, ['tasks/Other.md']).blocks).toEqual([]);
    expect(readSchedule(notes, []).blocks).toEqual([]);
  });
});
