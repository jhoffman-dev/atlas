import { describe, expect, it } from 'vitest';
import {
  describeSchedule,
  isDue,
  localTimeMs,
  localTimeOf,
  nextRunAfter,
  parseSchedule,
  printSchedule,
  type Schedule,
} from './schedule.ts';

const DAILY_3AM: Schedule = { kind: 'daily', at: '03:00' };

describe('parseSchedule', () => {
  it.each([
    ['daily at 03:00', { kind: 'daily', at: '03:00' }],
    ['Daily at 7:30', { kind: 'daily', at: '07:30' }],
    ['  daily   at 23:59 ', { kind: 'daily', at: '23:59' }],
    ['every 6 hours', { kind: 'hourly', every: 6 }],
    ['every 1 hour', { kind: 'hourly', every: 1 }],
    ['every 168 hours', { kind: 'hourly', every: 168 }],
    ['on app open', { kind: 'open' }],
    ['manually', { kind: 'manual' }],
  ])('reads %j', (text, schedule) => expect(parseSchedule(text)).toEqual(schedule));

  it.each([
    'daily at 24:00',
    'daily at 03:60',
    'daily at 3',
    'every 0 hours',
    'every 169 hours',
    'every -1 hours',
    'weekly',
    '',
    3,
    null,
    undefined,
    { kind: 'open' },
  ])('refuses %j', (value) => expect(parseSchedule(value)).toBeNull());

  it.each<Schedule>([
    DAILY_3AM,
    { kind: 'hourly', every: 1 },
    { kind: 'hourly', every: 12 },
    { kind: 'open' },
    { kind: 'manual' },
  ])('reads back what it prints: %j', (schedule) =>
    expect(parseSchedule(printSchedule(schedule))).toEqual(schedule),
  );
});

describe('describeSchedule', () => {
  it('says each schedule in a sentence', () => {
    expect(describeSchedule(DAILY_3AM)).toBe('Every day at 03:00');
    expect(describeSchedule({ kind: 'hourly', every: 1 })).toBe('Every hour');
    expect(describeSchedule({ kind: 'hourly', every: 6 })).toBe('Every 6 hours');
    expect(describeSchedule({ kind: 'open' })).toBe('When Atlas opens');
    expect(describeSchedule({ kind: 'manual' })).toBe('Only when run by hand');
  });
});

describe('local times', () => {
  it('round-trips a wall-clock time through milliseconds', () => {
    const at = localTimeMs('2026-09-27T03:00:00');
    expect(at).toBe(Date.UTC(2026, 8, 27, 3));
    expect(localTimeOf(at!)).toBe('2026-09-27T03:00:00');
  });

  it.each(['2026-02-30T03:00:00', '2026-09-27 03:00:00', '2026-09-27T25:00:00', 'soon'])(
    'refuses %j',
    (text) => expect(localTimeMs(text)).toBeNull(),
  );
});

describe('nextRunAfter', () => {
  it('is later the same day when the time has not come yet', () => {
    expect(nextRunAfter(DAILY_3AM, '2026-09-27T01:15:00')).toBe('2026-09-27T03:00:00');
  });

  it('is the next day once the time has passed, or is the moment itself', () => {
    expect(nextRunAfter(DAILY_3AM, '2026-09-27T03:00:00')).toBe('2026-09-28T03:00:00');
    expect(nextRunAfter(DAILY_3AM, '2026-09-27T14:00:00')).toBe('2026-09-28T03:00:00');
  });

  it('crosses a month and a year', () => {
    expect(nextRunAfter(DAILY_3AM, '2026-12-31T22:00:00')).toBe('2027-01-01T03:00:00');
  });

  it('counts hours on from the last run', () => {
    expect(nextRunAfter({ kind: 'hourly', every: 6 }, '2026-09-27T21:30:00')).toBe(
      '2026-09-28T03:30:00',
    );
  });

  it('has none for a rule that runs on opening or by hand, or from no time', () => {
    expect(nextRunAfter({ kind: 'open' }, '2026-09-27T03:00:00')).toBeNull();
    expect(nextRunAfter({ kind: 'manual' }, '2026-09-27T03:00:00')).toBeNull();
    expect(nextRunAfter(DAILY_3AM, 'yesterday')).toBeNull();
  });
});

describe('isDue', () => {
  it('is due once its time has come, not before', () => {
    const since = '2026-09-26T03:00:05';
    expect(isDue({ schedule: DAILY_3AM, since, now: '2026-09-27T02:59:59' })).toBe(false);
    expect(isDue({ schedule: DAILY_3AM, since, now: '2026-09-27T03:00:00' })).toBe(true);
  });

  it('catches up a week of missed runs with one, then waits for the next', () => {
    const opened = '2026-10-04T09:00:00';
    expect(isDue({ schedule: DAILY_3AM, since: '2026-09-27T03:00:01', now: opened })).toBe(true);
    // The catch-up run is the new mark: nothing more is due until tomorrow's 03:00.
    expect(isDue({ schedule: DAILY_3AM, since: opened, now: '2026-10-04T09:01:00' })).toBe(false);
    expect(isDue({ schedule: DAILY_3AM, since: opened, now: '2026-10-05T03:00:00' })).toBe(true);
  });

  it('is never due by the clock for a rule that runs on opening or by hand', () => {
    const times = { since: '2026-01-01T00:00:00', now: '2026-12-31T00:00:00' };
    expect(isDue({ schedule: { kind: 'open' }, ...times })).toBe(false);
    expect(isDue({ schedule: { kind: 'manual' }, ...times })).toBe(false);
  });
});
