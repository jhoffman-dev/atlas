import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileMadeItemsQuery, linkedTaskOwner } from './made-items.ts';

/**
 * What the declared step reads of the tasks already made (ADR-0036,
 * "Identity key"): every `atlas_item` the index holds, and whose a task
 * linked to the meeting is.
 */

describe('whose a task linked to a meeting is', () => {
  it.each([
    ['nobody to wait on: the owner’s own', {}, 'self'],
    ['an empty waiting_on', { waiting_on: '  ' }, 'self'],
    ['a name', { waiting_on: 'Tobias  Fenn' }, 'tobias fenn'],
    [
      'a link, by its note’s title',
      { waiting_on: '[[People/Tobias Fenn.md|Tobias]]' },
      'tobias fenn',
    ],
    ['a list, by its first', { waiting_on: ['[[Mara Quill]]', '[[Tobias Fenn]]'] }, 'mara quill'],
    ['something that is not a name', { waiting_on: 3 }, 'self'],
  ])('is %s', (_case, properties, owner) => {
    expect(linkedTaskOwner(properties)).toBe(owner);
  });
});

describe('the tasks already made, as the index holds them', () => {
  it('finds every note with an atlas_item, with the title it keeps when it keeps one', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
                    value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT)`);
    const put = database.prepare(
      'INSERT INTO props (path, key, idx, value_text) VALUES (?, ?, ?, ?)',
    );
    put.run('Send the contract.md', 'atlas_item', 0, 'item-a');
    put.run('Send the contract.md', 'title', 0, 'Send the contract #2');
    put.run('Archive/2026/Book the room.md', 'atlas_item', 0, 'item-b');
    put.run('Plain task.md', 'status', 0, 'inbox');
    const { sql, parameters } = compileMadeItemsQuery();

    const rows = database.prepare(sql).all(...parameters);

    expect(rows).toEqual([
      { path: 'Archive/2026/Book the room.md', key: 'item-b', title: null },
      { path: 'Send the contract.md', key: 'item-a', title: 'Send the contract #2' },
    ]);
  });
});
