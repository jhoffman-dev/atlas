/**
 * A meeting's `tasks` as the declared step leaves it (#185, ADR-0036 "One
 * meeting write, tasks first"): the tasks a run made, and those made before
 * that the meeting does not list yet, joined in the same write as its
 * summary — and, on undo, the tasks trashed taken out again.
 */

import { linkTargets } from '../index/relation-rows.ts';
import { resolveWikiLinkTarget, wikiLinkTargetFor } from '../markdown/resolve-wikilink.ts';
import { holdsOnlyText, linkedNotes } from '../types/relation-links.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** The notes a relation's value links, each resolved as the vault resolves a link. */
function linkedPaths(value: unknown, notePaths: readonly VaultPath[]): Set<VaultPath> {
  return new Set(
    linkedNotes(value)
      .flatMap((item) => linkTargets(item))
      .flatMap((written) => resolveWikiLinkTarget(written, notePaths) ?? []),
  );
}

/**
 * The relation's value with each of `tasks` linked once — never one it links
 * already, however that link is spelt — or null when there is nothing to
 * add, or it holds something other than links (which adding one would write
 * over), or it holds one note only and has one: a join never replaces a link.
 */
export function tasksJoined({
  value,
  tasks,
  notePaths,
  many,
}: {
  value: unknown;
  tasks: readonly VaultPath[];
  /** Every note in the vault, the tasks included. */
  notePaths: readonly VaultPath[];
  many: boolean;
}): string | string[] | null {
  if (!holdsOnlyText(value)) return null;
  const linked = linkedPaths(value, notePaths);
  const adding = [...new Set(tasks)].filter((task) => !linked.has(task));
  if (adding.length === 0) return null;
  const links = adding.map((task) => `[[${wikiLinkTargetFor(task, notePaths)}]]`);
  if (!many) return linkedNotes(value).length === 0 && links.length === 1 ? links[0]! : null;
  return [...linkedNotes(value), ...links];
}

/**
 * The relation's value without its links to `tasks`, however each is spelt;
 * null once nothing is left, so the key is cleared; undefined when it links
 * none of them and is to be left as it is.
 */
export function tasksParted({
  value,
  tasks,
  notePaths,
}: {
  value: unknown;
  tasks: readonly VaultPath[];
  /** Every note the links were written against, the tasks included. */
  notePaths: readonly VaultPath[];
}): string[] | null | undefined {
  if (!holdsOnlyText(value)) return undefined;
  const parting = new Set(tasks);
  const items = linkedNotes(value);
  const rest = items.filter(
    (item) =>
      !linkTargets(item).some((written) => {
        const path = resolveWikiLinkTarget(written, notePaths);
        return path !== null && parting.has(path);
      }),
  );
  if (rest.length === items.length) return undefined;
  return rest.length === 0 ? null : rest;
}
