import { describe, expect, it } from 'vitest';
import { buildTimeline, type TimelineEntry } from './timeline.ts';
import { criticalPath, dependencyGraph, timelineEntryId } from './critical-path.ts';

/** Tasks as a plan writes them: an id, a stretch of days, and what they wait for. */
const plan = (
  tasks: readonly { id: string; from: string; to: string; blockedBy?: unknown }[],
): readonly TimelineEntry[] =>
  buildTimeline({
    rows: tasks.map((task) => ({
      path: `${task.id}.md`,
      title: task.id,
      values: {
        id: task.id,
        scheduled: task.from,
        due: task.to,
        ...(task.blockedBy === undefined ? {} : { blocked_by: task.blockedBy }),
      },
    })),
    startKey: 'scheduled',
    endKey: 'due',
  }).entries;

describe('dependencyGraph', () => {
  it('says nothing is duplicated when every id is its own', () => {
    const graph = dependencyGraph(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-02' },
        { id: 'B', from: '2026-09-03', to: '2026-09-04', blockedBy: ['A'] },
      ]),
    );
    expect(graph.duplicated).toEqual([]);
  });

  it('names an id more than one note claims, rather than letting one win', () => {
    const graph = dependencyGraph(
      buildTimeline({
        rows: [
          { path: 'first.md', title: 'first', values: { id: 'D', scheduled: '2026-09-01' } },
          { path: 'second.md', title: 'second', values: { id: 'D', scheduled: '2026-09-02' } },
        ],
        startKey: 'scheduled',
        endKey: 'due',
      }).entries,
    );
    expect(graph.duplicated).toEqual(['D']);
  });

  it('reads what each task waits for', () => {
    const graph = dependencyGraph(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-02' },
        { id: 'B', from: '2026-09-03', to: '2026-09-04', blockedBy: ['A'] },
      ]),
    );
    expect(graph.blockedBy.get('B')).toEqual(['A']);
  });

  it('reads a single blocker written without brackets', () => {
    const graph = dependencyGraph(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-02' },
        { id: 'B', from: '2026-09-03', to: '2026-09-04', blockedBy: 'A' },
      ]),
    );
    expect(graph.blockedBy.get('B')).toEqual(['A']);
  });

  it('reads blockers written as one comma-separated cell', () => {
    const graph = dependencyGraph(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-02' },
        { id: 'B', from: '2026-09-01', to: '2026-09-02' },
        { id: 'C', from: '2026-09-03', to: '2026-09-04', blockedBy: 'A, B' },
      ]),
    );
    expect(graph.blockedBy.get('C')).toEqual(['A', 'B']);
  });

  it('reports a blocker that names no task rather than inventing one', () => {
    const graph = dependencyGraph(
      plan([{ id: 'A', from: '2026-09-01', to: '2026-09-02', blockedBy: ['GHOST'] }]),
    );
    expect(graph.unknown).toEqual(['GHOST']);
    expect(graph.blockedBy.get('A')).toEqual([]);
  });

  it('ignores a task that blocks itself', () => {
    const graph = dependencyGraph(
      plan([{ id: 'A', from: '2026-09-01', to: '2026-09-02', blockedBy: ['A'] }]),
    );
    expect(graph.blockedBy.get('A')).toEqual([]);
    expect(graph.circular).toBe(false);
  });

  it('spots a loop', () => {
    const graph = dependencyGraph(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-02', blockedBy: ['B'] },
        { id: 'B', from: '2026-09-03', to: '2026-09-04', blockedBy: ['A'] },
      ]),
    );
    expect(graph.circular).toBe(true);
  });

  it('spots a loop that goes the long way round', () => {
    const graph = dependencyGraph(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-02', blockedBy: ['C'] },
        { id: 'B', from: '2026-09-03', to: '2026-09-04', blockedBy: ['A'] },
        { id: 'C', from: '2026-09-05', to: '2026-09-06', blockedBy: ['B'] },
      ]),
    );
    expect(graph.circular).toBe(true);
  });

  it('does not call a diamond a loop', () => {
    const graph = dependencyGraph(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-02' },
        { id: 'B', from: '2026-09-03', to: '2026-09-04', blockedBy: ['A'] },
        { id: 'C', from: '2026-09-03', to: '2026-09-04', blockedBy: ['A'] },
        { id: 'D', from: '2026-09-05', to: '2026-09-06', blockedBy: ['B', 'C'] },
      ]),
    );
    expect(graph.circular).toBe(false);
  });
});

describe('timelineEntryId', () => {
  it('uses the id a task gives itself', () => {
    const [entry] = plan([{ id: 'A', from: '2026-09-01', to: '2026-09-02' }]);
    expect(entry && timelineEntryId(entry)).toBe('A');
  });

  it('falls back to the path when a task has no id', () => {
    const entries = buildTimeline({
      rows: [{ path: 'notes/a.md', title: 'A', values: { scheduled: '2026-09-01' } }],
      startKey: 'scheduled',
      endKey: 'due',
    }).entries;
    expect(entries[0] && timelineEntryId(entries[0])).toBe('notes/a.md');
  });
});

