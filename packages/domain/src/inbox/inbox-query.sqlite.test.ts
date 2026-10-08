import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileInboxQuery } from './inbox.ts';

/**
 * The Inbox's statement run for real against SQLite, over the index's own
 * `files` and `props` tables: what is asserted is the rows, not the text.
 */
function inboxIndex(
  notes: readonly { path: string; title: string; modified: number; type?: string }[],
) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, modified INTEGER NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
  `);
  const file = database.prepare('INSERT INTO files VALUES (?, ?, ?)');
  const prop = database.prepare("INSERT INTO props (path, key, value_text) VALUES (?, 'type', ?)");
  for (const note of notes) {
    file.run(note.path, note.title, note.modified);
    if (note.type !== undefined) prop.run(note.path, note.type);
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
]);

describe('compileInboxQuery', () => {
  it('lists every note in the Inbox at any depth, newest first, with its type', () => {
    expect(inbox()).toEqual([
      { path: 'inbox/Meetings/Standup.md', title: 'Standup', type: 'meeting' },
      { path: 'Inbox/Call the bank.md', title: 'Call the bank', type: 'task' },
      { path: 'Inbox/Idea.md', title: 'Idea', type: null },
    ]);
  });

  it('stops at the limit', () => {
    expect(inbox(1)).toHaveLength(1);
  });
});
