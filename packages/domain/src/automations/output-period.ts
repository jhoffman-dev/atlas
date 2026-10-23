/**
 * One note a period (#40, ADR-0028): a Claude step that writes a note on a
 * daily or weekly schedule — a morning brief, a Friday review draft — writes
 * one for each day or week, however often it runs. A second run in the same
 * period, on time, caught up or by hand, makes nothing.
 *
 * A period is a calendar day (a daily rule) or an ISO week, Monday first (a
 * weekly one), so moving a rule's time within it does not open a new one. It
 * is known by the time its schedule fell due (its `slot`), and, for a rule
 * that writes one note per item in a period — a brief per meeting of the day
 * (#39) — by that item too.
 *
 * Which periods have their note is read from two places that each can fail
 * alone: the rule's log, where each run says the period it wrote for, and the
 * notes themselves, each of which carries the period it was made for. A
 * crash between the note and its log line, a log that outgrew its cap, a note
 * synced in from the other Mac: any one of them still says the period is made.
 * File names are never read: a person renames them.
 */

import type { VaultPath } from '../vault/vault-path.ts';
import type { AutomationAction } from './automation-rule.ts';
import type { LogEntry } from './run-log.ts';
import {
  localTimeMs,
  localTimeOf,
  slotAtOrBefore,
  WEEKDAYS,
  type LocalTime,
  type Schedule,
} from './schedule.ts';

/** The period a note is written for: when the schedule fell due, and the item, when one note goes to each. */
export interface OutputPeriod {
  /** The time the schedule fell due that the period starts at. */
  readonly slot: LocalTime;
  /** What the note is about within the period, when a rule writes one per item: a meeting's path. */
  readonly item?: string;
}

/** A note in the rule's folder and the period its properties say it was made for. */
export interface PeriodNote {
  readonly path: VaultPath;
  readonly period: OutputPeriod;
}

/** The properties a note carries, so the note itself says which period it is for. */
export const PERIOD_KEY = 'atlas_period';
export const PERIOD_ITEM_KEY = 'atlas_period_item';

const DAY_MS = 86_400_000;

/** Whether a rule writes one note a period: a Claude step's note output, on a daily or weekly clock. */
export function writesOneNoteAPeriod({
  when,
  action,
}: {
  when: Schedule;
  action: AutomationAction;
}): boolean {
  const onAClock = when.kind === 'daily' || when.kind === 'weekly';
  return onAClock && action.kind === 'claude' && action.output.kind === 'note';
}

/**
 * The period a scheduled run at `at` writes for: the one its schedule's latest
 * time at or before `at` starts — so a run that catches up on Monday writes
 * for the Friday before. Null for a schedule that has no periods.
 */
export function outputPeriod({
  schedule,
  at,
  item,
}: {
  schedule: Schedule;
  at: LocalTime;
  item?: string;
}): OutputPeriod | null {
  const slot = slotAtOrBefore(schedule, at);
  if (slot === null) return null;
  return item === undefined ? { slot } : { slot, item };
}

/**
 * The period a run by hand at `at` writes for: the calendar week it is in
 * (or, for a daily rule, today), whether or not that week's time has come.
 * Run by hand on a Wednesday, a Friday rule writes for this Friday's period;
 * on the Monday after, for the next.
 */
export function currentPeriod({
  schedule,
  at,
  item,
}: {
  schedule: Schedule;
  at: LocalTime;
  item?: string;
}): OutputPeriod | null {
  const slot = slotInPeriodOf(schedule, at);
  if (slot === null) return null;
  return item === undefined ? { slot } : { slot, item };
}

function slotInPeriodOf(schedule: Schedule, at: LocalTime): LocalTime | null {
  if (localTimeMs(at) === null) return null;
  if (schedule.kind === 'daily') return `${at.slice(0, 10)}T${schedule.at}:00`;
  if (schedule.kind !== 'weekly') return null;
  const monday = localTimeMs(`${mondayOf(at.slice(0, 10))}T00:00:00`)!;
  const offset = (WEEKDAYS.indexOf(schedule.day) + 6) % 7;
  return `${localTimeOf(monday + offset * DAY_MS).slice(0, 10)}T${schedule.at}:00`;
}

