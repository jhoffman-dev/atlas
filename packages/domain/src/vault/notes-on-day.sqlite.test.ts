import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileNotesOnDayQuery, isNamedForDay } from './notes-on-day.ts';
import { createVaultPath } from './vault-path.ts';

/** The statement run for real over the index's `props` table: the rows are asserted, not the text. */
function datedPaths(
  rows: readonly { path: string; key: string; text: string | null; date: string | null }[],
  day: string,
) {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
    value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);`);
  const insert = database.prepare(
    'INSERT INTO props (path, key, value_text, value_date) VALUES (?, ?, ?, ?)',
  );
  for (const row of rows) insert.run(row.path, row.key, row.text, row.date);
  const { sql, parameters } = compileNotesOnDayQuery(day);
  return database
    .prepare(sql)
    .all(...parameters)
    .map((row) => row['path']);
}

describe('compileNotesOnDayQuery', () => {
  it('finds the notes whose date property is the day, with or without a time, once each', () => {
    const found = datedPaths(
      [
        { path: 'b.md', key: 'date', text: '2026-10-14', date: '2026-10-14' },
        { path: 'a.md', key: 'date', text: '2026-10-14 09:00', date: '2026-10-14 09:00' },
        { path: 'a.md', key: 'date', text: '2026-10-14', date: '2026-10-14' },
        { path: 'c.md', key: 'date', text: '2026-10-13', date: '2026-10-13' },
        { path: 'd.md', key: 'due', text: '2026-10-14', date: '2026-10-14' },
        { path: 'e.md', key: 'date', text: '2026-10-14', date: null },
      ],
      '2026-10-14',
    );
    expect(found).toEqual(['a.md', 'b.md', 'e.md']);
  });
});

describe('isNamedForDay', () => {
  const named = (path: string) => isNamedForDay(createVaultPath(path), '2026-10-14');

  it('is a note whose file name begins with the day', () => {
    expect(named('Daily/2026-10-14.md')).toBe(true);
    expect(named('Inbox/Meetings/2026-10-14 Standup.md')).toBe(true);
  });

  it('is not a folder named for it, another day, or a longer number', () => {
    expect(named('2026-10-14/Standup.md')).toBe(false);
    expect(named('Daily/2026-10-13.md')).toBe(false);
    expect(named('Daily/2026-10-140.md')).toBe(false);
    expect(named('Notes/Before 2026-10-14.md')).toBe(false);
  });
});
