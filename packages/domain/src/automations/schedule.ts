/**
 * When an automation runs (P25-01), and whether it is due.
 *
 * Times here are the person's wall clock, written `2026-09-27T03:00:00` — the
 * time on the clock where they are, which is what "daily at 03:00" means. The
 * arithmetic reads those digits as if they were UTC, so it is pure and gives
 * the same answer on every machine; the clock that says what time it is now is
 * handed in, never read.
 */

import { parseNoteTrigger, printNoteTrigger, type NoteTrigger } from './note-trigger.ts';

/** A moment on the person's wall clock: `YYYY-MM-DDTHH:MM:SS`. */
export type LocalTime = string;

/** A day of the week, as a rule's file names it. */
export type Weekday =
  'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/** The days in `Date#getUTCDay` order: Sunday is 0. */
export const WEEKDAYS: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/** When a rule runs: on a clock, when DFAI opens, by hand, or when a note of a type appears or changes. */
export type Schedule =
  | { readonly kind: 'daily'; readonly at: string }
  | { readonly kind: 'weekly'; readonly day: Weekday; readonly at: string }
  | { readonly kind: 'hourly'; readonly every: number }
  | { readonly kind: 'open' }
  | { readonly kind: 'manual' }
  | NoteTrigger;

/** The longest gap `every N hours` may leave: a week. */
export const MAX_EVERY_HOURS = 168;

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** A wall-clock time as milliseconds, read as UTC; null when it is not one. */
export function localTimeMs(time: string): number | null {
  const match = LOCAL_TIME.exec(time);
  if (match === null) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const at = Date.UTC(year, month - 1, day, hour, minute, second);
  // 2026-02-30 rolls into March; a time that does not read back is not one.
  return localTimeOf(at) === time ? at : null;
}

/** Milliseconds, read as UTC, as a wall-clock time. */
export function localTimeOf(at: number): LocalTime {
  return new Date(at).toISOString().slice(0, 19);
}

/**
 * Reads `daily at 03:00`, `fridays at 15:00`, `every 6 hours`, `on app open`,
 * `manually` or `a meeting is created or changed`; null when it is none.
 */
export function parseSchedule(value: unknown): Schedule | null {
  if (typeof value !== 'string') return null;
  const note = parseNoteTrigger(value);
  if (note !== null) return note;
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (text === 'on app open') return { kind: 'open' };
  if (text === 'manually') return { kind: 'manual' };
  const daily = /^daily at (\d{1,2}:\d{2})$/.exec(text);
  if (daily !== null) {
    const at = clockTime(daily[1]!);
    return at === null ? null : { kind: 'daily', at };
  }
  const weekly = parseWeekly(text);
  if (weekly !== null) return weekly;
  const hourly = /^every (\d{1,3}) hours?$/.exec(text);
  if (hourly !== null) {
    const every = Number(hourly[1]);
    return every >= 1 && every <= MAX_EVERY_HOURS ? { kind: 'hourly', every } : null;
  }
  return null;
}

/** `7:30` as `07:30`; null when it is no time on a clock. */
function clockTime(written: string): string | null {
  const at = written.padStart(5, '0');
  return CLOCK_TIME.test(at) ? at : null;
}

/**
 * `fridays at 15:00`, as the file writes it — or `friday at 15:00`,
 * `every friday at 15:00`, `weekly on fri at 15:00`, as a person may.
 */
function parseWeekly(text: string): Schedule | null {
  const match = /^(?:every |weekly on )?([a-z]+?)s? at (\d{1,2}:\d{2})$/.exec(text);
  if (match === null) return null;
  const word = match[1]!;
  const day = WEEKDAYS.find((each) => each === word || each.slice(0, 3) === word);
  const at = clockTime(match[2]!);
  return day === undefined || at === null ? null : { kind: 'weekly', day, at };
}

/** "friday" as "Friday". */
const dayName = (day: Weekday): string => `${day[0]!.toUpperCase()}${day.slice(1)}`;

