/**
 * Attacks on the dependency graph.
 *
 * Two ids that are the same, a tie between two chains, and a plan with more
 * tasks than the recursion can carry.
 */

import { describe, expect, it } from 'vitest';
import { buildTimeline, type TimelineEntry } from './timeline.ts';
import { criticalPath, dependencyGraph } from './critical-path.ts';

interface Task {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly blockedBy?: readonly string[];
  /** Defaults to the id, so two tasks can share an id without sharing a file. */
  readonly path?: string;
}

const plan = (tasks: readonly Task[]): readonly TimelineEntry[] =>
  buildTimeline({
    rows: tasks.map((task) => ({
      path: task.path ?? `${task.id}.md`,
      title: task.path ?? task.id,
      values: {
        id: task.id,
        scheduled: task.from,
        due: task.to,
        ...(task.blockedBy === undefined ? {} : { blocked_by: [...task.blockedBy] }),
      },
    })),
    startKey: 'scheduled',
    endKey: 'due',
  }).entries;

describe('criticalPath when two notes claim the same id', () => {
  const clashing = plan([
    { id: 'X', from: '2026-01-01', to: '2026-01-05' },
    { id: 'D', from: '2026-01-06', to: '2026-01-10', blockedBy: ['X'], path: 'first.md' },
    { id: 'D', from: '2026-01-06', to: '2026-01-10', path: 'second.md' },
  ]);

  it('does not lose a dependency one of them declared', () => {
    expect(dependencyGraph(clashing).blockedBy.get('D')).toContain('X');
  });

  it('still finds the ten days of work X and D are', () => {
    expect(criticalPath(clashing)).toEqual(['X', 'D']);
  });
});

describe('criticalPath when two chains are the same length', () => {
  it('gives the tie to the chain that starts earlier, as it says it does', () => {
    // A→B and C→D are both four days. C starts on the 1st, A on the 2nd.
    const tied = plan([
      { id: 'A', from: '2026-01-02', to: '2026-01-03' },
      { id: 'B', from: '2026-01-04', to: '2026-01-05', blockedBy: ['A'] },
      { id: 'C', from: '2026-01-01', to: '2026-01-01' },
      { id: 'D', from: '2026-01-06', to: '2026-01-08', blockedBy: ['C'] },
    ]);

    expect(criticalPath(tied)).toEqual(['C', 'D']);
  });
});

describe('criticalPath on a very long chain', () => {
  it('answers instead of running out of stack', () => {
    const length = 20_000;
    const chain = plan(
      Array.from({ length }, (_unused, at) => ({
        id: `t${at}`,
        from: '2026-01-01',
        to: '2026-01-01',
        ...(at === 0 ? {} : { blockedBy: [`t${at - 1}`] }),
      })),
    );

    expect(criticalPath(chain)).toHaveLength(length);
  });
});