/** The Monday of the ISO week a `YYYY-MM-DD` day is in. */
function mondayOf(day: string): string {
  const ms = localTimeMs(`${day}T00:00:00`);
  if (ms === null) return day;
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return localTimeOf(ms - sinceMonday * DAY_MS).slice(0, 10);
}

/**
 * What a period is called, to tell it from another: the day of a daily rule,
 * the Monday of a weekly rule's week. Days compare as text.
 */
export function periodKey(schedule: Schedule, time: LocalTime): string {
  const day = time.slice(0, 10);
  return schedule.kind === 'weekly' ? mondayOf(day) : day;
}

/** Whether two periods are one: the same day or week, and the same item or none. */
export function samePeriod(left: OutputPeriod, right: OutputPeriod, schedule: Schedule): boolean {
  return (
    left.item === right.item && periodKey(schedule, left.slot) === periodKey(schedule, right.slot)
  );
}

/** What asks whether a period has its note. */
interface PeriodQuery {
  /** The rule's log, oldest first. */
  readonly entries: readonly LogEntry[];
  /** The notes in its folder and the periods they say they are for; none when not read. */
  readonly notes?: readonly PeriodNote[];
  readonly period: OutputPeriod;
  readonly schedule: Schedule;
  /** The wall clock: a period after it is not one that has been made. */
  readonly now: LocalTime;
}

/**
 * Whether `candidate` says the query's period, and is not ahead of the clock:
 * a clock that ran a month fast must not have used up a week that has not come.
 */
function says(query: PeriodQuery, candidate: OutputPeriod): boolean {
  const { schedule, period, now } = query;
  return (
    samePeriod(candidate, period, schedule) &&
    periodKey(schedule, candidate.slot) <= periodKey(schedule, now)
  );
}

/**
 * The note that has been made for `period`, as the log or the notes say; null
 * when none has. A run that said the period and made nothing — it found the
 * note made — is not one that made it, and neither is one that was undone. A
 * note the disk no longer has, as `exists` says, is not made either: that is
 * what a run by hand writes afresh.
 */
export function periodNoteMade(
  query: PeriodQuery & { exists?: (path: VaultPath) => boolean },
): VaultPath | null {
  const undone = new Set(
    query.entries.flatMap((entry) => (entry.kind === 'undo' ? [entry.of] : [])),
  );
  const here = query.exists ?? (() => true);
  for (const entry of [...query.entries].reverse()) {
    if (entry.kind !== 'run' || entry.period === undefined || undone.has(entry.at)) continue;
    if (!says(query, entry.period)) continue;
    const made = entry.done.find((action) => action.kind === 'created');
    if (made !== undefined && made.kind === 'created' && here(made.path)) return made.path;
  }
  return (query.notes ?? []).find((note) => says(query, note.period))?.path ?? null;
}

/**
 * Whether anything records that the period was written for: a run that made a
 * note for it — even if that run was undone, or its note deleted since — or a
 * note that carries it. A scheduled run never writes such a period again; only
 * a person, by hand, asks for a fresh one.
 */
export function periodRecorded(query: PeriodQuery): boolean {
  const ranFor = query.entries.some(
    (entry) =>
      entry.kind === 'run' &&
      entry.period !== undefined &&
      says(query, entry.period) &&
      entry.done.some((action) => action.kind === 'created'),
  );
  return ranFor || (query.notes ?? []).some((note) => says(query, note.period));
}

/** The properties a note made for `period` carries. */
export function periodProperties({ slot, item }: OutputPeriod): Record<string, string> {
  return { [PERIOD_KEY]: slot, ...(item !== undefined && { [PERIOD_ITEM_KEY]: item }) };
}

/** The period a note's properties say it was made for; null when they say none that reads. */
export function notePeriod(properties: Readonly<Record<string, unknown>>): OutputPeriod | null {
  const slot = properties[PERIOD_KEY];
  if (typeof slot !== 'string' || localTimeMs(slot) === null) return null;
  const item = properties[PERIOD_ITEM_KEY];
  return typeof item === 'string' && item !== '' ? { slot, item } : { slot };
}
