import type { AutomationRule } from './automation-rule.ts';
import { lastScheduleMark, type LogEntry, type RunTrigger } from './run-log.ts';
import { isDue, localTimeMs, nextRunAfter, type LocalTime } from './schedule.ts';

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
  // A note trigger is set off by the change feed, never by the clock.
  if (rule.when.kind === 'manual' || rule.when.kind === 'note') return null;
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

/**
 * The most runs a note trigger may make in an hour (P29-01). Each save of a
 * note it watches is a new version; a rule that keeps setting itself, or
 * another rule, off is held here rather than running for ever.
 */
export const NOTE_RUNS_PER_HOUR = 20;

const HOUR_MS = 3_600_000;

/**
 * Whether the rule has made as many note-triggered runs in the hour up to
 * `now` as it may — a run whose query did not read counts, so a broken rule
 * is held back too. A run that did nothing writes no entry, so is not counted.
 */
export function noteRunsCapped(entries: readonly LogEntry[], now: LocalTime): boolean {
  const end = localTimeMs(now);
  if (end === null) return false;
  const runs = entries.filter((entry) => {
    if ((entry.kind !== 'run' && entry.kind !== 'failed') || entry.trigger !== 'note') return false;
    const at = localTimeMs(entry.at);
    return at !== null && at > end - HOUR_MS && at <= end;
  });
  return runs.length >= NOTE_RUNS_PER_HOUR;
}

/** What a rule held back by {@link noteRunsCapped} says. */
export function noteRunsCappedProblem(): string {
  return (
    `It has run ${NOTE_RUNS_PER_HOUR} times in the last hour, the most a rule may. ` +
    'Notes that change meanwhile wait for a run by hand.'
  );
}
