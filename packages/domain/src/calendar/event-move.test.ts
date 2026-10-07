import { describe, expect, it } from 'vitest';
import { calendarEvents } from './calendar-event.ts';
import { movedEvent, resizedEnd, slotValue, snapMinutes, snappedMove } from './event-move.ts';
import { useZone, ZONES } from './zones.test-support.ts';

function eventOf(start: string, end: string | null) {
  const [found] = calendarEvents({
    rows: [{ path: 'a.md', title: 'a', values: { due: start, end } }],
    dateKey: 'due',
    endKey: 'end',
  }).events;
  if (found === undefined) throw new Error(start);
  return found;
}

describe('snapping', () => {
  it('rounds to the quarter hour', () => {
    expect([snapMinutes(7), snapMinutes(8), snapMinutes(-8), snapMinutes(52)]).toEqual([
      0, 15, -15, 45,
    ]);
  });

  it('lands a held note on the quarter hour, unless it was barely moved', () => {
    expect(snappedMove(847, 3)).toBe(0);
    expect(snappedMove(847, 40)).toBe(38); // 14:07 + 40 = 14:47, lands 14:45
    expect(snappedMove(870, -30)).toBe(-30);
  });
});

describe.each(ZONES)('movedEvent in %s', (zone) => {
  useZone(zone);

  it('keeps a date-only value date-only, whatever the clock drag', () => {
    expect(movedEvent({ start: '2026-09-22', end: null, days: 2, minutes: 90 })).toEqual({
      start: '2026-09-24',
      end: null,
    });
  });

  it('moves a date-time by days and minutes, keeping what followed the minutes', () => {
    expect(movedEvent({ start: '2026-09-22T14:30', end: null, days: 1, minutes: 60 }).start).toBe(
      '2026-09-23T15:30',
    );
    expect(
      movedEvent({ start: '2026-09-22T14:30:00Z', end: null, days: 0, minutes: -15 }).start,
    ).toBe('2026-09-22T14:15:00Z');
    expect(movedEvent({ start: '2026-09-22 14:30', end: null, days: -1, minutes: 0 }).start).toBe(
      '2026-09-21 14:30',
    );
  });

  it('crosses midnight rather than wrapping the clock', () => {
    expect(movedEvent({ start: '2026-10-24T23:30', end: null, days: 0, minutes: 60 }).start).toBe(
      '2026-10-25T00:30',
    );
    expect(movedEvent({ start: '2026-03-08T00:30', end: null, days: 0, minutes: -60 }).start).toBe(
      '2026-03-07T23:30',
    );
  });

  it('does not lose or gain an hour across a daylight-saving change', () => {
    // 01:30 on the night Europe and the US change the clocks is written as it is set.
    expect(movedEvent({ start: '2026-03-28T01:30', end: null, days: 1, minutes: 0 }).start).toBe(
      '2026-03-29T01:30',
    );
    expect(movedEvent({ start: '2026-10-31T01:30', end: null, days: 1, minutes: 0 }).start).toBe(
      '2026-11-01T01:30',
    );
  });

  it('moves a timed end with its start, so the note keeps its length', () => {
    expect(
      movedEvent({ start: '2026-09-22T14:00', end: '2026-09-22T15:30', days: 1, minutes: 30 }),
    ).toEqual({ start: '2026-09-23T14:30', end: '2026-09-23T16:00' });
  });

  it('moves a day end by the days its start moved', () => {
    expect(movedEvent({ start: '2026-09-22', end: '2026-09-25', days: 3, minutes: 0 })).toEqual({
      start: '2026-09-25',
      end: '2026-09-28',
    });
    expect(
      movedEvent({ start: '2026-09-22T23:00', end: '2026-09-24', days: 0, minutes: 120 }),
    ).toEqual({ start: '2026-09-23T01:00', end: '2026-09-25' });
  });

  it('leaves an end it cannot read, or none, alone', () => {
    expect(movedEvent({ start: '2026-09-22', end: 'later', days: 1, minutes: 0 }).end).toBeNull();
    expect(movedEvent({ start: 'soon', end: '2026-09-22', days: 1, minutes: 0 })).toEqual({
      start: 'soon',
      end: null,
    });
  });
});

describe('resizedEnd', () => {
  it('stretches a note with an end, in the end’s own shape', () => {
    const event = eventOf('2026-09-22T14:00', '2026-09-22T15:00:00Z');
    expect(
      resizedEnd({ event, start: '2026-09-22T14:00', end: '2026-09-22T15:00:00Z', minutes: 30 }),
    ).toBe('2026-09-22T15:30:00Z');
  });

  it("gives a note with no end one, from its default half hour, in the start's shape", () => {
    const event = eventOf('2026-09-22 14:00', null);
    expect(resizedEnd({ event, start: '2026-09-22 14:00', end: null, minutes: 45 })).toBe(
      '2026-09-22 15:15',
    );
  });

  it('never ends a note before a quarter hour after it starts', () => {
    const event = eventOf('2026-09-22T14:00', '2026-09-22T15:00');
    expect(
      resizedEnd({ event, start: '2026-09-22T14:00', end: '2026-09-22T15:00', minutes: -300 }),
    ).toBe('2026-09-22T14:15');
  });

  it('snaps the new end to the quarter hour and carries past midnight', () => {
    const event = eventOf('2026-09-22T23:00', '2026-09-22T23:30');
    expect(
      resizedEnd({ event, start: '2026-09-22T23:00', end: '2026-09-22T23:30', minutes: 50 }),
    ).toBe('2026-09-23T00:15');
  });

  it('does not resize an all-day note', () => {
    const event = eventOf('2026-09-22', null);
    expect(resizedEnd({ event, start: '2026-09-22', end: null, minutes: 30 })).toBeNull();
  });
});

describe('slotValue', () => {
  it('writes a day, or a day and time', () => {
    expect(slotValue('2026-09-22', null)).toBe('2026-09-22');
    expect(slotValue('2026-09-22', 870)).toBe('2026-09-22T14:30');
    expect(slotValue('2026-09-22', 0)).toBe('2026-09-22T00:00');
  });
});

describe('a move at the last day a date can hold', () => {
  it('never moves a note backwards when it is dragged later past 9999-12-31', () => {
    const { start } = movedEvent({ start: '9999-12-31T23:50', end: null, days: 0, minutes: 30 });
    expect(start).not.toBe('9999-12-31T00:20');
    expect(start >= '9999-12-31T23:50').toBe(true);
  });

  it('leaves the note where it was when its end would pass 9999-12-31', () => {
    expect(
      movedEvent({ start: '9999-12-31T23:00', end: '9999-12-31T23:45', days: 0, minutes: 30 }),
    ).toEqual({ start: '9999-12-31T23:00', end: null });
  });

  it('leaves an all-day note where it was rather than shortening it at 9999-12-31', () => {
    expect(movedEvent({ start: '9999-12-30', end: '9999-12-31', days: 1, minutes: 0 })).toEqual({
      start: '9999-12-30',
      end: null,
    });
  });

  it('leaves an all-day note with no end where it was past 9999-12-31', () => {
    expect(movedEvent({ start: '9999-12-31', end: null, days: 1, minutes: 0 })).toEqual({
      start: '9999-12-31',
      end: null,
    });
  });

  it('writes no end past 9999-12-31', () => {
    const event = eventOf('9999-12-31T23:00', '9999-12-31T23:30');
    expect(
      resizedEnd({ event, start: '9999-12-31T23:00', end: '9999-12-31T23:30', minutes: 60 }),
    ).toBeNull();
  });
});
