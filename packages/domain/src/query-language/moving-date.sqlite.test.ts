import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { movingDate } from '../automations/automation-query.ts';
import { movingDateSql } from './moving-date.ts';
import type { Fragment } from './sql-fragment.ts';

/**
 * A moving date has two readings — SQL over the index's clock for a query the
 * app runs, and the day an automation pins it to — and they must agree. The
 * SQL is asked on a chosen day by counting from that day instead of from
 * 'now', so every weekday and every awkward month end can be tried.
 */
const database = new DatabaseSync(':memory:');

const INDEX_TODAY = "date('now', 'localtime'";

function sqlOnDay(fragment: Fragment, day: string): unknown {
  const counted = fragment.text.replace(INDEX_TODAY, 'date(?');
  expect(counted).not.toBe(fragment.text);
  const row = database.prepare(`SELECT ${counted} AS day`).get(day, ...fragment.values);
  return row?.['day'];
}

const NAMES = [
  'today',
  'yesterday',
  'weekAgo',
  'monthAhead',
  'startOfWeek',
  '-30d',
  '+2w',
  '-1w',
  '+1m',
  '-1m',
  '+1y',
  '-1y',
];

const DAYS = [
  // A week, Monday 2026-10-05 to Sunday 2026-10-11.
  ...['05', '06', '07', '08', '09', '10', '11'].map((day) => `2026-10-${day}`),
  // Month ends the short months make awkward, and a leap day.
  '2026-01-31',
  '2026-03-31',
  '2026-05-31',
  '2026-12-31',
  '2024-02-29',
];

describe('a moving date reads the same in SQL and pinned', () => {
  for (const name of NAMES) {
    it.each(DAYS)(`@${name} on %s`, (day) => {
      const fragment = movingDateSql(name);
      if (fragment === null) throw new Error(`@${name} has no SQL`);
      expect(sqlOnDay(fragment, day)).toBe(movingDate(name, day));
    });
  }
});

describe('the index’s own clock', () => {
  it('is where a moving date counts from in a query the app runs', () => {
    const today = database.prepare(`SELECT ${INDEX_TODAY}) AS day`).get()?.['day'];
    const fragment = movingDateSql('-30d');
    if (fragment === null) throw new Error('@-30d has no SQL');
    const row = database.prepare(`SELECT ${fragment.text} AS day`).get(...fragment.values);
    expect(row?.['day']).toBe(movingDate('-30d', String(today)));
  });
});
