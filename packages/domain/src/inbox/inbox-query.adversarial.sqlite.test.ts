import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { compileInboxQuery } from './inbox.ts';

/**
 * Adversarial pass on #112 (One Inbox): the Inbox's statement run against the
 * index as the host makes it — the same tables and the same indexes
 * (`apps/desktop/src-tauri/src/index.rs`), which never runs ANALYZE. The
 * statement is asked on every index change, whatever page is open, so what it
 * costs is paid all day.
 */
function hostIndex() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, modified INTEGER NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE INDEX props_path ON props(path);
    CREATE INDEX props_key ON props(key, value_text);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
      target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);
    CREATE INDEX relations_src ON relations(src, key);
    CREATE INDEX relations_dst ON relations(dst);
  `);
  return database;
}

/** A vault of `total` notes: a sixth are tasks, an eighth of those still wait, half of them in `Inbox/`. */
function fill(database: DatabaseSync, total: number): number {
  const file = database.prepare('INSERT INTO files VALUES (?, ?, ?)');
  const prop = database.prepare(
    'INSERT INTO props (path, key, idx, value_text) VALUES (?, ?, 0, ?)',
  );
  let waits = 0;
  database.exec('BEGIN');
  for (let at = 0; at < total; at += 1) {
    const task = at % 6 === 0;
    const waiting = task && at % 48 === 0;
    const folder = waiting && at % 96 === 0 ? 'Inbox' : task ? 'Tasks' : 'Notes';
    const path = `${folder}/Note ${at}.md`;
    if (waiting) waits += 1;
    file.run(path, `Note ${at}`, at % 7);
    prop.run(path, 'type', task ? 'task' : at % 2 === 0 ? 'meeting' : 'note');
    if (task) prop.run(path, 'status', waiting ? 'inbox' : 'next-action');
    for (const key of ['created', 'area', 'tags', 'source', 'estimate', 'summary']) {
      prop.run(path, key, 'v');
    }
  }
  database.exec('COMMIT');
  return waits;
}

/** The quickest of three runs, in milliseconds, and the rows of the last. */
function timed(database: DatabaseSync, startInInbox: boolean) {
  const { sql, parameters } = compileInboxQuery({ limit: 501, tasksStartInInbox: startInInbox });
  const statement = database.prepare(sql);
  let quickest = Infinity;
  let rows = 0;
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    rows = statement.all(...parameters).length;
    quickest = Math.min(quickest, performance.now() - started);
  }
  return { quickest, rows };
}

describe('the Inbox’s statement on a vault of 2,400 notes', () => {
  it.each([
    ['tasks start in the Inbox', true],
    ['the vault is on statuses of its own', false],
  ])(
    'costs what its rows cost, without statistics the index never gathers: %s',
    { timeout: 240_000 },
    (_name, startInInbox) => {
      const database = hostIndex();
      const waits = fill(database, 2400);

      // As the host leaves it: no ANALYZE, so the planner guesses.
      const asHosted = timed(database, startInInbox);
      // The same rows with the planner told the truth: what the statement need cost.
      database.exec('ANALYZE');
      const informed = timed(database, startInInbox);

      expect(asHosted.rows).toBe(waits);
      expect(informed.rows).toBe(waits);
      // Measured in one process, one after the other, so a loaded machine slows both.
      expect(asHosted.quickest).toBeLessThan(informed.quickest * 20 + 50);
    },
  );
});

describe('the Inbox’s statement at the edges of the list', () => {
  const few = (notes: readonly [string, string | null, string | null][]) => {
    const database = hostIndex();
    notes.forEach(([path, type, status], at) => {
      database.prepare('INSERT INTO files VALUES (?, ?, ?)').run(path, path, at);
      const prop = database.prepare(
        'INSERT INTO props (path, key, idx, value_text) VALUES (?, ?, 0, ?)',
      );
      if (type !== null) prop.run(path, 'type', type);
      if (status !== null) prop.run(path, 'status', status);
    });
    return (startInInbox: boolean) => {
      const { sql, parameters } = compileInboxQuery({ tasksStartInInbox: startInInbox });
      return database
        .prepare(sql)
        .all(...parameters)
        .map((row) => row['path']);
    };
  };

  it('lists nothing from an empty vault, and one note once', () => {
    expect(few([])(true)).toEqual([]);
    expect(few([['Inbox/Only.md', 'task', 'inbox']])(true)).toEqual(['Inbox/Only.md']);
  });

  it('lists a note once however many ways it waits: in the folder, a task, at Inbox', () => {
    const listed = few([
      ['Inbox/Both.md', 'task', 'inbox'],
      ['inbox/Tasks/Deep.md', 'Task', 'inbox'],
    ]);
    expect(listed(true).sort()).toEqual(['Inbox/Both.md', 'inbox/Tasks/Deep.md']);
    expect(listed(false).sort()).toEqual(['Inbox/Both.md', 'inbox/Tasks/Deep.md']);
  });

  it('orders ties the same way every time: by title, then by path', () => {
    const database = hostIndex();
    const file = database.prepare('INSERT INTO files VALUES (?, ?, ?)');
    for (const path of ['Inbox/b.md', 'Inbox/Meetings/a.md', 'Inbox/a.md', 'Inbox/B 2.md']) {
      file.run(path, path.includes('a.md') ? 'Same' : 'same', 5);
    }
    const { sql, parameters } = compileInboxQuery();
    const order = () =>
      database
        .prepare(sql)
        .all(...parameters)
        .map((row) => row['path']);
    expect(order()).toEqual(['Inbox/B 2.md', 'Inbox/Meetings/a.md', 'Inbox/a.md', 'Inbox/b.md']);
    expect(order()).toEqual(order());
  });
});
