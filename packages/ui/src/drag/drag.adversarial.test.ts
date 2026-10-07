// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Active, DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import type { TimelineEntry } from '@atlas/domain';
import { spokenDate } from './announcements.ts';
import { useBarDrag } from './bar-drag.ts';

/** Adversarial: the edges of the calendar the drag maths leans on. */

const DAY = 26;

function bar(start: string, end: string, span: number): TimelineEntry {
  return {
    path: 'plan.md',
    title: 'Plan',
    start,
    end,
    offset: 0,
    span,
    milestone: start === end,
    values: {},
  };
}

/** A keyboard pick-up, then a drop `days` whole days along. */
function dragByKeyboard(entry: TimelineEntry, days: number) {
  const onReschedule = vi.fn();
  const { result } = renderHook(() =>
    useBarDrag({ entries: [entry], dayWidth: DAY, onReschedule }),
  );
  const active = {
    id: entry.path,
    rect: { current: { initial: { left: 0 }, translated: null } },
  } as unknown as Active;
  result.current.onDragStart({
    active,
    activatorEvent: new KeyboardEvent('keydown', { code: 'Space' }),
  } as DragStartEvent);
  result.current.onDragEnd({
    active,
    delta: { x: days * DAY, y: 0 },
    over: null,
  } as unknown as DragEndEvent);
  return onReschedule;
}

describe('a timeline bar moved by the keyboard', () => {
  it('moves both ends across a leap day and a year end (control)', () => {
    const moved = dragByKeyboard(bar('2027-12-30', '2028-02-28', 61), 2);
    expect(moved).toHaveBeenCalledWith({ path: 'plan.md', start: '2028-01-01', end: '2028-03-01' });
  });

  it('keeps its length, or does not move, at the last day a date can be written', () => {
    // A three-day bar ending on 9999-12-31, moved a day later. The end cannot
    // be written as 10000-01-01, so `addDays` leaves it where it was — and the
    // start moves anyway. The bar is rewritten a day shorter, as one edit.
    const moved = dragByKeyboard(bar('9999-12-29', '9999-12-31', 3), 1);

    const lengths = moved.mock.calls.map(([args]) => {
      const { start, end } = args as { start: string; end: string };
      return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
    });
    // Not moving at all is fine; moving and changing length is not.
    expect(lengths.every((length) => length === 2)).toBe(true);
  });
});

describe('spokenDate, before the year 100', () => {
  it('names the weekday of the year written, not of the year 1900 more', () => {
    // 0024-01-01 is a Monday (proleptic Gregorian, as `setUTCFullYear` gives
    // it). `Date.UTC(24, 0, 1)` is 1924-01-01, a Tuesday: `Date.UTC` reads the
    // years 0 to 99 as 1900 to 1999.
    const expected = new Date(0);
    expected.setUTCFullYear(24, 0, 1);
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
      expected.getUTCDay()
    ];
    expect(weekday).toBe('Monday');

    expect(spokenDate('0024-01-01')).toBe('Monday 1 January 24');
  });
});
