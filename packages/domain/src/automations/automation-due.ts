import type { AutomationRule } from './automation-rule.ts';
import { lastScheduleMark, type LogEntry, type RunTrigger } from './run-log.ts';
import { isDue, nextRunAfter, type LocalTime } from './schedule.ts';

interface RuleClock {
  readonly rule: AutomationRule;
  /** The rule's log, oldest first. */
  readonly log: readonly LogEntry[];
  readonly now: LocalTime;
  /**
   * When Atlas started watching this vault: what a rule with nothing in its
   * log — written by hand, never run — counts its first run from.
   */
  readonly watchingSince: LocalTime;
}

/**
 * Whether a rule should run now, and what to call the run; null when not.
 *
 * `opening` is the one check made when a vault is opened: a rule that runs on
 * opening runs then and only then, and a scheduled rule that missed its time
 * while Atlas was closed catches up — once, because the run it makes becomes
 * the mark its next time is counted from.
 */
export function dueTrigger({
  opening,
  ...clock
}: RuleClock & { opening: boolean }): RunTrigger | null {
  const { rule } = clock;
  if (!rule.enabled) return null;
  if (rule.when.kind === 'open') return opening ? 'open' : null;
  if (rule.when.kind === 'manual') return null;
  return isDue({ schedule: rule.when, since: sinceOf(clock), now: clock.now }) ? 'schedule' : null;
}

/** When a rule will next run by itself, for the list; null when it only runs on opening or by hand, or is off. */
export function nextRunOf(clock: RuleClock): LocalTime | null {
  if (!clock.rule.enabled) return null;
  return nextRunAfter(clock.rule.when, sinceOf(clock));
}

function sinceOf({ log, watchingSince, now }: Omit<RuleClock, 'rule'>): LocalTime {
  return lastScheduleMark(log, now) ?? watchingSince;
}

/** The longest a failing rule waits before it is tried again: six hours. */
const MAX_BACKOFF_MINUTES = 360;

/**
 * How long a rule that has failed `failures` times in a row — in a way its
 * log could not record — waits before it is tried again: a minute, then
 * doubling, so a fault that lasts is not retried every minute.
 */
export function backoffMinutes(failures: number): number {
  return Math.min(2 ** Math.max(0, failures - 1), MAX_BACKOFF_MINUTES);
}
