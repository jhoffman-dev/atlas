import { isGtdStatus, type GtdStatus } from '../gtd/gtd-status.ts';
import type { BoardRow } from '../query/group-rows.ts';
import type { RowGroup } from '../query-language/result-groups.ts';
import { ACTIVE_PROJECT_STATUS, MOVING_STATUSES } from '../review/weekly-review.ts';
import { addDays, daysBetween } from '../timeline/timeline.ts';

/*
 * What a linked page's sections (P30-06) make of the rows their queries
 * answer: how long a waiting-for has waited, which status comes first, when
 * a project is missing its next action, and how many rows are drawn.
 */

/** The column a waiting-for's age is drawn in, in place of the day its file last changed. */
export const WAITED_FIELD = { key: 'waited', label: 'Waiting', kind: 'text' } as const;

/** The built-in field a waiting-for's age is read from. */
const MODIFIED_KEY = 'modified';

/**
 * How many days a waiting-for has waited: since its file last changed, the
 * same measure the weekly review's "waiting for more than 7 days" uses
 * (ADR-0029) — DFAI keeps no "waiting since" key. Null when either day
 * cannot be read, or is one the calendar does not have; never less than
 * none, when a file is dated ahead of the clock.
 */
export function daysWaited(modifiedDay: unknown, today: string): number | null {
  if (typeof modifiedDay !== 'string') return null;
  const day = modifiedDay.slice(0, 10);
  if (!isDay(day) || !isDay(today)) return null;
  return Math.max(0, daysBetween(day, today));
}

/** Whether `value` is a day the calendar has, as `YYYY-MM-DD`. */
function isDay(value: string): boolean {
  return addDays(value, 0) === value;
}

/** A waiting-for's age as a row says it. */
export function waitedText(days: number): string {
  if (days === 0) return 'waiting since today';
  return days === 1 ? 'waiting 1 day' : `waiting ${days} days`;
}

/** Waiting-for rows, each saying how long it has waited, as of `today` (`YYYY-MM-DD`). */
export function withDaysWaited(rows: readonly BoardRow[], today: string): BoardRow[] {
  return rows.map((row) => {
    const days = daysWaited(row.values[MODIFIED_KEY], today);
    const waited = days === null ? '' : waitedText(days);
    return { ...row, values: { ...row.values, [WAITED_FIELD.key]: waited } };
  });
}

/**
 * The order a page lists its open tasks' statuses in: what to do next, what
 * is under way, what is still to be sorted out, then what is parked. The
 * Task type's own order runs Inbox first, as work arrives; a page is read
 * for what to do.
 */
const WORK_ORDER: readonly GtdStatus[] = [
  'next-action',
  'in-progress',
  'inbox',
  'backlog',
  'waiting',
  'someday',
  'longterm',
  'archive',
];

/** Status groups in {@link WORK_ORDER}; a status GTD does not know keeps its place after them. */
export function inWorkOrder(groups: readonly RowGroup[]): RowGroup[] {
  const place = (group: RowGroup): number => {
    const at = isGtdStatus(group.value) ? WORK_ORDER.indexOf(group.value) : -1;
    return at === -1 ? WORK_ORDER.length : at;
  };
  return groups
    .map((group, at) => ({ group, at }))
    .sort((a, b) => place(a.group) - place(b.group) || a.at - b.at)
    .map(({ group }) => group);
}

/**
 * What an active project's page says when it has open work and nothing
 * moving: no open task filed under it is Next Action or In Progress — the
 * weekly review's "project without a next action" (P30-07), said where the
 * project is read. Null for a project that is not active (paused, done, or
 * with no status), when something is moving, when it has no open work, when
 * its tasks are not GTD's, or when not every open task was read.
 */
export function nextActionHint({
  projectStatus,
  statuses,
  waiting,
  complete,
}: {
  /** The project's own `status`, as written; null when it has none. */
  projectStatus: string | null;
  /** The status of each open task that is not a waiting-for. */
  statuses: readonly unknown[];
  /** How many waiting-fors it has besides. */
  waiting: number;
  /** Whether every open task was read: a cut-off list cannot say none is moving. */
  complete: boolean;
}): string | null {
  const open = statuses.length + waiting;
  if (projectStatus?.trim() !== ACTIVE_PROJECT_STATUS) return null;
  if (!complete || open === 0) return null;
  if (!statuses.every(isGtdStatus)) return null;
  if (statuses.some((status) => MOVING_STATUSES.includes(status))) return null;
  return open === 1
    ? 'No next action: its one open task is not Next Action or In Progress.'
    : `No next action: none of its ${open} open tasks is Next Action or In Progress.`;
}

/**
 * A section's rows as the index answered them, cut to what a section holds:
 * the page itself left out — a relation can name its own note, and no page
 * lists itself — then the first `limit`, saying whether more were found. The
 * query asks for more rows than `limit` for exactly this (the index says
 * "truncated" only past its own cap, which a section's LIMIT never reaches).
 */
export function sectionRows({
  rows,
  page,
  limit,
}: {
  rows: readonly BoardRow[];
  /** The page's own path. */
  page: string;
  limit: number;
}): { rows: BoardRow[]; truncated: boolean } {
  const others = rows.filter((row) => row.path !== page);
  return { rows: others.slice(0, limit), truncated: others.length > limit };
}

/** What of a section is drawn: the first rows, in their groups, and how many are held back. */
export interface DrawnRows {
  readonly rows: readonly BoardRow[];
  readonly groups: readonly RowGroup[];
  /** How many rows **Show more** would add. */
  readonly more: number;
}

/**
 * The first `shown` rows of a section, read in the order they are drawn —
 * group by group — so a long section opens short and its first group, the
 * next actions, is what is seen. A group left with no row is left out.
 */
export function firstRows({
  rows,
  groups,
  shown,
}: {
  rows: readonly BoardRow[];
  groups: readonly RowGroup[];
  shown: number;
}): DrawnRows {
  // A count that is no count draws nothing rather than a slice nobody asked for.
  const limit = Number.isFinite(shown) ? Math.max(0, Math.floor(shown)) : 0;
  if (rows.length <= limit) return { rows, groups, more: 0 };
  if (groups.length === 0) return { rows: rows.slice(0, limit), groups, more: rows.length - limit };
  let left = limit;
  const kept: RowGroup[] = [];
  for (const group of groups) {
    if (left === 0) break;
    const taken = group.rows.slice(0, left);
    left -= taken.length;
    // A sub-group would need cutting too; linked sections group one level deep.
    kept.push({ ...group, rows: taken, subgroups: [] });
  }
  const drawn = kept.flatMap((group) => group.rows);
  return { rows: drawn, groups: kept, more: rows.length - drawn.length };
}
