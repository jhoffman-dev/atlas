/**
 * Dates that move (ADR-0019): the named ones views have — `@today`,
 * `@weekAgo` … — a count of days, weeks, months or years from today —
 * `@-30d`, `@+2w`, `@+1m`, `@-1y` — and `@startOfWeek`, the Monday of this
 * week, as the calendar's weeks start.
 *
 * The domain has no clock, so a moving date is never a day here. A query the
 * app runs asks the index for it, over the index's own clock, as `@today`
 * always has; an automation pins it to the day it is handed. Both readings of
 * a count and of `@startOfWeek` are written here, side by side, so they cannot
 * drift apart; the named dates keep theirs in `view-query` and `movingDate`.
 */

import { dateParts, rangeStart } from '../calendar/calendar-range.ts';
import { RELATIVE_DATE_NAMES, relativeDateSql } from '../query/view-query.ts';
import { addDays } from '../timeline/timeline.ts';
import { bound, fixed, sql, type Fragment } from './sql-fragment.ts';

/** `-30d`: a sign, a count, and d, w, m or y. Four digits is ten thousand years of days. */
const COUNTED = /^([+-])(\d{1,4})([dwmy])$/;

const START_OF_WEEK = 'startOfWeek';

/** What a moving date can be called, for a problem to suggest. */
export const MOVING_DATE_HINT = `${RELATIVE_DATE_NAMES.join(', ')}, @${START_OF_WEEK}, or a count from today like @-30d, @+2w, @+1m or @-1y`;

/** A count from today, in the two units the index and the calendar both count in. */
interface Counted {
  readonly amount: number;
  readonly unit: 'days' | 'months';
}

function countedOf(name: string): Counted | null {
  const match = COUNTED.exec(name);
  if (match === null) return null;
  const [, sign, digits, letter] = match;
  const count = Number(digits) * (sign === '-' ? -1 : 1);
  if (letter === 'd') return { amount: count, unit: 'days' };
  if (letter === 'w') return { amount: count * 7, unit: 'days' };
  return { amount: letter === 'y' ? count * 12 : count, unit: 'months' };
}

/** Whether `@name` is a date that moves. */
export function isMovingDate(name: string): boolean {
  return (
    RELATIVE_DATE_NAMES.includes(`@${name}`) || name === START_OF_WEEK || countedOf(name) !== null
  );
}

/**
 * The date as SQL over the index's clock, or null when it is no moving date.
 * The count comes from the query, so it is bound like every other value.
 */
export function movingDateSql(name: string): Fragment | null {
  const named = relativeDateSql(`@${name}`);
  if (named !== null) return fixed(named);
  // `weekday 1` moves on to the next Monday, or stays on one: six days back first lands on this week's.
  if (name === START_OF_WEEK) return fixed("date('now', 'localtime', '-6 days', 'weekday 1')");
  const counted = countedOf(name);
  if (counted === null) return null;
  const modifier = `${counted.amount < 0 ? '-' : '+'}${Math.abs(counted.amount)} ${counted.unit}`;
  return sql`date('now', 'localtime', ${bound(modifier)})`;
}

/**
 * The day `@startOfWeek` or a count from today means on `today`, or null for
 * any other name — the named dates are the automation's own (`movingDate`).
 */
export function countedDay(name: string, today: string): string | null {
  if (name === START_OF_WEEK) return dateParts(today) === null ? null : rangeStart('week', today);
  const counted = countedOf(name);
  if (counted === null) return null;
  return counted.unit === 'days'
    ? addDays(today, counted.amount)
    : addMonths(today, counted.amount);
}

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Months on (or back), as the index counts them: the same day number, rolled
 * into the month after when the month it lands in is too short — a month on
 * from 2026-01-31 is 2026-03-03. Null past what a date can hold.
 */
export function addMonths(date: string, months: number): string | null {
  const parts = dateParts(date);
  if (parts === null) return null;
  const at = new Date(0);
  // setUTCFullYear, not Date.UTC: the latter reads a year below 100 as 19xx.
  at.setUTCFullYear(parts.year, parts.month - 1 + months, parts.day);
  if (Number.isNaN(at.getTime())) return null;
  const written = at.toISOString().slice(0, 10);
  return PLAIN_DATE.test(written) ? written : null;
}
