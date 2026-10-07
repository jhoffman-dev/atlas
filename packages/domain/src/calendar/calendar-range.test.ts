import { describe, expect, it } from 'vitest';
import {
  asCalendarRange,
  dateParts,
  dayHeading,
  rangeDays,
  rangeStart,
  rangeTitle,
  rangeUnit,
  stepAnchor,
  weekdayIndex,
} from './calendar-range.ts';
import { useZone, ZONES } from './zones.test-support.ts';

describe('asCalendarRange', () => {
  it.each(['month', 'week', '3day', 'day', 'agenda'] as const)('reads %s', (range) => {
    expect(asCalendarRange(range)).toBe(range);
    expect(asCalendarRange(` ${range} `)).toBe(range);
  });

  it.each([undefined, null, '', 'year', 3, 'Week'])('shows a month for %j', (value) => {
    expect(asCalendarRange(value)).toBe('month');
  });
});

describe('dateParts', () => {
  it('reads a real day', () => {
    expect(dateParts('2026-09-24')).toEqual({ year: 2026, month: 9, day: 24 });
  });

  it.each(['2026-02-30', '2026-13-01', '2026-09-24T10:00', 'soon', ''])('refuses %j', (value) => {
    expect(dateParts(value)).toBeNull();
  });
});

describe.each(ZONES)('calendar ranges in %s', (zone) => {
  useZone(zone);

  it('runs in the zone it says, so the other answers mean something', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
  });

  it('starts a week on Monday', () => {
    expect(weekdayIndex('2026-09-21')).toBe(0);
    expect(weekdayIndex('2026-09-27')).toBe(6);
    expect(rangeStart('week', '2026-09-24')).toBe('2026-09-21');
    expect(rangeStart('week', '2026-09-27')).toBe('2026-09-21');
    expect(rangeStart('week', '2026-09-28')).toBe('2026-09-28');
  });

  it('lists a week, three days and a day from the anchor', () => {
    expect(rangeDays({ range: 'week', anchor: '2026-09-24' })).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
    expect(rangeDays({ range: '3day', anchor: '2026-09-24' })).toEqual([
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ]);
    expect(rangeDays({ range: 'day', anchor: '2026-09-24' })).toEqual(['2026-09-24']);
  });

  it("draws a month's six weeks from the Monday before the first", () => {
    const days = rangeDays({ range: 'month', anchor: '2026-09-24' });
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2026-08-31');
  });

  it('lists an agenda for thirty days, or as many as were loaded', () => {
    expect(rangeDays({ range: 'agenda', anchor: '2026-09-24' })).toHaveLength(30);
    expect(rangeDays({ range: 'agenda', anchor: '2026-09-24', days: 60 }).at(-1)).toBe(
      '2026-11-22',
    );
  });

  it('keeps every day of a week that crosses a daylight-saving change', () => {
    // The US springs forward on 8 March 2026 and falls back on 1 November;
    // Europe on 29 March and 25 October. A day of 23 or 25 hours must still be one day.
    expect(rangeDays({ range: 'week', anchor: '2026-03-08' })).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ]);
    expect(rangeDays({ range: 'week', anchor: '2026-10-25' }).at(-1)).toBe('2026-10-25');
    expect(rangeDays({ range: '3day', anchor: '2026-10-31' })).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('steps by the range', () => {
    expect(stepAnchor({ range: 'week', anchor: '2026-10-22', by: 1 })).toBe('2026-10-29');
    expect(stepAnchor({ range: '3day', anchor: '2026-10-31', by: 1 })).toBe('2026-11-03');
    expect(stepAnchor({ range: 'day', anchor: '2026-03-08', by: -1 })).toBe('2026-03-07');
    expect(stepAnchor({ range: 'agenda', anchor: '2026-09-24', by: 1 })).toBe('2026-10-24');
    expect(stepAnchor({ range: 'month', anchor: '2026-09-24', by: 1 })).toBe('2026-10-24');
  });

  it("takes a month's last day when the anchor's day is not in it", () => {
    expect(stepAnchor({ range: 'month', anchor: '2026-01-31', by: 1 })).toBe('2026-02-28');
    expect(stepAnchor({ range: 'month', anchor: '2028-01-31', by: 1 })).toBe('2028-02-29');
    expect(stepAnchor({ range: 'month', anchor: '2026-03-31', by: -1 })).toBe('2026-02-28');
    expect(stepAnchor({ range: 'month', anchor: '2026-12-15', by: 1 })).toBe('2027-01-15');
    expect(stepAnchor({ range: 'month', anchor: '2026-01-15', by: -1 })).toBe('2025-12-15');
  });

  it('titles each range', () => {
    expect(rangeTitle('month', '2026-09-24')).toBe('September 2026');
    expect(rangeTitle('week', '2026-09-24')).toBe('Sep 21 – 27, 2026');
    expect(rangeTitle('3day', '2026-09-24')).toBe('Sep 24 – 26');
    expect(rangeTitle('day', '2026-09-24')).toBe('Thu, Sep 24, 2026');
    expect(rangeTitle('agenda', '2026-09-24')).toBe('From Sep 24');
  });
});

