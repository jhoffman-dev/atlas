import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_PATHS_PER_QUERY,
  ASSISTANT_QUERY_MARK,
  compileFollowUpsQuery,
  compileSourcesQuery,
  followUpRowsOf,
  sourcesOf,
} from './assistant-queries.ts';

/**
 * The assistant's statements run for real against SQLite, over the index's
 * own `files`, `props`, `tags`, `relations` and `links` tables: what is
 * asserted is the rows, not the text.
 */
interface Note {
  readonly path: string;
  readonly props?: Record<string, string>;
  readonly tags?: readonly string[];
  /** Notes its frontmatter links to. */
  readonly relations?: readonly string[];
  /** Notes its body links to. */
  readonly links?: readonly string[];
}

function assistantIndex(notes: readonly Note[]) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
    CREATE TABLE tags (path TEXT NOT NULL, idx INTEGER NOT NULL, tag TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
      target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);
    CREATE TABLE links (src TEXT NOT NULL, dst TEXT, target TEXT NOT NULL, kind TEXT NOT NULL);
  `);
  for (const note of notes) {
    database
      .prepare('INSERT INTO files VALUES (?, ?)')
      .run(note.path, note.path.replace(/^.*\//, '').replace(/\.md$/, ''));
    for (const [key, value] of Object.entries(note.props ?? {})) {
      const day = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
      database
        .prepare(
          'INSERT INTO props (path, key, idx, value_text, value_date) VALUES (?, ?, 0, ?, ?)',
        )
        .run(note.path, key, value, day);
    }
    for (const [at, tag] of (note.tags ?? []).entries()) {
      database.prepare('INSERT INTO tags VALUES (?, ?, ?, ?)').run(note.path, at, tag, tag);
    }
    for (const dst of note.relations ?? []) {
      database
        .prepare("INSERT INTO relations VALUES (?, 'x', 0, ?, '', ?)")
        .run(note.path, dst, dst);
    }
    for (const dst of note.links ?? []) {
      database.prepare("INSERT INTO links VALUES (?, ?, ?, 'wikilink')").run(note.path, dst, dst);
    }
  }
  return (compiled: { sql: string; parameters: readonly (string | number)[] } | null) => {
    if (compiled === null) return null;
    expect(compiled.sql.startsWith(ASSISTANT_QUERY_MARK)).toBe(true);
    return database
      .prepare(compiled.sql)
      .all(...compiled.parameters)
      .map((row) => Object.values(row));
  };
}

const MEETING = 'Meetings/Kickoff.md';
const MARA = 'People/Mara Quill.md';
const task = (status: string, more: Record<string, string> = {}) => ({
  type: 'task',
  status,
  ...more,
});

const NOTES: readonly Note[] = [
  { path: MEETING, props: { type: 'meeting' }, relations: ['Tasks/Chase the quote.md'] },
  { path: MARA, props: { type: 'person' } },
  // Joined by the meeting's own `tasks`.
  {
    path: 'Tasks/Chase the quote.md',
    props: task('inbox', { due: '2026-10-01', source: '[[Kickoff#^t0002]]' }),
    tags: ['follow-up'],
  },
  // Citing the meeting in its `source`.
  {
    path: 'Tasks/Check the rates.md',
    props: task('inbox'),
    tags: ['follow-up'],
    relations: [MEETING],
  },
  // Naming the person in its body.
  { path: 'Tasks/Ask Mara.md', props: task('next-action'), tags: ['follow-up'], links: [MARA] },
  // Linked from the meeting's body.
  { path: 'Tasks/From the notes.md', props: task('inbox'), tags: ['follow-up'] },
  {
    path: 'Tasks/Done already.md',
    props: task('archive'),
    tags: ['follow-up'],
    relations: [MEETING],
  },
  { path: 'Tasks/Not a follow-up.md', props: task('inbox'), relations: [MEETING] },
  { path: 'Tasks/Elsewhere.md', props: task('inbox'), tags: ['follow-up'] },
  {
    path: 'Notes/Follow-up idea.md',
    props: { type: 'note' },
    tags: ['follow-up'],
    relations: [MEETING],
  },
  {
    path: 'Archive/Tasks/Old chase.md',
    props: task('inbox'),
    tags: ['follow-up'],
    relations: [MEETING],
  },
  {
    path: '.atlas/Hidden chase.md',
    props: task('inbox'),
    tags: ['follow-up'],
    relations: [MEETING],
  },
];

const withBodyLink: readonly Note[] = NOTES.map((note) =>
  note.path === MEETING ? { ...note, links: ['Tasks/From the notes.md'] } : note,
);

describe('compileFollowUpsQuery', () => {
  const run = assistantIndex(withBodyLink);
  const followUps = (around: readonly string[], done: string | null = 'archive') =>
    followUpRowsOf(
      run(compileFollowUpsQuery({ around, taskType: 'task', statusKey: 'status', done })) ?? [],
    ).map((row) => row.path);

  it('finds the open follow-ups linked either way with the page or its meetings, by any link', () => {
    expect(followUps([MARA, MEETING])).toEqual([
      'Tasks/Ask Mara.md',
      'Tasks/Chase the quote.md',
      'Tasks/Check the rates.md',
      'Tasks/From the notes.md',
    ]);
  });

  it('answers each follow-up’s title, status, due and source as written', () => {
    const rows = followUpRowsOf(
      run(
        compileFollowUpsQuery({
          around: [MEETING],
          taskType: 'task',
          statusKey: 'status',
          done: 'archive',
        }),
      ) ?? [],
    );
    expect(rows.find((row) => row.path === 'Tasks/Chase the quote.md')).toEqual({
      path: 'Tasks/Chase the quote.md',
      title: 'Chase the quote',
      status: 'inbox',
      due: '2026-10-01',
      source: '[[Kickoff#^t0002]]',
    });
  });

  it('keeps a finished one when the Task type has no finished status', () => {
    expect(followUps([MEETING], null)).toContain('Tasks/Done already.md');
  });

  it('finds nothing around a note nothing follows up', () => {
    expect(followUps(['People/Nobody.md'])).toEqual([]);
  });

  it('asks nothing with nothing around', () => {
    expect(
      compileFollowUpsQuery({ around: [], taskType: 'task', statusKey: 'status', done: null }),
    ).toBeNull();
  });

  it('names each note once, and no more than its cap', () => {
    const many = Array.from({ length: ASSISTANT_PATHS_PER_QUERY + 50 }, (_, at) => `N/${at}.md`);
    const compiled = compileFollowUpsQuery({
      around: [...many, ...many],
      taskType: 'task',
      statusKey: 'status',
      done: 'archive',
    });
    // The paths, the type, the tag, the finished status and the limit.
    expect(compiled?.parameters).toHaveLength(ASSISTANT_PATHS_PER_QUERY + 4);
    expect(run(compiled)).toEqual([]);
  });
});

describe('compileSourcesQuery', () => {
  const run = assistantIndex(NOTES);

  it('answers the source of each note that has one', () => {
    const sources = sourcesOf(
      run(compileSourcesQuery(['Tasks/Chase the quote.md', 'Tasks/Check the rates.md', MARA])) ??
        [],
    );
    expect([...sources]).toEqual([['Tasks/Chase the quote.md', '[[Kickoff#^t0002]]']]);
  });

  it('asks nothing of no notes', () => {
    expect(compileSourcesQuery([])).toBeNull();
  });

  it('leaves out a row that is not a path and a text', () => {
    expect([
      ...sourcesOf([
        [1, 'x'],
        ['a.md', null],
        ['b.md', '[[B]]'],
      ]),
    ]).toEqual([['b.md', '[[B]]']]);
  });
});

describe('followUpRowsOf', () => {
  it('leaves out a row with no path and names an untitled one by its path', () => {
    expect(
      followUpRowsOf([
        [null, 'x'],
        ['Tasks/A.md', null, 3, null, null],
      ]),
    ).toEqual([{ path: 'Tasks/A.md', title: 'Tasks/A.md', status: null, due: null, source: null }]);
  });
});
