/**
 * One note a period (#40, ADR-0028): a Claude step that writes a note on a
 * daily or weekly schedule — a morning brief, a Friday review draft — writes
 * one for each time its schedule falls due, however often it runs. A second
 * run in the same period, on time, caught up or by hand, makes nothing.
 *
 * A period is known by the time its schedule fell due (its `slot`), and, for
 * a rule that writes one note per item in a period — a brief per meeting of
 * the day (#39) — by that item too. Which periods have their note is read
 * from the rule's log, where each run says the period it wrote for; never
 * from the folder's file names, which a person renames.
 */

import type { VaultPath } from '../vault/vault-path.ts';
import type { AutomationAction } from './automation-rule.ts';
import type { LogEntry } from './run-log.ts';
import { slotAtOrBefore, type LocalTime, type Schedule } from './schedule.ts';

/** The period a note is written for: when the schedule fell due, and the item, when one note goes to each. */
export interface OutputPeriod {
  /** The time the schedule fell due that the period starts at. */
  readonly slot: LocalTime;
  /** What the note is about within the period, when a rule writes one per item: a meeting's path. */
  readonly item?: string;
}

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
 * The period a run at `at` writes for: the one its schedule's latest time at
 * or before `at` starts. A run by hand before Friday's 15:00 is in the period
 * of the Friday before. Null for a schedule that has no periods.
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

/** Whether two periods are one: the same time fallen due, and the same item or none. */
export function samePeriod(left: OutputPeriod, right: OutputPeriod): boolean {
  return left.slot === right.slot && left.item === right.item;
}

/**
 * The note a run made for `period`, from the rule's log; null when no run
 * has. A run that said the period and made nothing — it found the note made —
 * is not one that made it.
 */
export function periodNoteMade(
  entries: readonly LogEntry[],
  period: OutputPeriod,
): VaultPath | null {
  for (const entry of [...entries].reverse()) {
    if (entry.kind !== 'run' || entry.period === undefined) continue;
    if (!samePeriod(entry.period, period)) continue;
    const made = entry.done.find((action) => action.kind === 'created');
    if (made !== undefined && made.kind === 'created') return made.path;
  }
  return null;
}
