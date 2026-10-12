import { describe, expect, it } from 'vitest';
import type { BoardRow } from '../query/group-rows.ts';
import { daysWaited, firstRows } from './linked-rows.ts';

/** Adversarial pass on linked pages' row rules (P30-06, PR #117). */
const rows: BoardRow[] = Array.from({ length: 10 }, (_, at) => ({
  path: `Tasks/Task ${at}.md`,
  title: `Task ${at}`,
  values: {},
}));

describe('firstRows under attack', () => {
  // `rows.slice(0, -1)` is nine rows, and `more` is then 10 - (-1) = 11: a
  // bad count is drawn as "Show 11 more" under nine of ten rows.
  it.each([-1, 1.5, Number.NaN])(
    'draws and holds back exactly the rows it was given, asked to show %d',
    (shown) => {
      const drawn = firstRows({ rows, groups: [], shown });
      expect(drawn.rows.length + drawn.more).toBe(rows.length);
      expect(Number.isInteger(drawn.more) && drawn.more >= 0).toBe(true);
    },
  );
});

describe('daysWaited under attack', () => {
  // Its contract: "Null when the day cannot be read". A day that is no day
  // reads as 0 — "waiting since today" — instead.
  it.each(['9999-99-99', '2999-02-30'])('is null for %s, which is no day', (day) => {
    expect(daysWaited(day, '2999-03-13')).toBeNull();
  });

  it('is null when today is no day, never an age counted from nothing', () => {
    expect(daysWaited('2999-03-12', 'garbage')).toBeNull();
  });
});
