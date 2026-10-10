/**
 * A block made by dropping a task on the calendar's empty time (P31-02): when
 * it starts, and how long it runs.
 *
 * Times are wall-clock, as blocks are written (ADR-0030): a block is as long
 * as the clock says, so one made at 01:30 on the night the clocks go forward
 * still ends two hours later on the clock, and one made late in the evening
 * runs on past midnight into the next day. Nothing here reads the clock.
 */
import {
  clockLabel,
  DEFAULT_DURATION,
  MINUTES_PER_DAY,
  readEventTime,
} from '../calendar/calendar-event.ts';
import { later, SNAP_MINUTES } from '../calendar/event-move.ts';
import { fitFileNameStem } from '../vault/file-name-bytes.ts';
import type { TaskSchedule } from './scheduling.ts';

/**
 * The longest block a drop makes: a day. A task estimated at more is planned
 * by dropping it again, which makes another block for what is still left.
 */
export const LONGEST_NEW_BLOCK_MINUTES = MINUTES_PER_DAY;

/**
 * What a task still needs set aside, in minutes: its estimate less what its
 * blocks already give it, what blocks made since the schedule was read give it
 * (`placedSince`), and what is done of it — never below none. Null when it
 * has no estimate, or its schedule could not be read.
 */
export function minutesLeftToSchedule(
  schedule: TaskSchedule | null,
  placedSince = 0,
): number | null {
  if (schedule === null || schedule.estimate === null) return null;
  const given = schedule.scheduled + placedSince + (schedule.done ?? 0);
  return Math.max(0, schedule.estimate - given);
}

/**
 * How long a block made for a task runs: what the task still needs, up to a
 * day — or half an hour, the calendar's default, when it says nothing of how
 * long it takes or already has all it needs. A task dropped again after it is
 * fully scheduled is still given time: the person asked for it. `placedSince`
 * is what blocks made since `schedule` was read already give the task, so a
 * second drop made before it is read again gets what the first left.
 */
export function newBlockLength(schedule: TaskSchedule | null, placedSince = 0): number {
  const left = minutesLeftToSchedule(schedule, placedSince);
  if (left === null || left === 0) return DEFAULT_DURATION;
  return Math.min(left, LONGEST_NEW_BLOCK_MINUTES);
}

/**
 * The quarter hour a drop `minutes` after midnight lands in — the one it is
 * inside, not the nearest, so a block starts where the pointer let go — kept
 * on the day, a quarter hour before midnight at the latest.
 */
export function dropSlot(minutes: number): number {
  const slot = Math.floor(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.max(0, Math.min(MINUTES_PER_DAY - SNAP_MINUTES, slot));
}

/**
 * What follows the task's name in a block's file name, at the longest: " block",
 * a number when the name is taken, and the extension.
 */
const BLOCK_NAME_ENDING = ' block 9999.md';

/**
 * What a block made for a task is called: for the task, so the calendar says
 * what the time is for, and "block" after it, so the block's note is not the
 * task's name numbered — the task usually has that name, in the same folder.
 * A task whose name fills nearly all of a file name's bytes is cut, by whole
 * characters, so the block's still fits on the disk, numbered or not.
 */
export function newBlockName(taskTitle: string): string {
  const title = fitFileNameStem(taskTitle.trim(), BLOCK_NAME_ENDING);
  return title === '' ? 'Block' : `${title} block`;
}

/** A block's `start` and `end`, as written: `2026-10-12T09:00`. */
export interface BlockTimes {
  readonly start: string;
  readonly end: string;
}

/**
 * The start and end of a block `minutes` long from `start`, written as local
 * wall-clock times with no offset (ADR-0030). Null when `start` is not a day
 * and a time, the length is not a whole number of minutes from one to
 * {@link LONGEST_NEW_BLOCK_MINUTES}, or the end is past the last day a date
 * can hold.
 */
export function newBlockTimes({
  start,
  minutes,
}: {
  start: string;
  minutes: number;
}): BlockTimes | null {
  const from = readEventTime(start);
  if (from === null || from.minutes === null) return null;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > LONGEST_NEW_BLOCK_MINUTES) return null;
  const to = later(from, minutes);
  if (to === null || to.minutes === null) return null;
  return { start: wallClock(from.date, from.minutes), end: wallClock(to.date, to.minutes) };
}

const wallClock = (date: string, minutes: number) => `${date}T${clockLabel(minutes)}`;
