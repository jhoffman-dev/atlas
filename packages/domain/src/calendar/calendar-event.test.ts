import { describe, expect, it } from 'vitest';
import {
  calendarEndKey,
  calendarEvents,
  daySpan,
  dayOverflow,
  effectiveEnd,
  eventsInDays,
  eventsOn,
  occursOn,
  readEventTime,
  timeLabel,
  type CalendarEvent,
} from './calendar-event.ts';
import { useZone, ZONES } from './zones.test-support.ts';

/** An event from its start and end as a note would write them. */
function event(title: string, start: string, end: string | null = null): CalendarEvent {
  const [found] = calendarEvents({
    rows: [{ path: `${title}.md`, title, values: { due: start, end } }],
    dateKey: 'due',
    endKey: 'end',
  }).events;
  if (found === undefined) throw new Error(`${start} is not a date`);
  return found;
}

describe('readEventTime', () => {
  it.each([
    ['2026-09-22', { date: '2026-09-22', minutes: null }],
    ['2026-09-22T14:30', { date: '2026-09-22', minutes: 870 }],
    ['2026-09-22 09:05', { date: '2026-09-22', minutes: 545 }],
    ['2026-09-22T14:30:00Z', { date: '2026-09-22', minutes: 870 }],
    [' 2026-09-22T00:00 ', { date: '2026-09-22', minutes: 0 }],
  ])('reads %j', (value, expected) => {
    expect(readEventTime(value)).toEqual(expected);
  });

  it.each(['', 'soon', '2026-02-30', '2026-09-22T24:00', '2026-09-22T12:60', 20260922, null])(
    'refuses %j',
    (value) => {
      expect(readEventTime(value)).toBeNull();
    },
  );
});

describe('calendarEndKey', () => {
  it("reads the timeline's end when its start is the calendar's date", () => {
    expect(calendarEndKey({ dateKey: 'due', startKey: 'due', endKey: 'end' })).toBe('end');
  });

  it('has none when the timeline starts elsewhere, or ends where it starts', () => {
    expect(calendarEndKey({ dateKey: 'due', startKey: 'start', endKey: 'end' })).toBeNull();
    expect(calendarEndKey({ dateKey: 'due', startKey: 'due', endKey: 'due' })).toBeNull();
    expect(calendarEndKey({ dateKey: 'due', startKey: null, endKey: null })).toBeNull();
  });
});

describe('calendarEvents', () => {
  it('counts notes with no readable date rather than placing them', () => {
    const { events, unscheduled } = calendarEvents({
      rows: [
        { path: 'a.md', title: 'a', values: { due: '2026-09-22' } },
        { path: 'b.md', title: 'b', values: { due: null } },
        { path: 'c.md', title: 'c', values: { due: 'someday' } },
      ],
      dateKey: 'due',
      endKey: null,
    });
    expect(events.map((found) => found.path)).toEqual(['a.md']);
    expect(unscheduled).toBe(2);
  });

  it('ignores an end before the start', () => {
    expect(event('x', '2026-09-22T10:00', '2026-09-22T09:00').end).toBeNull();
    expect(event('x', '2026-09-22', '2026-09-21').end).toBeNull();
    expect(event('x', '2026-09-22', '2026-09-24').end).toEqual({
      date: '2026-09-24',
      minutes: null,
    });
  });
});

