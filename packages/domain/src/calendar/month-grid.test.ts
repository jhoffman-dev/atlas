import { describe, expect, it } from 'vitest';
import { monthGrid, monthOf, parseMonth, shiftMonth, WEEKDAY_LABELS } from './month-grid.ts';

describe('parseMonth', () => {
  it.each([
    ['2026-09', { year: 2026, month: 9 }],
    ['2026-09-20', { year: 2026, month: 9 }],
    ['  2026-01  ', { year: 2026, month: 1 }],
  ])('reads %j', (value, expected) => {
    expect(parseMonth(value)).toEqual(expected);
  });

  it.each(['', 'September', '2026', '2026-13', '2026-00', '26-09'])(
    'returns nothing for %j',
    (value) => {
      expect(parseMonth(value)).toBeNull();
    },
  );
});

describe('monthOf', () => {
  it('takes the month a date falls in', () => {
    expect(monthOf('2026-09-20')).toBe('2026-09');
  });
});

describe('shiftMonth', () => {
  it('moves forward', () => {
    expect(shiftMonth('2026-09', 1)).toBe('2026-10');
  });

  it('moves back', () => {
    expect(shiftMonth('2026-09', -1)).toBe('2026-08');
  });

  it('crosses a year end', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('stays in the first century rather than jumping to the 1900s', () => {
    expect(shiftMonth('0050-06', 1)).toBe('0050-07');
    expect(shiftMonth('0001-01', -1)).toBe('0000-12');
  });

  it('leaves something it cannot read alone', () => {
    expect(shiftMonth('whenever', 1)).toBe('whenever');
  });
});

describe('monthGrid', () => {
  it('names the month it is showing', () => {
    expect(monthGrid('2026-09')?.label).toBe('September 2026');
  });

  it('always has six weeks, so paging does not change its height', () => {
    for (const month of ['2026-01', '2026-02', '2026-09', '2027-02']) {
      expect(monthGrid(month)?.weeks).toHaveLength(6);
    }
  });

  it('has seven days in every week', () => {
    for (const week of monthGrid('2026-09')?.weeks ?? []) {
      expect(week).toHaveLength(7);
    }
  });

  it('starts the week on Monday', () => {
    expect(WEEKDAY_LABELS[0]).toBe('Mon');
    // 1 September 2026 is a Tuesday, so the grid opens on Monday the 31st.
    expect(monthGrid('2026-09')?.weeks[0]?.[0]?.date).toBe('2026-08-31');
  });

  it('marks the days borrowed from the months either side', () => {
    const grid = monthGrid('2026-09');
    expect(grid?.weeks[0]?.[0]).toMatchObject({ date: '2026-08-31', inMonth: false });
    expect(grid?.weeks[0]?.[1]).toMatchObject({ date: '2026-09-01', inMonth: true });
  });

  it('holds every day of the month exactly once', () => {
    const days = (monthGrid('2026-09')?.weeks ?? [])
      .flat()
      .filter((day) => day.inMonth)
      .map((day) => day.date);
    expect(days).toHaveLength(30);
    expect(new Set(days).size).toBe(30);
    expect(days[0]).toBe('2026-09-01');
    expect(days.at(-1)).toBe('2026-09-30');
  });

  it('handles February in a leap year', () => {
    const days = (monthGrid('2028-02')?.weeks ?? []).flat().filter((day) => day.inMonth);
    expect(days).toHaveLength(29);
  });

  it('runs its days in order, with no gaps', () => {
    const dates = (monthGrid('2026-09')?.weeks ?? []).flat().map((day) => day.date);
    for (let index = 1; index < dates.length; index += 1) {
      const previous = new Date(`${dates[index - 1]}T00:00:00Z`);
      previous.setUTCDate(previous.getUTCDate() + 1);
      expect(dates[index]).toBe(previous.toISOString().slice(0, 10));
    }
  });

  it('accepts a full date and shows the month around it', () => {
    expect(monthGrid('2026-09-20')?.month).toBe('2026-09');
  });

  it('returns nothing for something it cannot read', () => {
    expect(monthGrid('whenever')).toBeNull();
  });
});
