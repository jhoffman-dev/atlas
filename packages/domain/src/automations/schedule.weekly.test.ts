import { describe, expect, it } from 'vitest';
import { dueTrigger } from './automation-due.ts';
import type { AutomationRule } from './automation-rule.ts';
import type { LogEntry } from './run-log.ts';
import {
  describeSchedule,
  isDue,
  nextRunAfter,
  parseSchedule,
  printSchedule,
  slotAtOrBefore,
  WEEKDAYS,
  type Schedule,
} from './schedule.ts';

/**
 * #40: a weekly schedule — "Fridays at 15:00" — read, written, and counted
 * on the wall clock. 2026-10-23 is a Friday; in Europe the clocks go back on
 * Sunday 2026-10-25 and in the US on Sunday 2026-11-01, and forward on
 * Sunday 2026-03-08 (US) and 2026-03-29 (Europe).
 */

const FRIDAYS_3PM: Schedule = { kind: 'weekly', day: 'friday', at: '15:00' };

describe('parseSchedule, weekly', () => {
  it.each([
    ['fridays at 15:00', FRIDAYS_3PM],
    ['Fridays at 15:00', FRIDAYS_3PM],
    ['friday at 15:00', FRIDAYS_3PM],
    ['every friday at 15:00', FRIDAYS_3PM],
    ['weekly on friday at 15:00', FRIDAYS_3PM],
    ['fri at 15:00', FRIDAYS_3PM],
    ['  Mondays   at 7:30 ', { kind: 'weekly', day: 'monday', at: '07:30' }],
    ['sundays at 00:00', { kind: 'weekly', day: 'sunday', at: '00:00' }],
    ['wed at 23:59', { kind: 'weekly', day: 'wednesday', at: '23:59' }],
  ])('reads %j', (text, schedule) => expect(parseSchedule(text)).toEqual(schedule));

  it.each([
    'fridays at 24:00',
    'fridays at 15:60',
    'fridays at 15',
    'fridays',
    'funday at 15:00',
    'fr at 15:00',
    'every 2 fridays at 15:00',
    'friday and monday at 15:00',
  ])('refuses %j', (text) => expect(parseSchedule(text)).toBeNull());

  it('writes every day of the week so that it reads back', () => {
    for (const day of WEEKDAYS) {
      const schedule: Schedule = { kind: 'weekly', day, at: '09:05' };
      expect(printSchedule(schedule)).toBe(`${day}s at 09:05`);
      expect(parseSchedule(printSchedule(schedule))).toEqual(schedule);
    }
  });

  it('says it in a sentence', () => {
    expect(describeSchedule(FRIDAYS_3PM)).toBe('Every Friday at 15:00');
    expect(describeSchedule({ kind: 'weekly', day: 'sunday', at: '08:00' })).toBe(
      'Every Sunday at 08:00',
    );
  });
});

describe('nextRunAfter, weekly', () => {
  it.each([
    ['earlier the same Friday', '2026-10-23T09:00:00', '2026-10-23T15:00:00'],
    ['on the Monday before', '2026-10-19T08:00:00', '2026-10-23T15:00:00'],
    ['the Saturday before', '2026-10-17T10:00:00', '2026-10-23T15:00:00'],
    ['at its own time', '2026-10-23T15:00:00', '2026-10-30T15:00:00'],
    ['a minute after it', '2026-10-23T15:01:00', '2026-10-30T15:00:00'],
    ['across a month', '2026-10-30T16:00:00', '2026-11-06T15:00:00'],
    ['across a year', '2026-12-26T00:00:00', '2027-01-01T15:00:00'],
  ])('from %s', (_, since, next) => expect(nextRunAfter(FRIDAYS_3PM, since)).toBe(next));

  it('falls on the day named, whichever day it is counted from', () => {
    for (const day of WEEKDAYS) {
      const next = nextRunAfter({ kind: 'weekly', day, at: '12:00' }, '2026-10-21T13:00:00')!;
      const weekday = WEEKDAYS[new Date(`${next}Z`).getUTCDay()];
      expect(weekday).toBe(day);
      expect(next > '2026-10-21T13:00:00').toBe(true);
      expect(next <= '2026-10-28T13:00:00').toBe(true);
    }
  });

  it('stays at 15:00 on the wall clock across the clocks going back and forward', () => {
    // Counted in whole days of the wall clock: no hour is gained or lost.
    expect(nextRunAfter(FRIDAYS_3PM, '2026-10-23T15:00:00')).toBe('2026-10-30T15:00:00');
    expect(nextRunAfter(FRIDAYS_3PM, '2026-10-30T15:00:00')).toBe('2026-11-06T15:00:00');
    expect(nextRunAfter(FRIDAYS_3PM, '2026-03-06T15:00:00')).toBe('2026-03-13T15:00:00');
    expect(nextRunAfter(FRIDAYS_3PM, '2026-03-27T15:00:00')).toBe('2026-04-03T15:00:00');
  });

  it('is due on the morning the clocks go forward past a time that never shows', () => {
    const sundays = { kind: 'weekly', day: 'sunday', at: '02:30' } as const;
    // 02:30 on 2026-03-08 never shows in the US: the clock reads 01:59, then 03:00.
    expect(
      isDue({ schedule: sundays, since: '2026-03-01T02:30:00', now: '2026-03-08T01:59:00' }),
    ).toBe(false);
    expect(
      isDue({ schedule: sundays, since: '2026-03-01T02:30:00', now: '2026-03-08T03:00:00' }),
    ).toBe(true);
  });

  it('runs once on the night the clocks go back, though 01:30 shows twice', () => {
    const sundays = { kind: 'weekly', day: 'sunday', at: '01:30' } as const;
    // It ran at the first 01:30 of 2026-11-01; the wall clock reads 01:30 again an hour on.
    expect(
      isDue({ schedule: sundays, since: '2026-11-01T01:30:00', now: '2026-11-01T01:30:00' }),
    ).toBe(false);
    expect(
      isDue({ schedule: sundays, since: '2026-11-01T01:30:00', now: '2026-11-01T01:59:59' }),
    ).toBe(false);
  });
});