/** A schedule as the rule's file writes it, which {@link parseSchedule} reads back. */
export function printSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'daily':
      return `daily at ${schedule.at}`;
    case 'weekly':
      return `${schedule.day}s at ${schedule.at}`;
    case 'hourly':
      return `every ${schedule.every} ${schedule.every === 1 ? 'hour' : 'hours'}`;
    case 'open':
      return 'on app open';
    case 'manual':
      return 'manually';
    case 'note':
      return printNoteTrigger(schedule);
  }
}

/** A schedule in a sentence, for the screen: "Every day at 03:00". */
export function describeSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'daily':
      return `Every day at ${schedule.at}`;
    case 'weekly':
      return `Every ${dayName(schedule.day)} at ${schedule.at}`;
    case 'hourly':
      return schedule.every === 1 ? 'Every hour' : `Every ${schedule.every} hours`;
    case 'open':
      return 'When DFAI opens';
    case 'manual':
      return 'Only when run by hand';
    case 'note':
      return `When ${printNoteTrigger(schedule)}`;
  }
}

/**
 * The first time the schedule falls due after `since`, or null for a rule
 * that only runs when DFAI opens, when a note sets it off, or when asked.
 *
 * `since` is the last run — or, for a rule never run, when it was turned on —
 * so a run missed while DFAI was closed is still due when it opens.
 *
 * A daily or weekly time is a time on the wall clock, counted in whole days
 * of it, so a clock change between two runs moves neither: "Fridays at
 * 15:00" is 15:00 on the Friday after the clocks go back as before. On the
 * night the clocks go forward a time that never shows (02:30) is due the
 * first moment the clock reads past it.
 */
export function nextRunAfter(schedule: Schedule, since: LocalTime): LocalTime | null {
  const from = localTimeMs(since);
  if (from === null) return null;
  if (schedule.kind === 'hourly') return localTimeOf(from + schedule.every * HOUR_MS);
  if (schedule.kind !== 'daily' && schedule.kind !== 'weekly') return null;
  return localTimeOf(slotAtOrBeforeMs(schedule, from) + periodMs(schedule));
}

/**
 * The latest time a daily or weekly schedule fell due at or before `at`: the
 * start of the period `at` is in. Null for a schedule with no such time, or a
 * moment that is not one.
 */
export function slotAtOrBefore(schedule: Schedule, at: LocalTime): LocalTime | null {
  const moment = localTimeMs(at);
  if (moment === null || (schedule.kind !== 'daily' && schedule.kind !== 'weekly')) return null;
  return localTimeOf(slotAtOrBeforeMs(schedule, moment));
}

function slotAtOrBeforeMs(
  schedule: Extract<Schedule, { kind: 'daily' | 'weekly' }>,
  moment: number,
): number {
  const day = localTimeOf(moment).slice(0, 10);
  const onDay = localTimeMs(`${day}T${schedule.at}:00`)!;
  const back =
    schedule.kind === 'daily'
      ? 0
      : (new Date(onDay).getUTCDay() - WEEKDAYS.indexOf(schedule.day) + 7) % 7;
  const slot = onDay - back * DAY_MS;
  return slot <= moment ? slot : slot - periodMs(schedule);
}

/** How long one period of a daily or weekly schedule is. */
function periodMs(schedule: Extract<Schedule, { kind: 'daily' | 'weekly' }>): number {
  return schedule.kind === 'daily' ? DAY_MS : WEEK_MS;
}

/**
 * Whether a scheduled rule should run now: its next time after `since` has
 * come. However many were missed, one run catches up — after it, `since` is
 * that run, and the next falls due in the future.
 */
export function isDue({
  schedule,
  since,
  now,
}: {
  schedule: Schedule;
  since: LocalTime;
  now: LocalTime;
}): boolean {
  const next = nextRunAfter(schedule, since);
  return next !== null && next <= now;
}
