/**
 * How much of the calendar a view shows at once, and how it pages.
 *
 * Every date here is a calendar date written `2026-09-24`, never an instant:
 * the arithmetic is done on the date in UTC, so no timezone — and no daylight
 * saving change — can move a day across midnight.
 */
import { addDays } from '../timeline/timeline.ts';
import { formatPropertyDate } from '../page/property-date.ts';
import { monthGrid } from './month-grid.ts';

/** A month grid, a week, three days, one day, or a list from a day on. */
export type CalendarRange = 'month' | 'week' | '3day' | 'day' | 'agenda';

/** In the order the range switcher offers them. */
export const CALENDAR_RANGES: readonly CalendarRange[] = ['month', 'week', '3day', 'day', 'agenda'];

/** What a view that names no range, or one the app does not know, shows. */
export const DEFAULT_CALENDAR_RANGE: CalendarRange = 'month';

/** How many days an agenda lists before "Load more", and how far it pages. */
export const AGENDA_DAYS = 30;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const PLAIN_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A range as a view note writes it; anything else is the default. */
export function asCalendarRange(value: unknown): CalendarRange {
  const declared = String(value ?? '').trim();
  return CALENDAR_RANGES.find((range) => range === declared) ?? DEFAULT_CALENDAR_RANGE;
}

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** A plain `2026-09-24` as its parts, or null when it is not a real day. */
export function dateParts(date: string): DateParts | null {
  const match = PLAIN_DATE.exec(date);
  if (match === null) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const at = new Date(0);
  at.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  const real = at.getUTCMonth() === parts.month - 1 && at.getUTCDate() === parts.day;
  return real ? parts : null;
}

/** 0 for Monday through 6 for Sunday: weeks start on Monday, as the month grid's do. */
export function weekdayIndex(date: string): number {
  const parts = dateParts(date);
  if (parts === null) return 0;
  const at = new Date(0);
  at.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return (at.getUTCDay() + 6) % 7;
}

/** How many days a range draws as columns; the month and the agenda are not columns. */
export function rangeLength(range: CalendarRange): number {
  switch (range) {
    case 'week':
      return 7;
    case '3day':
      return 3;
    case 'day':
      return 1;
    case 'month':
      return 42;
    case 'agenda':
      return AGENDA_DAYS;
  }
}

/** The first day a range shows when it is opened on `anchor`. */
export function rangeStart(range: CalendarRange, anchor: string): string {
  // A week whose Monday is before 0000-01-01 starts on the day it was opened.
  if (range === 'week') return addDays(anchor, -weekdayIndex(anchor)) ?? anchor;
  if (range === 'month') return monthGrid(anchor)?.weeks[0]?.[0]?.date ?? anchor;
  return anchor;
}

/** Every day the range shows, in order. An agenda's can be lengthened with "Load more". */
export function rangeDays({
  range,
  anchor,
  days = rangeLength(range),
}: {
  range: CalendarRange;
  anchor: string;
  days?: number;
}): string[] {
  const start = rangeStart(range, anchor);
  if (dateParts(start) === null) return [];
  // Days past 9999-12-31 are not shown: there is no date to show them as.
  return Array.from({ length: days }, (_, index) => addDays(start, index)).filter(
    (day): day is string => day !== null,
  );
}

/**
 * The anchor after ‹ or ›: a month, a week, three days, a day, or an agenda's
 * thirty days. A month keeps the day where it can and takes the month's last
 * when it cannot (31 January on is 28 February, not 3 March).
 */
export function stepAnchor({
  range,
  anchor,
  by,
}: {
  range: CalendarRange;
  anchor: string;
  by: number;
}): string {
  // Paging past the last (or first) day a date can hold stays where it is.
  if (range !== 'month') return addDays(anchor, by * rangeLength(range)) ?? anchor;
  const parts = dateParts(anchor);
  if (parts === null) return anchor;
  const firstOfMonth = new Date(0);
  firstOfMonth.setUTCFullYear(parts.year, parts.month - 1 + by, 1);
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(firstOfMonth.getUTCFullYear(), firstOfMonth.getUTCMonth() + 1, 0);
  const day = Math.min(parts.day, lastDay.getUTCDate());
  const year = String(firstOfMonth.getUTCFullYear()).padStart(4, '0');
  const month = String(firstOfMonth.getUTCMonth() + 1).padStart(2, '0');
  const stepped = `${year}-${month}-${String(day).padStart(2, '0')}`;
  // Past the years a date can hold, it stays where it is, as a week or a day does.
  return dateParts(stepped) === null ? anchor : stepped;
}

/** "Sep 24". */
function shortDay({ month, day }: DateParts): string {
  return `${MONTHS[month - 1] ?? ''} ${day}`;
}

/**
 * A span of days as a heading: "Sep 21 – 27, 2026", "Sep 28 – Oct 4, 2026",
 * "Dec 28, 2026 – Jan 3, 2027". Three days leave the year off unless they
 * cross one, since the toolbar is short of room and the year is rarely in doubt.
 */
function spanTitle(first: DateParts, last: DateParts, withYear: boolean): string {
  if (first.year !== last.year) {
    return `${shortDay(first)}, ${first.year} – ${shortDay(last)}, ${last.year}`;
  }
  const end = first.month === last.month ? String(last.day) : shortDay(last);
  const year = withYear ? `, ${last.year}` : '';
  return `${shortDay(first)} – ${end}${year}`;
}

/**
 * What the toolbar calls the range on show: "September 2026",
 * "Sep 21 – 27, 2026", "Sep 24 – 26", "Thu, Sep 24, 2026", "From Sep 24".
 */
export function rangeTitle(range: CalendarRange, anchor: string): string {
  const parts = dateParts(anchor);
  if (parts === null) return anchor;
  switch (range) {
    case 'month':
      return monthGrid(anchor)?.label ?? anchor;
    case 'day':
      return formatPropertyDate(anchor) ?? anchor;
    case 'agenda':
      return `From ${shortDay(parts)}`;
    case 'week':
    case '3day': {
      const days = rangeDays({ range, anchor });
      const first = dateParts(days[0] ?? anchor) ?? parts;
      const last = dateParts(days.at(-1) ?? anchor) ?? parts;
      return spanTitle(first, last, range === 'week');
    }
  }
}

/** What ‹ and › step by, in words for their labels: "Previous week". */
export function rangeUnit(range: CalendarRange): string {
  switch (range) {
    case 'month':
      return 'month';
    case 'week':
      return 'week';
    case '3day':
      return '3 days';
    case 'day':
      return 'day';
    case 'agenda':
      return `${AGENDA_DAYS} days`;
  }
}

/** A day's column heading: its weekday and its day of the month. */
export function dayHeading(date: string): { weekday: string; day: number; month: string } {
  const parts = dateParts(date);
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][weekdayIndex(date)] ?? '';
  return { weekday, day: parts?.day ?? 0, month: MONTHS[(parts?.month ?? 1) - 1] ?? '' };
}