describe('criticalPath', () => {
  it('is empty when there is nothing to plan', () => {
    expect(criticalPath([])).toEqual([]);
  });

  it('is the one task when there is only one', () => {
    expect(criticalPath(plan([{ id: 'A', from: '2026-09-01', to: '2026-09-02' }]))).toEqual(['A']);
  });

  it('follows the chain of blocking work', () => {
    expect(
      criticalPath(
        plan([
          { id: 'A', from: '2026-09-01', to: '2026-09-02' },
          { id: 'B', from: '2026-09-03', to: '2026-09-04', blockedBy: ['A'] },
          { id: 'C', from: '2026-09-05', to: '2026-09-06', blockedBy: ['B'] },
        ]),
      ),
    ).toEqual(['A', 'B', 'C']);
  });

  it('takes the longer of two chains, not the one with more tasks', () => {
    // Two short tasks add up to four days; one long task takes ten.
    const found = criticalPath(
      plan([
        { id: 'SHORT1', from: '2026-09-01', to: '2026-09-02' },
        { id: 'SHORT2', from: '2026-09-03', to: '2026-09-04', blockedBy: ['SHORT1'] },
        { id: 'LONG', from: '2026-09-01', to: '2026-09-10' },
        { id: 'END', from: '2026-09-11', to: '2026-09-11', blockedBy: ['SHORT2', 'LONG'] },
      ]),
    );
    expect(found).toEqual(['LONG', 'END']);
  });

  it('leaves work that nothing waits on off the path', () => {
    const found = criticalPath(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-10' },
        { id: 'B', from: '2026-09-11', to: '2026-09-12', blockedBy: ['A'] },
        { id: 'ASIDE', from: '2026-09-01', to: '2026-09-02' },
      ]),
    );
    expect(found).not.toContain('ASIDE');
  });

  it('reports nothing when the dependencies loop, rather than picking one', () => {
    expect(
      criticalPath(
        plan([
          { id: 'A', from: '2026-09-01', to: '2026-09-02', blockedBy: ['B'] },
          { id: 'B', from: '2026-09-03', to: '2026-09-04', blockedBy: ['A'] },
        ]),
      ),
    ).toEqual([]);
  });

  it('counts a milestone as a day rather than as nothing', () => {
    const found = criticalPath(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-01' },
        { id: 'SHIP', from: '2026-09-02', to: '2026-09-02', blockedBy: ['A'] },
      ]),
    );
    expect(found).toEqual(['A', 'SHIP']);
  });

  it('does not walk a diamond twice', () => {
    const found = criticalPath(
      plan([
        { id: 'A', from: '2026-09-01', to: '2026-09-05' },
        { id: 'B', from: '2026-09-06', to: '2026-09-07', blockedBy: ['A'] },
        { id: 'C', from: '2026-09-06', to: '2026-09-10', blockedBy: ['A'] },
        { id: 'D', from: '2026-09-11', to: '2026-09-11', blockedBy: ['B', 'C'] },
      ]),
    );
    expect(found).toEqual(['A', 'C', 'D']);
  });
});

describe('criticalPath whatever order the notes arrive in', () => {
  const entries = plan([
    { id: 'A', from: '2026-09-02', to: '2026-09-03' },
    { id: 'B', from: '2026-09-04', to: '2026-09-05', blockedBy: ['A'] },
    { id: 'C', from: '2026-09-01', to: '2026-09-01' },
    { id: 'D', from: '2026-09-06', to: '2026-09-08', blockedBy: ['C'] },
  ]);

  it('names the same chain when the notes are read backwards', () => {
    expect(criticalPath([...entries].reverse())).toEqual(criticalPath(entries));
  });
});

describe('criticalPath when two notes claim one id', () => {
  /** Two notes with one id, as two files rather than one. */
  const clashing = (
    tasks: readonly { path: string; from: string; to: string }[],
  ): readonly TimelineEntry[] =>
    buildTimeline({
      rows: tasks.map((task) => ({
        path: task.path,
        title: task.path,
        values: { id: 'D', scheduled: task.from, due: task.to },
      })),
      startKey: 'scheduled',
      endKey: 'due',
    }).entries;

  it('reads the id as the longest run of days the two of them claim', () => {
    const entries = clashing([
      { path: 'short.md', from: '2026-09-01', to: '2026-09-02' },
      { path: 'long.md', from: '2026-09-01', to: '2026-09-10' },
    ]);
    expect(criticalPath(entries)).toEqual(['D']);
    expect(criticalPath([...entries].reverse())).toEqual(['D']);
  });

  it('answers the same when the two are the same days on different paths', () => {
    const entries = clashing([
      { path: 'first.md', from: '2026-09-01', to: '2026-09-02' },
      { path: 'second.md', from: '2026-09-01', to: '2026-09-02' },
    ]);
    expect(criticalPath([...entries].reverse())).toEqual(criticalPath(entries));
  });
});
