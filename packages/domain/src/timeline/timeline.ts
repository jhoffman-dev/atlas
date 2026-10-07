/**
 * Dated notes as bars on a timeline.
 *
 * Every rule here is pure and takes the dates to work from, so a Gantt can be
 * tested without waiting for a Tuesday. Positions come out as day counts rather
 * than pixels or percentages: where a bar sits is a fact about the plan, and how
 * wide that is on screen is the view's business.
 */

import type { BoardRow } from '../query/group-rows.ts';

export interface TimelineEntry {
  readonly path: string;
  readonly title: string;
  /** Inclusive, as `2026-09-20`. */
  readonly start: string;
  /** Inclusive too, so a one-day task starts and ends on the same day. */
  readonly end: string;
  /** Days from the start of the timeline. */
  readonly offset: number;
  /** How many days the bar covers. Never less than one. */
  readonly span: number;
  /** A moment rather than a stretch: one date, or a start and end that match. */
  readonly milestone: boolean;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface Timeline {
  readonly entries: readonly TimelineEntry[];
  /** The first and last day any entry touches, and how many days that spans. */
  readonly start: string;
  readonly end: string;
  readonly days: number;
  /** Notes with no usable date, counted rather than dropped in silence. */
  readonly undated: number;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The widest instant a `Date` holds; past it `toISOString` throws. */
const MAX_TIME = 8.64e15;

const isoDate = (at: number): string => new Date(at).toISOString().slice(0, 10);

/** A date as UTC midnight, or null when it is not a plain `2026-09-20`. */
function parseDate(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const at = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(at)) return null;

  // An impossible month is refused by Date.parse, but an impossible day is
  // rolled over — 2026-02-30 comes back as the 2nd of March. Writing the date
  // back out is the only way to tell a real day from a guess, and a day the
  // calendar does not have is undated rather than moved somewhere it was not.
  return isoDate(at) === value ? at : null;
}

/** Whole days from one date to another, both as UTC midnight. */
export function daysBetween(from: string, to: string): number {
  const start = parseDate(from);
  const end = parseDate(to);
  if (start === null || end === null) return 0;
  return Math.round((end - start) / DAY_MS);
}

/**
 * The date that many days after another, or null when there is none to give.
 *
 * A drag can ask for a day beyond the ones a `2026-09-20` can hold, where
 * `toISOString` writes an expanded year or throws, and a date that cannot be
 * read cannot be moved at all. Both are null rather than the date handed in:
 * a caller that moves two dates together has to decide what a stuck one
 * means, instead of finding one end moved and the other not.
 */
export function addDays(date: string, days: number): string | null {
  const at = parseDate(date);
  if (at === null) return null;

  const moved = at + days * DAY_MS;
  if (!Number.isFinite(moved) || Math.abs(moved) > MAX_TIME) return null;

  const written = isoDate(moved);
  return ISO_DATE.test(written) ? written : null;
}

/**
 * Lays rows out as bars.
 *
 * A row with only one of the two dates is a milestone rather than a mistake:
 * "ship on the 14th" is a real thing to put on a plan, and dropping it would
 * lose it silently.
 */
export function buildTimeline({
  rows,
  startKey,
  endKey,
}: {
  rows: readonly BoardRow[];
  readonly startKey: string;
  readonly endKey: string;
}): Timeline {
  const dated = rows.flatMap((row) => {
    const from = parseDate(row.values[startKey]);
    const to = parseDate(row.values[endKey]);
    if (from === null && to === null) return [];

    // Whichever end is missing collapses onto the one that is there. A plan
    // written backwards — ending before it starts — is read as a single day
    // rather than as a bar running the wrong way.
    const start = Math.min(from ?? to ?? 0, to ?? from ?? 0);
    const end = Math.max(from ?? to ?? 0, to ?? from ?? 0);
    return [{ row, start, end }];
  });

  if (dated.length === 0) {
    return { entries: [], start: '', end: '', days: 0, undated: rows.length };
  }

  const first = Math.min(...dated.map((item) => item.start));
  const last = Math.max(...dated.map((item) => item.end));

  const entries = dated
    .map(({ row, start, end }) => ({
      path: row.path,
      title: row.title,
      start: isoDate(start),
      end: isoDate(end),
      offset: Math.round((start - first) / DAY_MS),
      // Inclusive of both ends, so a task on one day is one day wide.
      span: Math.round((end - start) / DAY_MS) + 1,
      milestone: start === end,
      values: row.values,
    }))
    // Earliest first, then by name, so the chart does not reshuffle on a redraw.
    .sort(
      (left, right) =>
        left.start.localeCompare(right.start) || left.title.localeCompare(right.title),
    );

  return {
    entries,
    start: isoDate(first),
    end: isoDate(last),
    days: Math.round((last - first) / DAY_MS) + 1,
    undated: rows.length - dated.length,
  };
}
