/**
 * A month as a grid of weeks.
 *
 * Every rule here is pure and takes the date to work from, so a calendar can be
 * tested without waiting for a Tuesday. Days from the months either side are
 * included and marked, because a month that starts mid-week needs them to make
 * a rectangle.
 */
export interface CalendarDay {
  /** The day, as `2026-09-20`. */
  readonly date: string;
  readonly dayOfMonth: number;
  /** False for the days borrowed from the months either side. */
  readonly inMonth: boolean;
}

export interface MonthGrid {
  /** The month shown, as `2026-09`. */
  readonly month: string;
  readonly label: string;
  readonly weeks: readonly (readonly CalendarDay[])[];
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Monday first: a week that ends on the weekend reads better for work. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/** Midnight UTC on a day; `Date.UTC` would read a year below 100 as 1900 + year. */
function utcDay(year: number, monthIndex: number, day: number): Date {
  const at = new Date(0);
  at.setUTCFullYear(year, monthIndex, day);
  return at;
}

/** Reads `2026-09-20` or `2026-09` into a date, or null if it is neither. */
export function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})/.exec(value.trim());
  if (match === null) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** The month a date falls in, as `2026-09`. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** The month before or after this one, as `2026-09`. */
export function shiftMonth(month: string, by: number): string {
  const parsed = parseMonth(month);
  if (parsed === null) return month;
  const shifted = utcDay(parsed.year, parsed.month - 1 + by, 1);
  return isoDate(shifted).slice(0, 7);
}

export function monthGrid(month: string): MonthGrid | null {
  const parsed = parseMonth(month);
  if (parsed === null) return null;

  const first = utcDay(parsed.year, parsed.month - 1, 1);
  // getUTCDay is Sunday-first; shift so Monday is 0.
  const leading = (first.getUTCDay() + 6) % 7;

  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - leading);

  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);

  // Six weeks always: a month can span six, and a grid that changes height as
  // you page through the year is worse than one row of spare days.
  for (let week = 0; week < 6; week += 1) {
    const days: CalendarDay[] = [];
    for (let day = 0; day < 7; day += 1) {
      days.push({
        date: isoDate(cursor),
        dayOfMonth: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === parsed.month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(days);
  }

  return {
    month: `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}`,
    label: `${MONTH_NAMES[parsed.month - 1] ?? ''} ${parsed.year}`,
    weeks,
  };
}
