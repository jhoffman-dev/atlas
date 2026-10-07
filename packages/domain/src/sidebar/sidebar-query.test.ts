import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileSidebarQuery, SIDEBAR_QUERY_COLUMNS } from './sidebar-query.ts';

describe('compileSidebarQuery', () => {
  it('asks for the columns it says it returns', () => {
    const { sql } = compileSidebarQuery();
    for (const column of SIDEBAR_QUERY_COLUMNS) expect(sql).toContain(`AS "${column}"`);
  });

  it('binds every marker rather than writing it into the statement', () => {
    const { sql, parameters } = compileSidebarQuery();
    expect(sql.match(/\?/g)).toHaveLength(parameters.length);
    expect(parameters).toEqual([
      'atlas',
      'view',
      'atlas',
      'dashboard',
      'favorite',
      'true',
      'type',
      'layout',
      'groupBy',
      'dateKey',
      'startKey',
      'query',
      'title',
      'order',
      'atlas',
      'view',
    ]);
  });

  it('reads only the properties table, and only for reading', () => {
    const { sql } = compileSidebarQuery();
    expect(sql).toMatch(/^SELECT /);
    expect(sql).toContain('FROM files');
    expect(sql).toContain('JOIN props');
  });
});

describe('compileSidebarQuery, run against SQLite', () => {
  it('leaves an archived favourite out of Favorites, and keeps the rest', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE props (path TEXT, key TEXT, idx INTEGER, value_text TEXT);
      INSERT INTO files VALUES ('Live.md', 'Live'), ('Archive/Old.md', 'Old');
      INSERT INTO props VALUES ('Live.md', 'favorite', 0, 'true'),
        ('Archive/Old.md', 'favorite', 0, 'true');
    `);
    const { sql, parameters } = compileSidebarQuery();
    const paths = database
      .prepare(sql)
      .all(...parameters)
      .map((row) => row['path']);
    expect(paths).toEqual(['Live.md']);
  });
});
