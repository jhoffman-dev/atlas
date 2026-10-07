/**
 * What the Activity page shows of the log (U-28): newest first, narrowed by
 * level, by kind and by words; and which errors are news.
 */

import type { ActivityEvent, ActivityKind, ActivityLevel } from './activity-event.ts';

/** Every line; warnings and errors; or errors alone. */
export type ActivityLevelFilter = 'all' | 'warnings' | 'errors';

export interface ActivityQuery {
  readonly level: ActivityLevelFilter;
  /** The kinds to show; none chosen shows every kind. */
  readonly kinds: readonly ActivityKind[];
  /** Words every shown line holds, in any case and any order. */
  readonly text: string;
}

export const EVERY_ACTIVITY: ActivityQuery = { level: 'all', kinds: [], text: '' };

/** The query with a kind's filter turned on, or off if it was on. */
export function withKindToggled(query: ActivityQuery, kind: ActivityKind): ActivityQuery {
  const kinds = query.kinds.includes(kind)
    ? query.kinds.filter((chosen) => chosen !== kind)
    : [...query.kinds, kind];
  return { ...query, kinds };
}

const RANK: Readonly<Record<ActivityLevel, number>> = { info: 0, warning: 1, error: 2 };
const LEAST: Readonly<Record<ActivityLevelFilter, number>> = { all: 0, warnings: 1, errors: 2 };

/** The lines the query asks for, newest first; lines of the same moment keep their order reversed. */
export function filterActivity(
  events: readonly ActivityEvent[],
  query: ActivityQuery,
): ActivityEvent[] {
  return events
    .map((event, order) => ({ event, order }))
    .filter(({ event }) => activityMatches(event, query))
    .sort((a, b) => b.event.at - a.event.at || b.order - a.order)
    .map(({ event }) => event);
}

/** Whether a line is one the query asks for: its level, its kind, and every word. */
export function activityMatches(event: ActivityEvent, query: ActivityQuery): boolean {
  if (RANK[event.level] < LEAST[query.level]) return false;
  if (query.kinds.length > 0 && !query.kinds.includes(event.kind)) return false;
  const words = query.text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== '');
  const text = searchable(event);
  return words.every((word) => text.includes(word));
}

function searchable(event: ActivityEvent): string {
  return `${event.message} ${event.kind} ${event.subject?.path ?? ''}`.toLowerCase();
}

/**
 * The errors that arrived after the page was last opened; every error when it
 * never has been.
 */
export function unseenErrorCount(events: readonly ActivityEvent[], seenAt: number | null): number {
  return events.filter((event) => event.level === 'error' && (seenAt === null || event.at > seenAt))
    .length;
}

/** How soon the same line again is the same thing still happening, not news. */
export const ACTIVITY_REPEAT_MS = 60_000;

/**
 * Whether `next` says again what `earlier` said a moment ago — a save that
 * keeps failing, a notice shown twice — and so is left out.
 */
export function repeatsActivity(earlier: ActivityEvent, next: ActivityEvent): boolean {
  // Either way round: a clock set back puts the next line before the earlier one.
  return (
    Math.abs(next.at - earlier.at) < ACTIVITY_REPEAT_MS &&
    activityRepeatKey(earlier) === activityRepeatKey(next)
  );
}

/**
 * What a line says, whenever it said it: two lines with the same key repeat
 * each other if they are close in time. Lets a log find the line a new one may
 * repeat in one look-up, rather than by comparing it with every line before.
 */
export function activityRepeatKey(event: ActivityEvent): string {
  const { level, kind, message, subject } = event;
  return JSON.stringify([level, kind, message, subject?.kind ?? null, subject?.path ?? null]);
}

/**
 * When the page counts as having seen the lines it shows: now, or the newest
 * line's time when that is later — a line dated while the clock ran ahead is
 * seen too, rather than keeping the badge until the clock catches up.
 */
export function activitySeenAt(events: readonly ActivityEvent[], now: number): number {
  return events.reduce((latest, event) => Math.max(latest, event.at), now);
}

/**
 * The notices on screen now that were not a moment ago: each is logged when
 * it appears, not again for as long as it stays.
 */
export function newlyShownNotices(
  before: readonly (string | null)[],
  after: readonly (string | null)[],
): string[] {
  const shown = new Set(before);
  return [...new Set(after)].filter(
    (notice): notice is string => notice !== null && !shown.has(notice),
  );
}
