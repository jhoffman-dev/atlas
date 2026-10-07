/**
 * A calendar as a list: the days from one on, each with its notes in the
 * order they happen, and what was due before today and is still not done in
 * a group of its own at the top.
 */
import { addDays, daysBetween } from '../timeline/timeline.ts';
import { byTimeOfDay, effectiveEnd, occursOn, type CalendarEvent } from './calendar-event.ts';
import { dateParts } from './calendar-range.ts';

export interface AgendaDay {
  readonly date: string;
  readonly events: readonly CalendarEvent[];
}

export interface Agenda {
  /** Before today and not done, oldest first. Each is listed here and nowhere else. */
  readonly overdue: readonly CalendarEvent[];
  /** The days that have notes, and today whether or not it does, in order. */
  readonly days: readonly AgendaDay[];
}

/** The last day a note is on: an all-day note's end day, or the day a timed one ends. */
function finalDay(event: CalendarEvent): string {
  const end = effectiveEnd(event);
  // A timed note ending at midnight is over by the start of that day.
  // A timed note cannot end at midnight on 0000-01-01 after it starts, so the
  // day before always exists; the end date is the fallback all the same.
  if (end.minutes !== 0 || event.start.minutes === null) return end.date;
  return addDays(end.date, -1) ?? end.date;
}

/** Whether a note is past and still open: it ended before today and is not done. */
export function isOverdue({
  event,
  today,
  isDone,
}: {
  event: CalendarEvent;
  today: string;
  isDone: (values: Readonly<Record<string, unknown>>) => boolean;
}): boolean {
  return daysBetween(finalDay(event), today) > 0 && !isDone(event.values);
}

/**
 * The agenda for `days` days from `from`. A note on several days is listed on
 * each of them; an overdue one only in Overdue, so nothing is listed twice.
 */
export function buildAgenda({
  events,
  from,
  days,
  today,
  isDone,
}: {
  events: readonly CalendarEvent[];
  from: string;
  days: number;
  today: string;
  isDone: (values: Readonly<Record<string, unknown>>) => boolean;
}): Agenda {
  const overdue = events.filter((event) => isOverdue({ event, today, isDone }));
  const open = events.filter((event) => !overdue.includes(event));
  const listed: AgendaDay[] = [];
  if (dateParts(from) !== null) {
    for (let index = 0; index < days; index += 1) {
      const date = addDays(from, index);
      // There are no days past 9999-12-31 to list.
      if (date === null) break;
      const on = open.filter((event) => occursOn(event, date)).sort(byTimeOfDay);
      if (on.length > 0 || date === today) listed.push({ date, events: on });
    }
  }
  const oldestFirst = [...overdue].sort(
    (left, right) => daysBetween(right.start.date, left.start.date) || byTimeOfDay(left, right),
  );
  return { overdue: oldestFirst, days: listed };
}

/** "Today", "Tomorrow" or "Yesterday" for a day near today; null for the rest. */
export function relativeDay(date: string, today: string): string | null {
  switch (daysBetween(today, date)) {
    case 0:
      return 'Today';
    case 1:
      return 'Tomorrow';
    case -1:
      return 'Yesterday';
    default:
      return null;
  }
}
