import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { filterValueFrom } from './filter-words.ts';
import { compileViewQuery, type ViewQuery } from './view-query.ts';

/**
 * A typed filter value run for real against a stand-in for the index's type
 * view. The index builds a text property's column from `value_text`, as a
 * `MAX(CASE …)` expression — a column with no type affinity, so SQLite never
 * converts between the text in it and a number it is compared with.
 */
function roomIndex(rooms: readonly (readonly [string, string])[]) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE props (path TEXT, key TEXT, value_text TEXT);
    CREATE VIEW v_room AS
      SELECT path AS "path", path AS "title", '' AS "summary",
             MAX(CASE WHEN key = 'code' THEN value_text END) AS "code"
      FROM props GROUP BY path;`);
  const insert = database.prepare('INSERT INTO props VALUES (?, ?, ?)');
  for (const [path, code] of rooms) insert.run(path, 'code', code);
  return (query: ViewQuery) => {
    const { sql, parameters } = compileViewQuery(query, {});
    return database
      .prepare(sql)
      .all(...parameters)
      .map((row) => row['path']);
  };
}

const typed = (value: string): ViewQuery => ({
  type: 'room',
  columns: ['code'],
  filters: [{ key: 'code', operator: 'is', value: filterValueFrom(value) ?? '' }],
  sorts: [],
  limit: 100,
});

describe('filterValueFrom, run against a text property', () => {
  const run = roomIndex([
    ['rooms/Lab.md', '007'],
    ['rooms/Hall.md', '1.10'],
    ['rooms/Attic.md', '101'],
    ['rooms/Den.md', 'B2'],
  ]);

  it('finds a word typed as a word (the stand-in index answers at all)', () => {
    expect(run(typed('B2'))).toEqual(['rooms/Den.md']);
  });

  it('finds a text property that holds only digits', () => {
    expect(run(typed('101'))).toEqual(['rooms/Attic.md']);
  });

  it('finds the note whose text is exactly what was typed, leading zeros and all', () => {
    expect(run(typed('007'))).toEqual(['rooms/Lab.md']);
  });

  it('finds a version-like text without reading it as the number 1.1', () => {
    expect(run(typed('1.10'))).toEqual(['rooms/Hall.md']);
  });
});
