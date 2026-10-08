import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { indexablePropertiesOf } from '../index/property-value.ts';
import { compileAtlasQuery } from './compile.ts';
import { parseAtlasQuery } from './parse.ts';
import { QUERY_TEST_TYPES } from './query-fixtures.ts';

/**
 * Counts from today and the start of the week, run for real against SQLite.
 * Each task is due a number of days from the day SQLite says it is, so the
 * edges of every range are known whatever day the tests run on.
 */
const database = new DatabaseSync(':memory:');
database.exec(`
  CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                      modified INTEGER NOT NULL, size INTEGER NOT NULL);
  CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
                      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);`);

/** The day SQLite's clock says, moved by these modifiers. */
function indexDay(...modifiers: string[]): string {
  const marks = modifiers.map(() => ', ?').join('');
  const row = database.prepare(`SELECT date('now', 'localtime'${marks}) AS day`).get(...modifiers);
  return String(row?.['day']);
}

const MONDAY = ['-6 days', 'weekday 1'];

const DUE: readonly [string, string][] = [
  ['Ages ago', indexDay('-400 days')],
  ['Thirty-one days ago', indexDay('-31 days')],
  ['Thirty days ago', indexDay('-30 days')],
  ['Twenty-nine days ago', indexDay('-29 days')],
  ['Sunday before', indexDay(...MONDAY, '-1 day')],
  ['This Monday', indexDay(...MONDAY)],
  ['In a fortnight', indexDay('+14 days')],
  ['In fifteen days', indexDay('+15 days')],
];

for (const [title, due] of DUE) {
  const path = `tasks/${title}.md`;
  database.prepare('INSERT INTO files VALUES (?, ?, ?, ?, 1)').run(path, title, '', 0);
  for (const row of indexablePropertiesOf({ type: 'task', due })) {
    database
      .prepare('INSERT INTO props VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(path, row.key, row.index, row.text, row.number, row.date, row.json);
  }
}

function titles(text: string): unknown[] {
  const compiled = compileAtlasQuery(parseAtlasQuery(text), {
    types: QUERY_TEST_TYPES,
    resolveLink: () => null,
  });
  return database
    .prepare(compiled.sql)
    .all(...compiled.parameters)
    .map((row) => row['title']);
}

describe('compileAtlasQuery, run against SQLite: dates counted from today', () => {
  it('counts days back: > @-30d leaves out the 30th day back, >= takes it', () => {
    const after = titles('FROM task WHERE due > @-30d');
    expect(after).toContain('Twenty-nine days ago');
    expect(after).not.toContain('Thirty days ago');
    expect(after).not.toContain('Thirty-one days ago');
    expect(titles('FROM task WHERE due >= @-30d')).toContain('Thirty days ago');
    expect(titles('FROM task WHERE due = @-30d')).toEqual(['Thirty days ago']);
  });

  it('counts weeks forward as seven days each', () => {
    const within = titles('FROM task WHERE due <= @+2w');
    expect(within).toContain('In a fortnight');
    expect(within).not.toContain('In fifteen days');
    expect(titles('FROM task WHERE due = @+2w')).toEqual(['In a fortnight']);
  });

  it('counts years back', () => {
    expect(titles('FROM task WHERE due < @-1y')).toEqual(['Ages ago']);
  });

  it('starts the week on Monday', () => {
    const thisWeek = titles('FROM task WHERE due >= @startOfWeek');
    expect(thisWeek).toContain('This Monday');
    expect(thisWeek).not.toContain('Sunday before');
    expect(titles('FROM task WHERE due = @startOfWeek')).toEqual(['This Monday']);
  });
});
