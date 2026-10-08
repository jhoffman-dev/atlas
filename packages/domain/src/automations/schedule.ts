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

/** When a rule runs: on a clock, when Atlas opens, by hand, or when a note of a type appears or changes. */
export type Schedule =
  | { readonly kind: 'daily'; readonly at: string }
  | { readonly kind: 'hourly'; readonly every: number }
  | { readonly kind: 'open' }
  | { readonly kind: 'manual' }
  | NoteTrigger;

/** The longest gap `every N hours` may leave: a week. */
export const MAX_EVERY_HOURS = 168;

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOUR_MS = 3_600_000;

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
 * Reads `daily at 03:00`, `every 6 hours`, `on app open`, `manually` or
 * `a meeting is created or changed`; null when it is none.
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
    const at = daily[1]!.padStart(5, '0');
    return CLOCK_TIME.test(at) ? { kind: 'daily', at } : null;
  }
  const hourly = /^every (\d{1,3}) hours?$/.exec(text);
  if (hourly !== null) {
    const every = Number(hourly[1]);
    return every >= 1 && every <= MAX_EVERY_HOURS ? { kind: 'hourly', every } : null;
  }
  return null;
}

/** A schedule as the rule's file writes it, which {@link parseSchedule} reads back. */
export function printSchedule(schedule: Schedule): string {
  switch (schedule.kind) {
    case 'daily':
      return `daily at ${schedule.at}`;
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
    case 'hourly':
      return schedule.every === 1 ? 'Every hour' : `Every ${schedule.every} hours`;
    case 'open':
      return 'When Atlas opens';
    case 'manual':
      return 'Only when run by hand';
    case 'note':
      return `When ${printNoteTrigger(schedule)}`;
  }
}

/**
 * The first time the schedule falls due after `since`, or null for a rule
 * that only runs when Atlas opens, when a note sets it off, or when asked.
 *
 * `since` is the last run — or, for a rule never run, when it was turned on —
 * so a run missed while Atlas was closed is still due when it opens.
 */
export function nextRunAfter(schedule: Schedule, since: LocalTime): LocalTime | null {
  const from = localTimeMs(since);
  if (from === null) return null;
  if (schedule.kind === 'hourly') return localTimeOf(from + schedule.every * HOUR_MS);
  if (schedule.kind !== 'daily') return null;
  const slot = localTimeMs(`${since.slice(0, 10)}T${schedule.at}:00`)!;
  return localTimeOf(slot > from ? slot : slot + 24 * HOUR_MS);
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
