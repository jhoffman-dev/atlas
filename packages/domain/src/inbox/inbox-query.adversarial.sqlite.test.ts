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

/**
 * How each correlated subquery in the statement's plan finds its rows, as the
 * planner chose with no statistics. A subquery that seeks by the outer note's
 * path reads that note's rows alone; one that seeks by `key` reads every note
 * holding the key, once per note asked about — the whole vault, squared. The
 * plan is what decides that, so it is asserted rather than the time it takes.
 */
function correlatedReads(database: DatabaseSync, startInInbox: boolean): string[] {
  const { sql, parameters } = compileInboxQuery({ limit: 501, tasksStartInInbox: startInInbox });
  const plan = database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as {
    id: number;
    parent: number;
    detail: string;
  }[];
  const correlated = new Set<number>();
  for (const step of plan) {
    if (step.detail.startsWith('CORRELATED') || correlated.has(step.parent))
      correlated.add(step.id);
  }
  return plan
    .filter(
      (step) => correlated.has(step.parent) && /^(SEARCH|SCAN) (?!\(subquery)/.test(step.detail),
    )
    .map((step) => step.detail);
}

describe('the Inbox’s statement on a vault of 2,400 notes', () => {
  it.each([
    ['tasks start in the Inbox', true],
    ['the vault is on statuses of its own', false],
  ])(
    'reads each note’s own rows by its path, without statistics the index never gathers: %s',
    (_name, startInInbox) => {
      const database = hostIndex();
      const waits = fill(database, 2400);
      const { sql, parameters } = compileInboxQuery({
        limit: 501,
        tasksStartInInbox: startInInbox,
      });

      // As the host leaves it: no ANALYZE, so the planner guesses.
      expect(database.prepare(sql).all(...parameters)).toHaveLength(waits);
      const reads = correlatedReads(database, startInInbox);
      expect(reads.length).toBeGreaterThan(0);
      for (const read of reads) expect(read).toMatch(/ \((path|src)=\?/);
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