describe('slotAtOrBefore', () => {
  it.each([
    ['at the slot itself', '2026-10-23T15:00:00', '2026-10-23T15:00:00'],
    ['later that Friday', '2026-10-23T22:00:00', '2026-10-23T15:00:00'],
    ['the Saturday after', '2026-10-24T09:00:00', '2026-10-23T15:00:00'],
    ['the Thursday after', '2026-10-29T23:59:59', '2026-10-23T15:00:00'],
    ['a second before the next', '2026-10-30T14:59:59', '2026-10-23T15:00:00'],
    ['the Friday morning before its time', '2026-10-23T09:00:00', '2026-10-16T15:00:00'],
    ['across a year', '2027-01-02T00:00:00', '2027-01-01T15:00:00'],
  ])('a weekly schedule, %s', (_, at, slot) => expect(slotAtOrBefore(FRIDAYS_3PM, at)).toBe(slot));

  it('is the day for a daily schedule, the day before until its time', () => {
    const daily: Schedule = { kind: 'daily', at: '07:00' };
    expect(slotAtOrBefore(daily, '2026-10-23T07:00:00')).toBe('2026-10-23T07:00:00');
    expect(slotAtOrBefore(daily, '2026-10-23T23:00:00')).toBe('2026-10-23T07:00:00');
    expect(slotAtOrBefore(daily, '2026-10-23T06:59:59')).toBe('2026-10-22T07:00:00');
    expect(slotAtOrBefore(daily, '2026-03-01T06:00:00')).toBe('2026-02-28T07:00:00');
  });

  it('has none for a schedule with no time of its own, or no moment', () => {
    expect(slotAtOrBefore({ kind: 'hourly', every: 6 }, '2026-10-23T15:00:00')).toBeNull();
    expect(slotAtOrBefore({ kind: 'manual' }, '2026-10-23T15:00:00')).toBeNull();
    expect(slotAtOrBefore({ kind: 'open' }, '2026-10-23T15:00:00')).toBeNull();
    expect(slotAtOrBefore(FRIDAYS_3PM, 'Friday')).toBeNull();
  });
});

describe('a Friday rule on the clock (#40 acceptance: runs only on Fridays, once)', () => {
  const RULE: AutomationRule = {
    id: 'Friday review',
    path: '.atlas/automations/Friday review.md' as AutomationRule['path'],
    name: 'Friday review',
    enabled: true,
    when: FRIDAYS_3PM,
    which: '',
    olderThanDays: null,
    action: { kind: 'archive' },
  };
  const ran = (at: string): LogEntry => ({
    kind: 'run',
    at,
    trigger: 'schedule',
    done: [],
    left: [],
    capped: false,
  });
  const due = (log: readonly LogEntry[], now: string) =>
    dueTrigger({ rule: RULE, log, now, watchingSince: '2026-10-01T00:00:00', opening: false });

  it('is not due on any other day of the week', () => {
    const log = [ran('2026-10-16T15:00:00')];
    for (const day of ['17', '18', '19', '20', '21', '22']) {
      for (const time of ['00:00:00', '15:00:00', '23:59:59']) {
        expect(due(log, `2026-10-${day}T${time}`)).toBeNull();
      }
    }
    expect(due(log, '2026-10-23T14:59:59')).toBeNull();
  });

  it('is due at 15:00 on Friday, and once it has run, not again that week', () => {
    expect(due([ran('2026-10-16T15:00:00')], '2026-10-23T15:00:00')).toBe('schedule');
    const after = [ran('2026-10-16T15:00:00'), ran('2026-10-23T15:00:05')];
    for (const now of ['2026-10-23T15:01:00', '2026-10-24T09:00:00', '2026-10-30T14:59:59']) {
      expect(due(after, now)).toBeNull();
    }
    expect(due(after, '2026-10-30T15:00:00')).toBe('schedule');
  });

  it('catches a Friday missed while DFAI was closed up once, on opening Saturday', () => {
    const log = [ran('2026-10-09T15:00:00')];
    expect(due(log, '2026-10-24T08:00:00')).toBe('schedule');
    expect(due([...log, ran('2026-10-24T08:00:00')], '2026-10-24T08:05:00')).toBeNull();
  });
});
