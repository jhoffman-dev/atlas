/**
 * What a drag on the calendar writes.
 *
 * A value keeps its shape: a day stays a day, and a day with a time keeps a
 * time — and whatever was written after it, seconds or a zone — so moving a
 * note never quietly turns "all day" into midnight or drops "14:30". The
 * arithmetic is on wall-clock minutes and calendar days, never instants, so a
 * daylight-saving change cannot shift a note by an hour.
 */
import { withDatePart } from '../page/property-date.ts';
import { addDays, daysBetween } from '../timeline/timeline.ts';
import {
  clockLabel,
  effectiveEnd,
  minutesBetween,
  MINUTES_PER_DAY,
  readEventTime,
  type CalendarEvent,
  type EventTime,
} from './calendar-event.ts';

/** A drag on the clock lands on the quarter hour. */
export const SNAP_MINUTES = 15;

const TIME_IN_VALUE = /^(\d{4}-\d{2}-\d{2})([T ])\d{2}:\d{2}(.*)$/;

/** Minutes rounded to the nearest quarter hour. */
export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/**
 * How far a note held on the clock moves when let go `delta` minutes away:
 * onto the nearest quarter hour, unless it was barely moved, in which case it
 * stays put — a drag across days only must not also round a 14:07 to 14:00.
 */
export function snappedMove(startMinutes: number, delta: number): number {
  if (Math.abs(delta) < SNAP_MINUTES / 2) return 0;
  return snapMinutes(startMinutes + delta) - startMinutes;
}

/** What a move or a resize writes: the start, and the end when there is one to change. */
export interface EventWrite {
  readonly start: string;
  /** Null leaves the end property alone. */
  readonly end: string | null;
}

/**
 * A moment after another by some minutes, crossing days as it must; null
 * past the last (or first) day a date can hold, rather than the clock
 * wrapping round on the same day.
 */
export function later(time: EventTime, by: number): EventTime | null {
  const total = (time.minutes ?? 0) + by;
  const days = Math.floor(total / MINUTES_PER_DAY);
  const date = addDays(time.date, days);
  if (date === null) return null;
  return { date, minutes: total - days * MINUTES_PER_DAY };
}

/**
 * `value` moved to a new day and time, in its own shape: the separator and
 * whatever followed the minutes are kept.
 */
function rewrite(value: string, to: EventTime): string {
  const match = TIME_IN_VALUE.exec(value.trim());
  if (match === null || to.minutes === null) return withDatePart(value, to.date);
  return `${to.date}${match[2] ?? 'T'}${clockLabel(to.minutes)}${match[3] ?? ''}`;
}

/**
 * A value moved by `days` whole days and, for one with a time, `minutes` more.
 * A day with no time moves by days only: a drag across the clock does not
 * give an all-day note a time. Null when that is past a date's range.
 */
function shifted(
  value: string,
  { days, minutes }: { days: number; minutes: number },
): string | null {
  const time = readEventTime(value);
  if (time === null) return value;
  if (time.minutes === null) {
    const date = addDays(time.date, days);
    return date === null ? null : withDatePart(value, date);
  }
  const to = later(time, days * MINUTES_PER_DAY + minutes);
  return to === null ? null : rewrite(value, to);
}

/**
 * A note dragged `days` along and `minutes` down the clock. Its end moves with
 * it, so it keeps its length: by the same minutes when the end has a time, or
 * by the days its start moved when the end is a day. A move that would take
 * either past the range a date can hold is refused: the note stays put.
 */
export function movedEvent({
  start,
  end,
  days,
  minutes,
}: {
  start: string;
  end: string | null;
  days: number;
  minutes: number;
}): EventWrite {
  const from = readEventTime(start);
  const nextStart = shifted(start, { days, minutes });
  if (nextStart === null) return { start, end: null };
  const to = readEventTime(nextStart);
  const endTime = end === null ? null : readEventTime(end);
  if (end === null || endTime === null || from === null || to === null) {
    return { start: nextStart, end: null };
  }
  const nextEnd =
    endTime.minutes !== null && from.minutes !== null
      ? shifted(end, { days, minutes })
      : shifted(end, { days: daysBetween(from.date, to.date), minutes: 0 });
  if (nextEnd === null) return { start, end: null };
  return { start: nextStart, end: nextEnd };
}

/**
 * A timed note's bottom edge dragged `minutes` down (up when negative). The
 * end is written with a time on the note's own clock, never before the start
 * plus a quarter hour; a note that had no end gets one, in the start's shape.
 * Null when there is nothing to write: an all-day note, or an end past the
 * last day a date can hold.
 */
export function resizedEnd({
  event,
  start,
  end,
  minutes,
}: {
  event: CalendarEvent;
  start: string;
  end: string | null;
  minutes: number;
}): string | null {
  if (event.start.minutes === null) return null;
  const current = effectiveEnd(event);
  const length = minutesBetween(event.start, current) + minutes;
  const target = later(event.start, Math.max(SNAP_MINUTES, snapMinutes(length)));
  if (target === null) return null;
  const written = end !== null && TIME_IN_VALUE.test(end.trim()) ? end : start;
  return rewrite(written, target);
}

/** The value a note made in an empty slot is given: the day, or the day and time. */
export function slotValue(date: string, minutes: number | null): string {
  return minutes === null ? date : `${date}T${clockLabel(minutes)}`;
}
