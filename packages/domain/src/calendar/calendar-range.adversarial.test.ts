import { describe, expect, it } from 'vitest';
import { rangeDays } from './calendar-range.ts';

/*
 * Adversarial: POST /v1/views/{path}/calendar accepts any real day as its
 * anchor, including ones in the first century. `Date.UTC` reads a year below
 * 100 as 1900 + year, so a month there must not be drawn from the 1900s.
 */

describe('rangeDays in the years 0000–0099', () => {
  it.each(['0001-01-15', '0050-06-15', '0099-12-15'])(
    'draws the month of %s from that month, not from the 1900s',
    (anchor) => {
      const days = rangeDays({ range: 'month', anchor });
      const month = anchor.slice(0, 7);

      expect(days.length).toBeGreaterThan(0);
      expect(days).toContain(`${month}-15`);
      for (const day of days) expect(day.startsWith('19')).toBe(false);
    },
  );
});
