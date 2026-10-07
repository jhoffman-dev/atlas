import { describe, expect, it } from 'vitest';
import { calendarEvents, type CalendarEvent } from './calendar-event.ts';
import { layoutDay } from './time-grid.ts';

const DAY = '2026-09-22';

function at(title: string, start: string, end: string | null = null): CalendarEvent {
  const [found] = calendarEvents({
    rows: [
      {
        path: `${title}.md`,
        title,
        values: { due: `${DAY}T${start}`, end: end === null ? null : `${DAY}T${end}` },
      },
    ],
    dateKey: 'due',
    endKey: 'end',
  }).events;
  if (found === undefined) throw new Error(start);
  return found;
}

/** Each block as `title lane/lanes`, in the order laid out. */
const lanes = (events: CalendarEvent[]) =>
  layoutDay(events, DAY).map((block) => `${block.event.title} ${block.lane}/${block.lanes}`);

describe('layoutDay', () => {
  it('gives a note alone the whole width', () => {
    expect(lanes([at('a', '09:00', '10:00')])).toEqual(['a 0/1']);
  });

  it('splits two overlapping notes in half', () => {
    expect(lanes([at('a', '09:00', '10:00'), at('b', '09:30', '10:30')])).toEqual([
      'a 0/2',
      'b 1/2',
    ]);
  });

  it('lets a note that starts as another ends have the whole width', () => {
    expect(lanes([at('a', '09:00', '10:00'), at('b', '10:00', '11:00')])).toEqual([
      'a 0/1',
      'b 0/1',
    ]);
  });

  it('reuses a freed lane, and sizes the whole run by its busiest moment', () => {
    // a runs long; b ends before c starts, so c takes b's lane: two lanes, not three.
    expect(
      lanes([at('a', '09:00', '12:00'), at('b', '09:00', '10:00'), at('c', '10:30', '11:00')]),
    ).toEqual(['a 0/2', 'b 1/2', 'c 1/2']);
  });

  it('puts three at once in thirds, and the longer of two starting together on the left', () => {
    expect(
      lanes([at('short', '09:00', '09:30'), at('long', '09:00', '11:00'), at('mid', '09:15')]),
    ).toEqual(['long 0/3', 'short 1/3', 'mid 2/3']);
  });

  it('starts a new run once every earlier note has ended', () => {
    expect(
      lanes([at('a', '09:00', '10:00'), at('b', '09:30', '10:00'), at('c', '13:00', '14:00')]),
    ).toEqual(['a 0/2', 'b 1/2', 'c 0/1']);
  });

  it('gives a very short note room to be hit, inside the day', () => {
    const [short] = layoutDay([at('blip', '10:00', '10:05')], DAY);
    expect([short?.from, short?.to]).toEqual([600, 615]);
    const [last] = layoutDay([at('late', '23:55')], DAY);
    expect([last?.from, last?.to]).toEqual([1425, 1440]);
  });

  it('leaves all-day notes and other days off the clock', () => {
    const allDay = calendarEvents({
      rows: [
        { path: 'd.md', title: 'd', values: { due: DAY } },
        { path: 'e.md', title: 'e', values: { due: '2026-09-23T10:00' } },
      ],
      dateKey: 'due',
      endKey: null,
    }).events;
    expect(layoutDay(allDay, DAY)).toEqual([]);
  });
});
