/**
 * A block's `tasks` with a task added to it — a task dropped on the block
 * (P31-02) — or taken away again when that drop is undone.
 *
 * A link counts as the task's when it opens the task, the way every link in
 * the vault is resolved, so `[[Quarterly report]]` and
 * `[[Projects/Quarterly report]]` are the same task. The links already there
 * are kept as they are written.
 */
import { resolveWikiLinkTarget, wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { splitWikiLinks } from '../markdown/wikilink.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** The block's links as a list: one written alone is a list of one, none is an empty list. */
const itemsOf = (tasks: unknown): unknown[] => {
  if (Array.isArray(tasks)) return [...(tasks as unknown[])];
  return tasks === null || tasks === undefined || tasks === '' ? [] : [tasks];
};

/** Whether one item of a block's `tasks` is a link that opens `task`. */
function opensTask(item: unknown, task: VaultPath, notePaths: readonly VaultPath[]): boolean {
  if (typeof item !== 'string') return false;
  const [piece] = splitWikiLinks(item.trim());
  return piece?.kind === 'wikiLink' && resolveWikiLinkTarget(piece.target, notePaths) === task;
}

/** The `[[…]]` a block's `tasks` links `task` with: its name, or its path where the name is taken. */
export function taskLink(task: VaultPath, notePaths: readonly VaultPath[]): string {
  return `[[${wikiLinkTargetFor(task, notePaths)}]]`;
}

/**
 * The block's `tasks` with `task` linked at the end, or null when the block
 * already links it: a task is in a block once, and dropping it there again
 * changes nothing.
 */
export function blockTasksWith({
  tasks,
  task,
  notePaths,
}: {
  tasks: unknown;
  task: VaultPath;
  notePaths: readonly VaultPath[];
}): unknown[] | null {
  const items = itemsOf(tasks);
  if (items.some((item) => opensTask(item, task, notePaths))) return null;
  return [...items, taskLink(task, notePaths)];
}

/**
 * The block's `tasks` with the last link to `task` taken out — what undoing
 * the drop that added it writes — or null when the block no longer links it.
 * Every other link stays as it is written, in its place.
 */
export function blockTasksWithout({
  tasks,
  task,
  notePaths,
}: {
  tasks: unknown;
  task: VaultPath;
  notePaths: readonly VaultPath[];
}): unknown[] | null {
  const items = itemsOf(tasks);
  const at = items.findLastIndex((item) => opensTask(item, task, notePaths));
  if (at === -1) return null;
  return items.filter((_, index) => index !== at);
}
