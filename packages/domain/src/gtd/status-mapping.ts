import {
  FINISHED_TASK_STATUS,
  isBlankValue,
  isGtdStatus,
  NEW_TASK_STATUS,
  TASK_KEYS,
  type GtdStatus,
} from './gtd-status.ts';

/**
 * Which GTD status each status a vault's tasks held before becomes
 * (ADR-0029). A map, not an object: a status is whatever a file says, and
 * `constructor` must read as a status, not as what every object has.
 */
export type StatusMapping = ReadonlyMap<string, GtdStatus>;

/** The board this repository ran on before GTD, and where each of its columns goes. */
const OLD_BOARD: ReadonlyMap<string, GtdStatus> = new Map([
  ['backlog', 'backlog'],
  ['next', 'next-action'],
  ['doing', 'in-progress'],
  ['review', 'in-progress'],
  ['done', FINISHED_TASK_STATUS],
]);

/** A status as typed by hand — `Next Action`, `in_progress` — in the spelling the statuses use. */
const folded = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

/**
 * What a status becomes unless the person says otherwise: a GTD status in
 * any spelling is that status, the old board's columns go where ADR-0029
 * says, and anything else — no status at all included — waits in the Inbox.
 */
export function defaultStatusFor(value: string): GtdStatus {
  const spelled = folded(value);
  if (isGtdStatus(spelled)) return spelled;
  return OLD_BOARD.get(spelled) ?? NEW_TASK_STATUS;
}

/**
 * The mapping the migration offers for the statuses found, with the
 * person's choices laid over the defaults. A GTD status already written
 * exactly is not offered: it stays what it is.
 */
export function statusMappingFor({
  found,
  chosen = new Map(),
}: {
  found: readonly string[];
  chosen?: StatusMapping;
}): StatusMapping {
  const offered = [...new Set(found)].filter((value) => !isGtdStatus(value));
  return new Map(
    offered.map((value) => [value, chosen.get(value) ?? defaultStatusFor(value)] as const),
  );
}

/**
 * The GTD status a task holding `value` moves to. One already exactly a GTD
 * status stays put whatever the mapping says, so running the migration twice
 * changes nothing the second time.
 */
export function mappedStatus(mapping: StatusMapping, value: string): GtdStatus {
  if (isGtdStatus(value)) return value;
  return mapping.get(value) ?? defaultStatusFor(value);
}

/** The status a task holds, as the mapping reads it: '' for none. */
export function statusValueOf(properties: Readonly<Record<string, unknown>>): string {
  const value = properties[TASK_KEYS.status];
  if (value === null || value === undefined) return '';
  return Array.isArray(value) ? value.map(String).join(', ') : String(value);
}

/** One task's line in the migration: what its status is, and what it becomes. */
export interface TaskStatusMove {
  readonly from: string;
  readonly to: GtdStatus;
  /** The day written as `completed`, when it becomes finished and says no day yet. */
  readonly completed: string | null;
}

/**
 * What the migration does to one task, or null when it would change nothing.
 * A task that becomes finished is given the day its file last changed as
 * `completed`, unless it already says a day.
 */
export function taskStatusMove({
  properties,
  mapping,
  lastChanged,
}: {
  properties: Readonly<Record<string, unknown>>;
  mapping: StatusMapping;
  /** `YYYY-MM-DD`: the day the task's file was last changed. */
  lastChanged: string;
}): TaskStatusMove | null {
  const from = statusValueOf(properties);
  const to = mappedStatus(mapping, from);
  if (from === to) return null;
  const finishing = to === FINISHED_TASK_STATUS && isBlankValue(properties[TASK_KEYS.completed]);
  return { from, to, completed: finishing ? lastChanged : null };
}

/** The frontmatter a move writes. */
export function taskStatusChanges(move: TaskStatusMove): Record<string, unknown> {
  return {
    [TASK_KEYS.status]: move.to,
    ...(move.completed === null ? {} : { [TASK_KEYS.completed]: move.completed }),
  };
}
