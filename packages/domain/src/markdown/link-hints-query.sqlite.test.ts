import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileLinkHintsQuery, LINK_HINTS_QUERY_COLUMNS } from './link-hints-query.ts';

/** The index's tables, as `apps/desktop/src-tauri/src/index.rs` creates them. */
function index() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                        modified INTEGER NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
                        value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
                            target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);`);
  const file = database.prepare(
    'INSERT INTO files (path, title, modified, size) VALUES (?, ?, ?, 1)',
  );
  const prop = database.prepare(
    'INSERT INTO props (path, key, idx, value_text) VALUES (?, ?, ?, ?)',
  );
  const relation = database.prepare(
    'INSERT INTO relations (src, key, idx, target, dst) VALUES (?, ?, 0, ?, ?)',
  );
  return { database, file, prop, relation };
}

const run = (database: DatabaseSync) => {
  const { sql, parameters } = compileLinkHintsQuery();
  const statement = database.prepare(sql);
  expect(statement.columns().map((column) => column.name)).toEqual([...LINK_HINTS_QUERY_COLUMNS]);
  return statement.all(...parameters);
};

describe('the link hints query, run against the index’s tables', () => {
  it('lists the vault’s own notes, never one in .atlas or a hidden folder', () => {
    const { database, file } = index();
    file.run('people/Mara Quill.md', 'Mara Quill', 1);
    file.run('.atlas/templates/Person.md', 'Person', 1);
    file.run('.trash/Ghost.md', 'Ghost', 1);
    expect(run(database)).toEqual([
      { kind: 'note', path: 'people/Mara Quill.md', text: 'Mara Quill', uses: null, last: null },
    ]);
  });

  it('lists each alias, under either key, but not an empty one', () => {
    const { database, prop } = index();
    prop.run('people/Mara Quill.md', 'aliases', 0, 'MQ');
    prop.run('people/Mara Quill.md', 'aliases', 1, 'Mara');
    prop.run('people/Tobias Fenn.md', 'alias', 0, 'Toby');
    prop.run('people/Tobias Fenn.md', 'aliases', 0, '');
    prop.run('people/Tobias Fenn.md', 'role', 0, 'Lead');
    const aliases = run(database).map((row) => [row['path'], row['text']]);
    expect(aliases).toEqual([
      ['people/Mara Quill.md', 'MQ'],
      ['people/Mara Quill.md', 'Mara'],
      ['people/Tobias Fenn.md', 'Toby'],
    ]);
  });

  it('counts the links pointing at each note, and when the latest linking note changed', () => {
    const { database, file, relation } = index();
    file.run('tasks/a.md', 'A', 100);
    file.run('tasks/b.md', 'B', 300);
    relation.run('tasks/a.md', 'project', '[[Garden]]', 'projects/Garden.md');
    relation.run('tasks/b.md', 'project', '[[Garden]]', 'projects/Garden.md');
    relation.run('tasks/a.md', 'project', '[[Nowhere]]', null);
    const uses = run(database).filter((row) => row['kind'] === 'use');
    expect(uses).toEqual([
      { kind: 'use', path: 'projects/Garden.md', text: null, uses: 2, last: 300 },
    ]);
  });
});
