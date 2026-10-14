import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileInboxCountQuery, compileInboxQuery } from './inbox.ts';

/**
 * The Inbox's statement run for real against SQLite, over the index's own
 * `files` and `props` tables: what is asserted is the rows, not the text.
 */
interface IndexedNote {
  readonly path: string;
  readonly title: string;
  readonly modified: number;
  readonly type?: string;
  /** More properties, as `[key, value]`; a null value is a key with nothing in it. */
  readonly props?: readonly (readonly [string, string | null])[];
  /** Date properties, as `[key, day]`, indexed as the index holds a date. */
  readonly dates?: readonly (readonly [string, string])[];
  /** Relations, as `[key, the path linked]`. */
  readonly links?: readonly (readonly [string, string])[];
}

function inboxIndex(notes: readonly IndexedNote[]) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, modified INTEGER NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      target TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', dst TEXT);
  `);
  const file = database.prepare('INSERT INTO files VALUES (?, ?, ?)');
  const prop = database.prepare('INSERT INTO props (path, key, value_text) VALUES (?, ?, ?)');
  const date = database.prepare(
    'INSERT INTO props (path, key, value_text, value_date) VALUES (?, ?, ?, ?)',
  );
  const link = database.prepare('INSERT INTO relations (src, key, dst) VALUES (?, ?, ?)');
  for (const note of notes) {
    file.run(note.path, note.title, note.modified);
    if (note.type !== undefined) prop.run(note.path, 'type', note.type);
    for (const [key, value] of note.props ?? []) prop.run(note.path, key, value);
    for (const [key, day] of note.dates ?? []) date.run(note.path, key, day, day);
    for (const [key, dst] of note.links ?? []) link.run(note.path, key, dst);
  }
  const run = ({ sql, parameters }: { sql: string; parameters: readonly (string | number)[] }) =>
    database.prepare(sql).all(...parameters);
  return Object.assign(
    (limit?: number, tasksStartInInbox = false) =>
      run(compileInboxQuery({ ...(limit !== undefined && { limit }), tasksStartInInbox })),
    {
      page: (limit: number, offset: number) => run(compileInboxQuery({ limit, offset })),
      count: (tasksStartInInbox = false) => run(compileInboxCountQuery({ tasksStartInInbox })),
    },
  );
}

const inbox = inboxIndex([
  { path: 'Inbox/Call the bank.md', title: 'Call the bank', modified: 3, type: 'task' },
  { path: 'inbox/Meetings/Standup.md', title: 'Standup', modified: 5, type: 'meeting' },
  { path: 'Inbox/Idea.md', title: 'Idea', modified: 1 },
  { path: 'Projects/Atlas.md', title: 'Atlas', modified: 9, type: 'project' },
  { path: 'Archive/Inbox/Old.md', title: 'Old', modified: 8 },
  { path: 'Inbox/.hidden/Secret.md', title: 'Secret', modified: 7 },
  { path: 'Inbox/Proposals/Send.md', title: 'Send', modified: 6, type: 'proposal' },
]);

const named = (rows: readonly Record<string, unknown>[]) =>
  rows.map(({ path, title, type }) => ({ path, title, type }));

describe('compileInboxQuery', () => {
  it('lists every note in the Inbox at any depth, newest first, with its type, proposals aside', () => {
    expect(named(inbox())).toEqual([
      { path: 'inbox/Meetings/Standup.md', title: 'Standup', type: 'meeting' },
      { path: 'Inbox/Call the bank.md', title: 'Call the bank', type: 'task' },
      { path: 'Inbox/Idea.md', title: 'Idea', type: null },
    ]);
  });

  it('carries what the meeting import wrote, a cleared stamp still a stamp', () => {
    const meetings = inboxIndex([
      { path: 'Inbox/Meetings/New.md', title: 'New', modified: 3, type: 'meeting' },
      {
        path: 'Inbox/Meetings/Broken.md',
        title: 'Broken',
        modified: 2,
        props: [
          ['atlas_import_outcome', 'error'],
          ['atlas_import_error', 'title is required'],
        ],
      },
      {
        path: 'Inbox/Meetings/Cleared.md',
        title: 'Cleared',
        modified: 1,
        props: [['atlas_import_outcome', null]],
      },
    ]);
    expect(
      meetings().map(({ path, importStamped, importOutcome, importError }) => ({
        path,
        importStamped,
        importOutcome,
        importError,
      })),
    ).toEqual([
      { path: 'Inbox/Meetings/New.md', importStamped: 0, importOutcome: null, importError: null },
      {
        path: 'Inbox/Meetings/Broken.md',
        importStamped: 1,
        importOutcome: 'error',
        importError: 'title is required',
      },
      {
        path: 'Inbox/Meetings/Cleared.md',
        importStamped: 1,
        importOutcome: null,
        importError: null,
      },
    ]);
  });

  it('stops at the limit', () => {
    expect(inbox(1)).toHaveLength(1);
  });

  it('starts a page past the ones before it, in the same order (#167)', () => {
    expect(named(inbox.page(2, 1))).toEqual([
      { path: 'Inbox/Call the bank.md', title: 'Call the bank', type: 'task' },
      { path: 'Inbox/Idea.md', title: 'Idea', type: null },
    ]);
    expect(inbox.page(2, 3)).toEqual([]);
  });

  it('counts what it would list, proposals, hidden and archived notes aside (#167)', () => {
    expect(inbox.count()).toEqual([{ total: 3 }]);
  });
});

/** #112: one Inbox — the folder, and every task still at Inbox wherever it lives. */
describe('compileInboxQuery — tasks, wherever they live', () => {
  const task = (path: string, modified: number, status?: string | null): IndexedNote => ({
    path,
    title: path.split('/').at(-1)?.replace('.md', '') ?? path,
    modified,
    type: 'task',
    ...(status !== undefined && { props: [['status', status]] }),
  });
  const vault = inboxIndex([
    task('Inbox/Captured.md', 9, 'inbox'),
    task('Inbox/Decided.md', 8, 'next-action'),
    task('Inbox/Old style.md', 7, 'doing'),
    task('Tasks/Imported.md', 6, 'inbox'),
    task('Tasks/No status.md', 5),
    task('Tasks/Cleared status.md', 4, null),
    task('Tasks/Moving.md', 3, 'in-progress'),
    task('Archive/Tasks/Finished late.md', 2, 'inbox'),
    task('.atlas/templates/Task.md', 2, 'inbox'),
    { path: 'Notes/Says inbox.md', title: 'Says inbox', modified: 1, props: [['status', 'inbox']] },
    { path: 'Inbox/Idea.md', title: 'Idea', modified: 1, props: [['status', 'next-action']] },
  ]);
  const paths = (rows: readonly Record<string, unknown>[]) => rows.map((row) => row['path']);

  it('lists a task at Inbox outside the folder, in use: not archived, not Atlas’s own, not a note that only says inbox', () => {
    expect(paths(vault())).toContain('Tasks/Imported.md');
    expect(paths(vault())).not.toContain('Archive/Tasks/Finished late.md');
    expect(paths(vault())).not.toContain('.atlas/templates/Task.md');
    expect(paths(vault())).not.toContain('Notes/Says inbox.md');
    expect(paths(vault())).not.toContain('Tasks/Moving.md');
  });

  it('keeps the whole folder, whatever a task in it says, in a vault on statuses of its own', () => {
    expect(paths(vault())).toEqual([
      'Inbox/Captured.md',
      'Inbox/Decided.md',
      'Inbox/Old style.md',
      'Tasks/Imported.md',
      'Inbox/Idea.md',
    ]);
  });

  it('once tasks start in the Inbox, lets a task given another GTD status leave, and lists one with no status', () => {
    expect(paths(vault(undefined, true))).toEqual([
      'Inbox/Captured.md',
      // Not one of the eight: nobody decided it, so it still waits.
      'Inbox/Old style.md',
      'Tasks/Imported.md',
      'Tasks/No status.md',
      'Tasks/Cleared status.md',
      // A note that is not a task waits in the folder whatever its status says.
      'Inbox/Idea.md',
    ]);
  });

  it('carries what a task already says: its status, its project, who it waits on, defer and due', () => {
    const one = inboxIndex([
      {
        ...task('Tasks/Chase.md', 1, 'inbox'),
        props: [
          ['status', 'inbox'],
          ['waiting_on', '[[Mara Quill]]'],
        ],
        dates: [
          ['defer', '2026-10-20'],
          ['due', '2026-11-02'],
        ],
        links: [
          ['project', 'Projects/Atlas.md'],
          ['waiting_on', 'People/Mara Quill.md'],
        ],
      },
    ]);
    expect(one()[0]).toMatchObject({
      status: 'inbox',
      project: 'Projects/Atlas.md',
      waitingOn: 'People/Mara Quill.md',
      waitingOnNames: '[[Mara Quill]]',
      defer: '2026-10-20',
      due: '2026-11-02',
    });
  });
});
