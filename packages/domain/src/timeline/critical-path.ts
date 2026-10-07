/**
 * What blocks what, and which chain decides the end date.
 *
 * Dependencies are written the way a person writes them — `blocked_by: [P11-01]`
 * — so the graph is built from names rather than paths, and a name that matches
 * nothing is dropped rather than treated as a task that takes no time.
 */

import type { TimelineEntry } from './timeline.ts';
import { daysBetween } from './timeline.ts';

/** The property a task names its blockers in. */
export const BLOCKED_BY_KEY = 'blocked_by';

/** The property a task is known by to the tasks that depend on it. */
export const TASK_ID_KEY = 'id';

export interface DependencyGraph {
  /** Task id to the ids it waits for, with unknown names already dropped. */
  readonly blockedBy: ReadonlyMap<string, readonly string[]>;
  /** Names that were written as blockers but match no task. */
  readonly unknown: readonly string[];
  /** Ids more than one note claims. Their blockers are merged, not replaced. */
  readonly duplicated: readonly string[];
  /** True when the dependencies loop, which makes a critical path meaningless. */
  readonly circular: boolean;
}

const idOf = (entry: TimelineEntry): string => {
  const declared = entry.values[TASK_ID_KEY];
  return typeof declared === 'string' && declared.trim() !== '' ? declared.trim() : entry.path;
};

const blockersOf = (entry: TimelineEntry): string[] => {
  const declared = entry.values[BLOCKED_BY_KEY];
  const listed = Array.isArray(declared)
    ? declared
    : // A single blocker is often written without brackets, and a comma-separated
      // string is what a table cell produces.
      typeof declared === 'string'
      ? declared.split(',')
      : [];

  return listed.map((item) => String(item).trim()).filter((item) => item !== '');
};

export function dependencyGraph(entries: readonly TimelineEntry[]): DependencyGraph {
  const known = new Set(entries.map(idOf));
  const blockedBy = new Map<string, readonly string[]>();
  const unknown = new Set<string>();
  const duplicated = new Set<string>();

  for (const entry of entries) {
    const id = idOf(entry);
    const named = blockersOf(entry);
    for (const name of named) if (!known.has(name)) unknown.add(name);

    const already = blockedBy.get(id);
    if (already !== undefined) duplicated.add(id);

    // Two notes claiming one id are one node here, so what both of them wait
    // for is kept. Overwriting would drop the first note's blockers without
    // saying so, which quietly shortens the plan.
    const merged = new Set(already);
    for (const name of named) if (known.has(name) && name !== id) merged.add(name);
    blockedBy.set(id, [...merged]);
  }

  return {
    blockedBy,
    unknown: [...unknown].sort(),
    duplicated: [...duplicated].sort(),
    circular: hasCycle(blockedBy),
  };
}

/**
 * Whether the blockers loop.
 *
 * Depth-first with an explicit stack rather than recursion: a plan is read out
 * of a vault, so the chain can be longer than the call stack is deep. A null on
 * the stack marks a task whose blockers have all been walked.
 */
function hasCycle(blockedBy: ReadonlyMap<string, readonly string[]>): boolean {
  const visiting = new Set<string>();
  const done = new Set<string>();

  for (const root of blockedBy.keys()) {
    if (done.has(root)) continue;

    const stack: (string | null)[] = [root];
    const path: string[] = [];

    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined) continue;

      if (id === null) {
        const finished = path.pop();
        if (finished !== undefined) {
          visiting.delete(finished);
          done.add(finished);
        }
        continue;
      }

      if (done.has(id)) continue;
      if (visiting.has(id)) return true;

      visiting.add(id);
      path.push(id);
      stack.push(null, ...(blockedBy.get(id) ?? []));
    }
  }

  return false;
}

/**
 * The longest chain of blocking work, by days.
 *
 * This is the run of tasks that decides when the whole thing finishes: shorten
 * anything on it and the end date moves, shorten anything else and it does not.
 *
 * A circular dependency has no longest chain — every task is on an infinitely
 * long one — so it returns nothing rather than an arbitrary answer.
 */
export function criticalPath(
  entries: readonly TimelineEntry[],
  graph: DependencyGraph = dependencyGraph(entries),
): readonly string[] {
  if (graph.circular) return [];

  const byId = tasksById(entries);
  const longest = longestChains({ byId, blockedBy: graph.blockedBy });

  let winner: string | null = null;
  for (const id of byId.keys()) {
    const found = longest.get(id);
    if (found === undefined) continue;
    const best = winner === null ? undefined : longest.get(winner);
    if (best === undefined || beats({ candidate: found, best, byId })) winner = id;
  }

  return winner === null ? [] : chainTo(winner, longest);
}

