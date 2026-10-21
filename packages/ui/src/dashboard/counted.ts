import { countOf } from '@dfai/domain';

/**
 * A count with the noun the widget counts — "3 tasks" — or the bare count for
 * a widget with no type to name, such as a SQL widget.
 */
export function counted(count: number, noun: string): string {
  return noun === '' ? String(count) : countOf(count, noun);
}
