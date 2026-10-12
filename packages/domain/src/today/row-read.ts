import { gtdStatusOf, TASK_KEYS, type GtdStatus } from '../gtd/gtd-status.ts';
import { indexablePropertiesOf } from '../index/property-value.ts';

/** What a row's actions take for granted of its task: what the page read it as. */
export interface TaskAsRead {
  readonly status: GtdStatus | null;
  /** `YYYY-MM-DD`, or null. */
  readonly due: string | null;
  /** `YYYY-MM-DD`, or null. */
  readonly defer: string | null;
}

/**
 * A task's frontmatter read as the page's statement reads the index: its
 * status as one of the eight, and the first day its `due` and `defer` hold.
 */
export function taskAsRead(properties: Readonly<Record<string, unknown>>): TaskAsRead {
  return {
    status: gtdStatusOf(properties[TASK_KEYS.status]),
    due: firstDay(properties, TASK_KEYS.due),
    defer: firstDay(properties, TASK_KEYS.defer),
  };
}

function firstDay(properties: Readonly<Record<string, unknown>>, key: string): string | null {
  if (!Object.hasOwn(properties, key)) return null;
  const dated = indexablePropertiesOf({ [key]: properties[key] }).find((row) => row.date !== null);
  return dated?.date?.slice(0, 10) ?? null;
}

/**
 * Whether a task still is what a row showed (#111). A row acts on what it
 * showed — a tick on the 13th's occurrence, a move from Next Action — so
 * once the file says otherwise the action is no longer the one asked for:
 * ticking again would roll a repeating task on twice, and moving a task
 * finished elsewhere would reopen it.
 */
export function stillAsRead({
  row,
  properties,
}: {
  row: TaskAsRead;
  properties: Readonly<Record<string, unknown>>;
}): boolean {
  const now = taskAsRead(properties);
  return now.status === row.status && now.due === row.due && now.defer === row.defer;
}