/**
 * The task ids on the critical path, ready to ask `has` of while drawing.
 *
 * Takes the graph when the caller already has one — drawing a Gantt needs both,
 * and building it twice walks every dependency twice.
 */
export function criticalPathIds(
  entries: readonly TimelineEntry[],
  graph: DependencyGraph = dependencyGraph(entries),
): ReadonlySet<string> {
  return new Set(criticalPath(entries, graph));
}

/** One blocker of a task, with the longest chain that reaches it. */
interface Step {
  readonly id: string;
  readonly chain: Chain;
}

/** The longest chain ending at a task: how many days, and what it runs through. */
interface Chain {
  readonly days: number;
  /** The task this chain reaches here through, or null when it starts here. */
  readonly via: string | null;
  /** The task the chain starts at, which is what a tie is broken on. */
  readonly head: string;
}

/**
 * Which of two notes claiming one id speaks for it.
 *
 * The one that starts first, then the one that runs longest, then by path: a
 * rule rather than whichever happened to be read last, so a copy-pasted note
 * cannot change the plan depending on the order the vault came back in.
 */
function speaksFor(candidate: TimelineEntry, held: TimelineEntry): boolean {
  if (candidate.start !== held.start) return candidate.start < held.start;
  if (candidate.end !== held.end) return candidate.end > held.end;
  return candidate.path < held.path;
}

function tasksById(entries: readonly TimelineEntry[]): ReadonlyMap<string, TimelineEntry> {
  const byId = new Map<string, TimelineEntry>();
  for (const entry of entries) {
    const id = idOf(entry);
    const held = byId.get(id);
    if (held === undefined || speaksFor(entry, held)) byId.set(id, entry);
  }
  return byId;
}

/**
 * The longest chain ending at each task.
 *
 * Only the previous step is kept rather than the whole chain, so a long plan
 * costs one entry per task instead of one chain per task. Depth-first with an
 * explicit stack, for the same reason `hasCycle` uses one; the graph is known
 * not to loop by the time this runs.
 */
function longestChains({
  byId,
  blockedBy,
}: {
  byId: ReadonlyMap<string, TimelineEntry>;
  blockedBy: ReadonlyMap<string, readonly string[]>;
}): ReadonlyMap<string, Chain> {
  const longest = new Map<string, Chain>();

  for (const root of byId.keys()) {
    const stack: string[] = [root];

    while (stack.length > 0) {
      const id = stack.pop();
      if (id === undefined || longest.has(id)) continue;

      const entry = byId.get(id);
      if (entry === undefined) continue;

      const steps = (blockedBy.get(id) ?? [])
        .filter((blocker) => byId.has(blocker))
        .map((blocker) => ({ id: blocker, chain: longest.get(blocker) }));

      const waiting = steps.filter((step) => step.chain === undefined);
      if (waiting.length > 0) {
        stack.push(id, ...waiting.map((step) => step.id));
        continue;
      }

      let best: Step | null = null;
      for (const step of steps.filter((step): step is Step => step.chain !== undefined)) {
        if (best === null || beats({ candidate: step.chain, best: best.chain, byId })) best = step;
      }

      const own = Math.max(daysBetween(entry.start, entry.end) + 1, 1);
      longest.set(id, {
        days: (best?.chain.days ?? 0) + own,
        via: best?.id ?? null,
        head: best?.chain.head ?? id,
      });
    }
  }

  return longest;
}

/**
 * Whether one chain wins over another.
 *
 * Longer wins. A tie goes to the chain that starts earlier, then to the lower
 * id, so the answer does not depend on what order the notes happened to be read
 * in — the same plan always names the same critical path.
 */
function beats({
  candidate,
  best,
  byId,
}: {
  candidate: Chain;
  best: Chain;
  byId: ReadonlyMap<string, TimelineEntry>;
}): boolean {
  if (candidate.days !== best.days) return candidate.days > best.days;

  const startOf = (id: string): string => byId.get(id)?.start ?? '';
  const byStart = startOf(candidate.head).localeCompare(startOf(best.head));
  return byStart !== 0 ? byStart < 0 : candidate.head.localeCompare(best.head) < 0;
}

/** The chain ending at a task, read back from each step's previous one. */
function chainTo(id: string, longest: ReadonlyMap<string, Chain>): readonly string[] {
  const chain: string[] = [];
  let at: string | null = id;
  while (at !== null) {
    chain.push(at);
    at = longest.get(at)?.via ?? null;
  }
  return chain.reverse();
}

/** The id a timeline entry is known by, for matching against a dependency. */
export function timelineEntryId(entry: TimelineEntry): string {
  return idOf(entry);
}
