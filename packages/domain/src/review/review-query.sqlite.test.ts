import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { indexablePropertiesOf } from '../index/property-value.ts';
import {
  compileReviewProjectsQuery,
  compileReviewTasksQuery,
  reviewProject,
  reviewTask,
} from './review-query.ts';

/**
 * P30-07: the review's statements run for real against SQLite, over the
 * index's own `files`, `props` and `relations` tables.
 */
interface Fixture {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly modified?: number;
  /** Each relation the note holds: key, the target as written, and the note it resolved to. */
  readonly relations?: readonly { key: string; name: string; dst: string | null }[];
}

function indexOf(notes: Readonly<Record<string, Fixture>>) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                        modified INTEGER NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
                        value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
                            target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);`);
  for (const [path, note] of Object.entries(notes)) {
    const title = path.replace(/^.*\//, '').replace(/\.md$/, '');
    database
      .prepare('INSERT INTO files VALUES (?, ?, ?, ?, 0)')
      .run(path, title, '', note.modified ?? 1);
    for (const row of indexablePropertiesOf(note.frontmatter)) {
      database
        .prepare('INSERT INTO props VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(path, row.key, row.index, row.text, row.number, row.date, row.json);
    }
    (note.relations ?? []).forEach((relation, at) =>
      database
        .prepare('INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?)')
        .run(path, relation.key, at, relation.name, relation.name.toLowerCase(), relation.dst),
    );
  }
  return database;
}

function tasksOf(notes: Readonly<Record<string, Fixture>>) {
  const { sql, parameters } = compileReviewTasksQuery();
  const rows = indexOf(notes)
    .prepare(sql)
    .all(...parameters) as Parameters<typeof reviewTask>[0][];
  return rows.map(reviewTask);
}

function projectsOf(notes: Readonly<Record<string, Fixture>>) {
  const { sql, parameters } = compileReviewProjectsQuery();
  const rows = indexOf(notes)
    .prepare(sql)
    .all(...parameters) as Parameters<typeof reviewProject>[0][];
  return rows.map(reviewProject);
}

describe('compileReviewTasksQuery', () => {
  it('reads a task whole: status, days, who it waits on, its project, and when it changed', () => {
    const tasks = tasksOf({
      'Tasks/Quote.md': {
        frontmatter: {
          type: 'Task',
          status: ' waiting',
          due: '2026-10-01T09:00',
          defer: '2026-10-20',
          waiting_on: ['[[Mara Quill]]', '[[Tobias Fenn]]'],
          project: '[[Atlas]]',
        },
        modified: 1234,
        relations: [
          { key: 'waiting_on', name: 'Mara Quill', dst: 'People/Mara Quill.md' },
          { key: 'waiting_on', name: 'Tobias Fenn', dst: null },
          { key: 'project', name: 'Atlas', dst: 'Projects/Atlas.md' },
        ],
      },
    });
    expect(tasks).toEqual([
      {
        path: 'Tasks/Quote.md',
        title: 'Quote',
        status: 'waiting',
        due: '2026-10-01',
        defer: '2026-10-20',
        waitingOn: 'Mara Quill, Tobias Fenn',
        project: 'Projects/Atlas.md',
        modified: 1234,
      },
    ]);
  });

  it('reads a task with nothing set as nothing, and a project link that names no note as none', () => {
    const [bare] = tasksOf({
      'Tasks/Bare.md': {
        frontmatter: { type: 'task', due: 'soon', status: ['next-action', 'waiting'] },
        relations: [{ key: 'project', name: 'Gone', dst: null }],
      },
    });
    expect(bare).toMatchObject({
      status: null,
      due: null,
      defer: null,
      waitingOn: '',
      project: null,
    });
  });

  it('reads a status GTD does not know as none, and the first day and the first project that resolve', () => {
    const [task] = tasksOf({
      'Tasks/Mixed.md': {
        frontmatter: { type: 'task', status: 'doing', due: ['soon', '2026-10-03'] },
        relations: [
          { key: 'project', name: 'Gone', dst: null },
          { key: 'project', name: 'Atlas', dst: 'Projects/Atlas.md' },
        ],
      },
    });
    expect(task).toMatchObject({ status: null, due: '2026-10-03', project: 'Projects/Atlas.md' });
  });

  it('leaves out finished tasks, archived and hidden ones, templates, and notes of other types', () => {
    const tasks = tasksOf({
      'Tasks/Open.md': { frontmatter: { type: 'task', status: 'inbox' } },
      'Tasks/Finished.md': { frontmatter: { type: 'task', status: 'archive' } },
      'Archive/Tasks/Old.md': { frontmatter: { type: 'task', status: 'waiting' } },
      '.atlas/templates/Task.md': { frontmatter: { type: 'task', status: 'inbox' } },
      'Projects/Atlas.md': { frontmatter: { type: 'project', status: 'active' } },
    });
    expect(tasks.map((task) => task.path)).toEqual(['Tasks/Open.md']);
  });
});

describe('compileReviewProjectsQuery', () => {
  it('reads every project in use with its status, and nothing else', () => {
    expect(
      projectsOf({
        'Projects/Atlas.md': { frontmatter: { type: 'project', status: 'active ' } },
        'Projects/Quiet.md': { frontmatter: { type: 'Project', status: '' } },
        'Archive/Projects/Old.md': { frontmatter: { type: 'project', status: 'active' } },
        'Areas/Garden.md': { frontmatter: { type: 'area' } },
      }),
    ).toEqual([
      { path: 'Projects/Atlas.md', title: 'Atlas', status: 'active' },
      { path: 'Projects/Quiet.md', title: 'Quiet', status: null },
    ]);
  });
});