describe('rangeTitle across months and years', () => {
  it('names both months when a span crosses one', () => {
    expect(rangeTitle('week', '2026-10-01')).toBe('Sep 28 – Oct 4, 2026');
    expect(rangeTitle('3day', '2026-09-30')).toBe('Sep 30 – Oct 2');
  });

  it('names both years when a span crosses one', () => {
    expect(rangeTitle('week', '2026-12-30')).toBe('Dec 28, 2026 – Jan 3, 2027');
    expect(rangeTitle('3day', '2026-12-31')).toBe('Dec 31, 2026 – Jan 2, 2027');
  });

  it('shows something it cannot read as written', () => {
    expect(rangeTitle('week', 'soon')).toBe('soon');
    expect(rangeDays({ range: 'week', anchor: 'soon' })).toEqual([]);
    expect(stepAnchor({ range: 'month', anchor: 'soon', by: 1 })).toBe('soon');
  });
});

describe('rangeUnit and dayHeading', () => {
  it('says what a step covers', () => {
    expect(
      ['month', 'week', '3day', 'day', 'agenda'].map((r) => rangeUnit(asCalendarRange(r))),
    ).toEqual(['month', 'week', '3 days', 'day', '30 days']);
  });

  it("heads a day's column with its weekday and number", () => {
    expect(dayHeading('2026-09-24')).toEqual({ weekday: 'Thu', day: 24, month: 'Sep' });
  });
});

describe('the last day a date can hold', () => {
  it('never pages a month past 9999 onto a date that cannot be paged back', () => {
    const next = stepAnchor({ range: 'month', anchor: '9999-12-15', by: 1 });
    expect(dateParts(next)).not.toBeNull();
  });

  it('stays on the last month rather than paging past it, as a week does', () => {
    expect(stepAnchor({ range: 'month', anchor: '9999-12-15', by: 1 })).toBe('9999-12-15');
    expect(stepAnchor({ range: 'week', anchor: '9999-12-29', by: 1 })).toBe('9999-12-29');
    expect(stepAnchor({ range: 'month', anchor: '9999-11-30', by: 1 })).toBe('9999-12-30');
  });
});

describe('a range at the last day a date can hold', () => {
  it('shows each day once and none past 9999-12-31', () => {
    const days = rangeDays({ range: 'week', anchor: '9999-12-31' });
    expect(days.length).toBeGreaterThan(0);
    expect(new Set(days).size).toBe(days.length);
    expect(days.at(-1)).toBe('9999-12-31');
  });

  it('starts a week it cannot reach back to on the day it was opened', () => {
    expect(rangeStart('week', '0000-01-01')).toBe('0000-01-01');
  });
});
