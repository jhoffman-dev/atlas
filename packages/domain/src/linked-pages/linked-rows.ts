import { isGtdStatus, type GtdStatus } from '../gtd/gtd-status.ts';
import type { BoardRow } from '../query/group-rows.ts';
import type { RowGroup } from '../query-language/result-groups.ts';
import { MOVING_STATUSES } from '../review/weekly-review.ts';
import { daysBetween } from '../timeline/timeline.ts';

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
 * (ADR-0029) — Atlas keeps no "waiting since" key. Null when the day cannot
 * be read; never less than none, when a file is dated ahead of the clock.
 */
export function daysWaited(modifiedDay: unknown, today: string): number | null {
  if (typeof modifiedDay !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(modifiedDay)) return null;
  return Math.max(0, daysBetween(modifiedDay.slice(0, 10), today));
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
 * What a project's or an area's page says when it has open work and nothing
 * moving: no open task filed under it is Next Action or In Progress — the
 * weekly review's "project without a next action" (P30-07), said where the
 * project is read. Null when something is moving, when it has no open work,
 * when its tasks are not GTD's, or when not every open task was read.
 */
export function nextActionHint({
  statuses,
  waiting,
  complete,
}: {
  /** The status of each open task that is not a waiting-for. */
  statuses: readonly unknown[];
  /** How many waiting-fors it has besides. */
  waiting: number;
  /** Whether every open task was read: a cut-off list cannot say none is moving. */
  complete: boolean;
}): string | null {
  const open = statuses.length + waiting;
  if (!complete || open === 0) return null;
  if (!statuses.every(isGtdStatus)) return null;
  if (statuses.some((status) => MOVING_STATUSES.includes(status))) return null;
  return open === 1
    ? 'No next action: its one open task is not Next Action or In Progress.'
    : `No next action: none of its ${open} open tasks is Next Action or In Progress.`;
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
  if (rows.length <= shown) return { rows, groups, more: 0 };
  if (groups.length === 0) return { rows: rows.slice(0, shown), groups, more: rows.length - shown };
  let left = shown;
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
