/**
 * A block's `tasks` with a task added to it — a task dropped on the block
 * (P31-02) — or taken away again when that drop is undone.
 *
 * A link counts as the task's when it opens the task, the way every link in
 * the vault is resolved, so `[[Quarterly report]]` and
 * `[[Projects/Quarterly report]]` are the same task — and wherever it stands
 * in an item, as the index reads a relation (`relationsOf`), so a block whose
 * tasks are written `[[Call Mara]], [[Quarterly report]]` holds both. The links
 * already there are kept as they are written.
 */
import { linkTargets } from '../index/relation-rows.ts';
import { resolveWikiLinkTarget, wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** The block's links as a list: one written alone is a list of one, none is an empty list. */
const itemsOf = (tasks: unknown): unknown[] => {
  if (Array.isArray(tasks)) return [...(tasks as unknown[])];
  return tasks === null || tasks === undefined || tasks === '' ? [] : [tasks];
};

/** The notes one item of a block's `tasks` links, as the index reads them. */
function linkedBy(item: unknown, notePaths: readonly VaultPath[]): (VaultPath | null)[] {
  if (typeof item !== 'string') return [];
  return linkTargets(item).map((target) => resolveWikiLinkTarget(target, notePaths));
}

/** Whether an item of a block's `tasks` links `task` anywhere in it. */
const linksTask = (item: unknown, task: VaultPath, notePaths: readonly VaultPath[]) =>
  linkedBy(item, notePaths).includes(task);

/** Whether an item is a link to `task` and nothing else: one a drop could have written. */
const linksOnlyTask = (item: unknown, task: VaultPath, notePaths: readonly VaultPath[]) => {
  const linked = linkedBy(item, notePaths);
  return linked.length > 0 && linked.every((path) => path === task);
};

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
  if (items.some((item) => linksTask(item, task, notePaths))) return null;
  return [...items, taskLink(task, notePaths)];
}

/**
 * The block's `tasks` with the last link to `task` taken out — what undoing
 * the drop that added it writes — or null when the block no longer links it
 * that way. Only an item linking the task alone is taken, as a drop wrote it:
 * one that also links other tasks is someone's own writing, and stays. Every
 * other link stays as it is written, in its place.
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
  const at = items.findLastIndex((item) => linksOnlyTask(item, task, notePaths));
  if (at === -1) return null;
  return items.filter((_, index) => index !== at);
}
