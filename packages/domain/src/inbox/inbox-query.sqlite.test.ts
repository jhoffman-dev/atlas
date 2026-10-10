import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileInboxQuery } from './inbox.ts';

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
}

function inboxIndex(notes: readonly IndexedNote[]) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, modified INTEGER NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
  `);
  const file = database.prepare('INSERT INTO files VALUES (?, ?, ?)');
  const prop = database.prepare('INSERT INTO props (path, key, value_text) VALUES (?, ?, ?)');
  for (const note of notes) {
    file.run(note.path, note.title, note.modified);
    if (note.type !== undefined) prop.run(note.path, 'type', note.type);
    for (const [key, value] of note.props ?? []) prop.run(note.path, key, value);
  }
  return (limit?: number) => {
    const { sql, parameters } = compileInboxQuery(limit === undefined ? {} : { limit });
    return database.prepare(sql).all(...parameters);
  };
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
});
