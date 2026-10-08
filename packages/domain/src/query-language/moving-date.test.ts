import { describe, expect, it } from 'vitest';
import { addMonths, countedDay, isMovingDate, movingDateSql } from './moving-date.ts';

describe('isMovingDate', () => {
  it.each(['today', 'weekAgo', 'monthAhead', 'startOfWeek', '-30d', '+2w', '+1m', '-1y', '+0d'])(
    '@%s moves',
    (name) => expect(isMovingDate(name)).toBe(true),
  );

  it.each([
    'someday',
    '30d',
    '-30',
    '-30x',
    '-d',
    '+-3d',
    '-12345d',
    '-3.5d',
    'startofweek',
    'constructor',
  ])('@%s does not', (name) => expect(isMovingDate(name)).toBe(false));
});

describe('countedDay: a count from the day it is handed', () => {
  it.each([
    ['-30d', '2026-10-08', '2026-09-08'],
    ['+2w', '2026-10-08', '2026-10-22'],
    ['-1w', '2026-03-03', '2026-02-24'],
    ['+0d', '2026-10-08', '2026-10-08'],
    ['+1m', '2026-10-08', '2026-11-08'],
    ['-1m', '2026-03-15', '2026-02-15'],
    ['+1y', '2026-10-08', '2027-10-08'],
    ['-2y', '2026-10-08', '2024-10-08'],
  ])('@%s on %s is %s', (name, today, day) => expect(countedDay(name, today)).toBe(day));

  it('counts across a year end and a leap day', () => {
    expect(countedDay('+3d', '2026-12-30')).toBe('2027-01-02');
    expect(countedDay('+1d', '2028-02-28')).toBe('2028-02-29');
  });

  it('finds the Monday of the week, whichever day it is handed', () => {
    // 2026-10-05 is a Monday; the week runs to Sunday the 11th.
    for (const day of ['05', '06', '07', '08', '09', '10', '11']) {
      expect(countedDay('startOfWeek', `2026-10-${day}`)).toBe('2026-10-05');
    }
    expect(countedDay('startOfWeek', '2026-10-12')).toBe('2026-10-12');
    expect(countedDay('startOfWeek', '2027-01-01')).toBe('2026-12-28');
  });

  it('leaves the named dates, and names that are no date, to others', () => {
    expect(countedDay('today', '2026-10-08')).toBeNull();
    expect(countedDay('-30x', '2026-10-08')).toBeNull();
  });

  it('gives no day for a today it cannot read', () => {
    expect(countedDay('-30d', 'soon')).toBeNull();
    expect(countedDay('+1m', '2026-02-30')).toBeNull();
    expect(countedDay('startOfWeek', 'soon')).toBeNull();
  });
});

describe('addMonths: as the index counts months', () => {
  it('rolls a day the month is too short for into the month after', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-03-03');
    expect(addMonths('2026-03-31', -1)).toBe('2026-03-03');
    expect(addMonths('2024-02-29', 12)).toBe('2025-03-01');
  });

  it('keeps a year below 100 as written, not as 19xx', () => {
    expect(addMonths('0050-06-15', 1)).toBe('0050-07-15');
  });

  it('gives no day past what a date can hold', () => {
    expect(addMonths('9999-12-01', 1)).toBeNull();
    expect(addMonths('0000-01-01', -1)).toBeNull();
    expect(addMonths('soon', 1)).toBeNull();
  });
});

describe('movingDateSql', () => {
  it('binds the count, never writing it into the statement', () => {
    const fragment = movingDateSql('-30d');
    expect(fragment?.text).toBe("date('now', 'localtime', ?)");
    expect(fragment?.values).toEqual(['-30 days']);
    expect(movingDateSql('+2w')?.values).toEqual(['+14 days']);
    expect(movingDateSql('-1y')?.values).toEqual(['-12 months']);
  });

  it('is the named dates’ own SQL for them, and nothing for a name that is no date', () => {
    expect(movingDateSql('today')).toEqual({ text: "date('now', 'localtime')", values: [] });
    expect(movingDateSql('someday')).toBeNull();
    expect(movingDateSql('constructor')).toBeNull();
  });
});
