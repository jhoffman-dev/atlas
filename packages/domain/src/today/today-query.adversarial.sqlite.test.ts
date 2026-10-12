import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { indexablePropertiesOf } from '../index/property-value.ts';
import {
  compileReviewProjectsQuery,
  compileReviewTasksQuery,
  reviewProject,
  reviewTask,
} from '../review/review-query.ts';
import type { ReviewTask } from '../review/weekly-review.ts';
import { todayLists } from './today-lists.ts';

/**
 * Adversarial pass on #111 (Today page): the page's two statements run
 * against the index as the host makes it — the same tables and the same
 * indexes (`apps/desktop/src-tauri/src/index.rs`), which never runs ANALYZE.
 * The page asks them again after every change to a file while it is open, its
 * own row actions included, so what they cost is paid on every tick.
 */
function hostIndex() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      modified INTEGER NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL DEFAULT '',
      note_type TEXT, progress INTEGER);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE INDEX props_path ON props(path);
    CREATE INDEX props_key ON props(key, value_text);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
      target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);
    CREATE INDEX relations_src ON relations(src, key);
    CREATE INDEX relations_dst ON relations(dst);
  `);
  return database;
}

const TODAY = '2026-10-12';
const NOW = Date.UTC(2026, 9, 12, 16);
const STATUSES = ['next-action', 'in-progress', 'waiting', 'backlog', 'someday', 'inbox'];
const PROJECTS = 100;

/** A vault of `tasks` open tasks, as many other notes, and a hundred projects. */
function fill(database: DatabaseSync, tasks: number): void {
  const file = database.prepare(
    'INSERT INTO files (path, title, modified, size) VALUES (?, ?, ?, 0)',
  );
  const prop = database.prepare(
    'INSERT INTO props (path, key, idx, value_text, value_date) VALUES (?, ?, ?, ?, ?)',
  );
  const relation = database.prepare('INSERT INTO relations VALUES (?, ?, 0, ?, ?, ?)');
  database.exec('BEGIN');
  for (let at = 0; at < PROJECTS; at += 1) {
    const path = `Projects/Project ${at}.md`;
    file.run(path, `Project ${at}`, NOW);
    prop.run(path, 'type', 0, 'project', null);
    prop.run(path, 'status', 0, 'active', null);
  }
  for (let at = 0; at < tasks; at += 1) {
    const path = `Tasks/Task ${at}.md`;
    const day = `2026-10-${String(1 + (at % 28)).padStart(2, '0')}`;
    file.run(path, `Task ${at}`, NOW - (at % 40) * 86_400_000);
    prop.run(path, 'type', 0, 'task', null);
    prop.run(path, 'status', 0, STATUSES[at % STATUSES.length] ?? null, null);
    if (at % 3 === 0) prop.run(path, 'due', 0, day, day);
    if (at % 5 === 0) prop.run(path, 'defer', 0, day, day);
    prop.run(path, 'waiting_on', 0, at % 2 === 0 ? 'Mara Quill' : 'Tobias Fenn', null);
    prop.run(path, 'contexts', 0, '@office', null);
    prop.run(path, 'contexts', 1, '@calls', null);
    prop.run(path, 'estimate', 0, '30', null);
    const project = `Projects/Project ${at % PROJECTS}.md`;
    if (at % 4 !== 0) relation.run(path, 'project', `Project ${at % PROJECTS}`, '', project);

    const other = `Notes/Note ${at}.md`;
    file.run(other, `Note ${at}`, NOW);
    prop.run(other, 'type', 0, at % 2 === 0 ? 'meeting' : 'note', null);
    prop.run(other, 'status', 0, 'final', null);
    prop.run(other, 'due', 0, day, day);
  }
  database.exec('COMMIT');
}

function timedRead(database: DatabaseSync, runs: number) {
  const tasks = compileReviewTasksQuery();
  const projects = compileReviewProjectsQuery();
  const tasksStatement = database.prepare(tasks.sql);
  const projectsStatement = database.prepare(projects.sql);
  let quickest = Infinity;
  let read = { tasks: 0, projects: 0 };
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    read = {
      tasks: tasksStatement.all(...tasks.parameters).length,
      projects: projectsStatement.all(...projects.parameters).length,
    };
    quickest = Math.min(quickest, performance.now() - started);
  }
  return { quickest, read };
}

/**
 * Measured at 5,000 open tasks on 2026-10-12 (a loaded Mac): 188,536 ms as
 * hosted against 67 ms once ANALYZE had run — every correlated read of `props`
 * goes by `props_key (key=?)`, all the rows of that key, for each task. The
 * test asks a fifth of that so it fails in seconds, not minutes.
 */
const OPEN_TASKS = 1000;

describe('the Today page’s read on a vault of 1,000 open tasks', () => {
  it(
    'costs what its rows cost, without statistics the index never gathers',
    { timeout: 300_000 },
    () => {
      const database = hostIndex();
      fill(database, OPEN_TASKS);

      // As the host leaves it: no ANALYZE, so the planner guesses.
      const asHosted = timedRead(database, 1);
      // The same rows with the planner told the truth: what the read need cost.
      database.exec('ANALYZE');
      const informed = timedRead(database, 3);

      expect(asHosted.read).toEqual({ tasks: OPEN_TASKS, projects: PROJECTS });
      expect(informed.read).toEqual(asHosted.read);
      // Measured in one process, one after the other, so a loaded machine slows both.
      expect(asHosted.quickest).toBeLessThan(informed.quickest * 20 + 50);
    },
  );

  it('sorts 5,000 tasks into sections in well under a frame’s worth of seconds', () => {
    const tasks: ReviewTask[] = Array.from({ length: 5000 }, (_, at) =>
      reviewTask({
        path: `Tasks/Task ${at}.md`,
        title: `Task ${at % 50}`,
        modified: NOW - (at % 40) * 86_400_000,
        status: STATUSES[at % STATUSES.length],
        due: at % 3 === 0 ? `2026-10-${String(1 + (at % 28)).padStart(2, '0')}` : null,
        defer: null,
        waitingOn: `Person ${at % 700}`,
        project: `Projects/Project ${at % 900}.md`,
        projectTitle: `Project ${at % 900}`,
      }),
    );
    const started = performance.now();
    const page = todayLists({ tasks, projects: [], at: { today: TODAY, now: NOW } });
    const took = performance.now() - started;
    const listed = page.sections.reduce((sum, section) => sum + section.count, 0);
    expect(listed).toBeGreaterThan(2000);
    expect(took).toBeLessThan(1500);
  });
});

/** The statement's reading of awkward frontmatter, through the index's own property rows. */
function tasksOf(notes: Readonly<Record<string, Readonly<Record<string, unknown>>>>) {
  const database = hostIndex();
  for (const [path, frontmatter] of Object.entries(notes)) {
    const title = path.replace(/^.*\//, '').replace(/\.md$/, '');
    database
      .prepare('INSERT INTO files (path, title, modified, size) VALUES (?, ?, ?, 0)')
      .run(path, title, NOW);
    for (const row of indexablePropertiesOf(frontmatter)) {
      database
        .prepare('INSERT INTO props VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(path, row.key, row.index, row.text, row.number, row.date, row.json);
    }
  }
  const { sql, parameters } = compileReviewTasksQuery();
  const rows = database.prepare(sql).all(...parameters) as Parameters<typeof reviewTask>[0][];
  return rows.map(reviewTask);
}

function sectionsOf(notes: Readonly<Record<string, Readonly<Record<string, unknown>>>>) {
  const page = todayLists({
    tasks: tasksOf(notes),
    projects: [].map(reviewProject),
    at: { today: TODAY, now: NOW },
  });
  return Object.fromEntries(
    page.sections.map((section) => [
      section.id,
      section.groups.flatMap((group) => group.tasks.map((task) => task.title)),
    ]),
  );
}

describe('the Today page’s reading of dates and statuses as people write them', () => {
  it('reads a due day from a datetime, a list, and an offset as the day written', () => {
    const listed = sectionsOf({
      'Tasks/Timed.md': { type: 'task', status: 'next-action', due: `${TODAY}T23:59` },
      'Tasks/Offset.md': { type: 'task', status: 'next-action', due: `${TODAY}T00:30:00+09:00` },
      'Tasks/Listed.md': { type: 'task', status: 'backlog', due: [TODAY, '2026-12-01'] },
      'Tasks/Late list.md': { type: 'task', status: 'backlog', due: ['soon', '2026-10-01'] },
    });
    expect(listed['dueToday']).toEqual(['Listed', 'Offset', 'Timed']);
    expect(listed['overdue']).toEqual(['Late list']);
  });

  it('takes a date that is no date for no date: not overdue, not deferred, still listed', () => {
    const listed = sectionsOf({
      'Tasks/Vague.md': { type: 'task', status: 'next-action', due: 'next week', defer: 'later' },
      'Tasks/Impossible.md': { type: 'task', status: 'next-action', due: '2026-02-30' },
      'Tasks/Empty.md': { type: 'task', status: 'in-progress', due: '', defer: null },
      'Tasks/Far.md': { type: 'task', status: 'in-progress', due: '9999-12-31' },
      'Tasks/Ancient.md': { type: 'task', status: 'waiting', due: '1900-01-01', waiting_on: 'x' },
    });
    expect(listed['overdue']).toEqual(['Ancient']);
    expect(listed['dueToday']).toEqual([]);
    expect(listed['inProgress']).toEqual(['Far', 'Empty']);
    expect(listed['nextActions']).toEqual(['Impossible', 'Vague']);
  });

  it('lists no finished task, however Archive is spelled, and none of a status that is not one', () => {
    const listed = sectionsOf({
      'Tasks/Done.md': { type: 'task', status: 'archive', due: TODAY, defer: TODAY },
      'Tasks/Done list.md': { type: 'task', status: ['archive'], defer: TODAY },
      'Tasks/Done spaced.md': { type: 'Task ', status: ' archive ', defer: TODAY },
      'Tasks/Shouted.md': { type: 'task', status: 'ARCHIVE', due: '2026-10-01', defer: TODAY },
      'Tasks/Two.md': { type: 'task', status: ['next-action', 'archive'], defer: TODAY },
      'Tasks/Made up.md': { type: 'task', status: 'doing', due: '2026-10-01', defer: TODAY },
      'Tasks/None.md': { type: 'task', due: '2026-10-01', defer: TODAY },
      'Archive/Tasks/Old.md': { type: 'task', status: 'next-action', due: TODAY },
    });
    expect(Object.values(listed).flat()).toEqual([]);
  });

  it('keeps a Someday or Longterm task with a day out of Overdue and Due today', () => {
    const listed = sectionsOf({
      'Tasks/One day.md': { type: 'task', status: 'someday', due: '2026-10-01' },
      'Tasks/Far off.md': { type: 'task', status: 'longterm', due: TODAY },
    });
    expect(Object.values(listed).flat()).toEqual([]);
  });
});