describe.each(ZONES)('event days and times in %s', (zone) => {
  useZone(zone);

  it('draws a timed note with no end as half an hour', () => {
    expect(daySpan(event('x', '2026-09-22T14:30'), '2026-09-22')).toEqual({ from: 870, to: 900 });
  });

  it('spans its end when it has one', () => {
    const meeting = event('x', '2026-09-22T14:30', '2026-09-22T16:00');
    expect(daySpan(meeting, '2026-09-22')).toEqual({ from: 870, to: 960 });
    expect(timeLabel(meeting, '2026-09-22')).toBe('14:30 – 16:00');
  });

  it('runs past midnight onto the next day, and stops there', () => {
    const late = event('x', '2026-10-24T23:00', '2026-10-25T01:30');
    expect(daySpan(late, '2026-10-24')).toEqual({ from: 1380, to: 1440 });
    expect(daySpan(late, '2026-10-25')).toEqual({ from: 0, to: 90 });
    expect(daySpan(late, '2026-10-26')).toBeNull();
    expect(timeLabel(late, '2026-10-24')).toBe('23:00 – 24:00');
  });

  it('carries the default half hour past midnight', () => {
    const late = event('x', '2026-03-07T23:45');
    expect(effectiveEnd(late)).toEqual({ date: '2026-03-08', minutes: 15 });
    expect(daySpan(late, '2026-03-08')).toEqual({ from: 0, to: 15 });
  });

  it('ends a note at the close of 9999-12-31 rather than before it starts', () => {
    const last = event('x', '9999-12-31T23:45');
    expect(effectiveEnd(last)).toEqual({ date: '9999-12-31', minutes: 1440 });
  });

  it('is not on the clock on the day after it ends at midnight', () => {
    const toMidnight = event('x', '2026-09-22T22:00', '2026-09-23T00:00');
    expect(occursOn(toMidnight, '2026-09-23')).toBe(false);
  });

  it('puts an all-day note on each of its days, and off the clock', () => {
    const trip = event('trip', '2026-03-07', '2026-03-09');
    expect(
      ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'].map((date) =>
        occursOn(trip, date),
      ),
    ).toEqual([false, true, true, true, false]);
    expect(daySpan(trip, '2026-03-08')).toBeNull();
    expect(timeLabel(trip, '2026-03-08')).toBe('All day');
  });

  it('keeps a date-only note on its own date, whatever the zone', () => {
    const due = event('due', '2026-09-22');
    expect(occursOn(due, '2026-09-21')).toBe(false);
    expect(occursOn(due, '2026-09-22')).toBe(true);
    expect(occursOn(due, '2026-09-23')).toBe(false);
  });
});

describe('eventsOn', () => {
  it('lists all-day notes first, then by time, then by name', () => {
    const day = eventsOn(
      [
        event('late', '2026-09-22T16:00'),
        event('b all day', '2026-09-22'),
        event('early', '2026-09-22T08:00'),
        event('a all day', '2026-09-22'),
        event('elsewhere', '2026-09-23'),
      ],
      '2026-09-22',
    );
    expect(day.map((found) => found.title)).toEqual(['a all day', 'b all day', 'early', 'late']);
  });
});

describe('dayOverflow', () => {
  it('shows everything that fits', () => {
    expect(dayOverflow([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], hidden: [] });
  });

  it('gives the last row to "+N more" when they do not fit', () => {
    expect(dayOverflow([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], hidden: [3, 4, 5] });
  });

  it('hides everything when not even one row is spare', () => {
    expect(dayOverflow([1, 2], 1)).toEqual({ shown: [], hidden: [1, 2] });
  });
});

describe('eventsInDays', () => {
  const DAYS = ['2026-09-21', '2026-09-22', '2026-09-23'];

  it('lists each note on the days with the days it is on, by first day, then as a day lists them', () => {
    const trip = event('Trip', '2026-09-20', '2026-09-22');
    const standup = event('Standup', '2026-09-22T09:00');
    const review = event('Review', '2026-09-22');
    const late = event('Late', '2026-09-21T23:30', '2026-09-22T01:00');

    const placed = eventsInDays({ events: [standup, review, trip, late], days: DAYS });

    expect(placed.map(({ event: found, on }) => [found.title, on])).toEqual([
      ['Trip', ['2026-09-21', '2026-09-22']],
      ['Late', ['2026-09-21', '2026-09-22']],
      ['Review', ['2026-09-22']],
      ['Standup', ['2026-09-22']],
    ]);
  });

  it('leaves out notes on none of the days, before or after', () => {
    const before = event('Before', '2026-09-20');
    const after = event('After', '2026-09-24T10:00');
    expect(eventsInDays({ events: [before, after], days: DAYS })).toEqual([]);
  });

  it('places nothing on no days', () => {
    expect(eventsInDays({ events: [event('Any', '2026-09-22')], days: [] })).toEqual([]);
  });
});
