import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { indexablePropertiesOf } from '../index/property-value.ts';
import { compileTaskStatusesQuery } from './status-mapping.ts';

/** P30-02: the quick look at the statuses tasks hold, run for real against SQLite. */
function statuses(notes: Readonly<Record<string, Readonly<Record<string, unknown>>>>) {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
    value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);`);
  for (const [path, frontmatter] of Object.entries(notes)) {
    for (const row of indexablePropertiesOf(frontmatter)) {
      database
        .prepare('INSERT INTO props VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(path, row.key, row.index, row.text, row.number, row.date, row.json);
    }
  }
  const { sql, parameters } = compileTaskStatusesQuery();
  const rows = database.prepare(sql).all(...parameters) as { status: string | null }[];
  return rows.map((row) => row.status).sort((a, b) => String(a).localeCompare(String(b)));
}

describe('compileTaskStatusesQuery', () => {
  it('lists each status tasks hold once, a task with none as null, and nothing of other types', () => {
    expect(
      statuses({
        'a.md': { type: 'task', status: 'next-action' },
        'b.md': { type: 'Task', status: 'next-action' },
        'c.md': { type: 'task', status: 'doing' },
        'd.md': { type: 'task' },
        'e.md': { type: 'project', status: 'paused' },
      }),
    ).toEqual(['doing', 'next-action', null]);
  });

  it('is empty for a vault with no tasks', () => {
    expect(statuses({ 'e.md': { type: 'project', status: 'done' } })).toEqual([]);
  });
});
