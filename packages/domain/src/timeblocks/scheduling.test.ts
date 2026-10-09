import { describe, expect, it } from 'vitest';
import { useZone, ZONES } from '../calendar/zones.test-support.ts';
import {
  blockMinutes,
  blockShares,
  scheduledMinutes,
  scheduledMinutesByTask,
  taskSchedule,
  type ScheduledTask,
  type TimeBlock,
} from './scheduling.ts';

/** P31-01: how much of each task the calendar has time set aside for (ADR-0030). */
const task = (path: string, estimate: number | null, finished = false): ScheduledTask => ({
  path,
  estimate,
  finished,
});

let blockCount = 0;
const block = (start: string, end: string, ...tasks: ScheduledTask[]): TimeBlock => ({
  path: `blocks/block-${(blockCount += 1)}.md`,
  start,
  end,
  tasks,
});

const shares = (of: TimeBlock) => Object.fromEntries(blockShares(of));

describe('the card’s acceptance criteria', () => {
  it('reads a 2h task in blocks of 1h, 30m and 30m as 2h scheduled of 2h', () => {
    const report = task('tasks/report.md', 120);
    const blocks = [
      block('2026-10-12T09:00', '2026-10-12T10:00', report),
      block('2026-10-13T14:00', '2026-10-13T14:30', report),
      block('2026-10-14T16:30', '2026-10-14T17:00', report),
    ];

    const scheduled = scheduledMinutes(report.path, blocks);

    expect(scheduled).toBe(120);
    expect(taskSchedule({ task: report, scheduled })).toEqual({
      estimate: 120,
      scheduled: 120,
      done: 0,
      overBy: 0,
    });
  });

  it('schedules each of three 20m tasks in a 1h container for 20m', () => {
    const container = block(
      '2026-10-12T13:00',
      '2026-10-12T14:00',
      task('tasks/invoice.md', 20),
      task('tasks/call.md', 20),
      task('tasks/reply.md', 20),
    );

    expect(shares(container)).toEqual({
      'tasks/invoice.md': 20,
      'tasks/call.md': 20,
      'tasks/reply.md': 20,
    });
  });

  it('reports a task scheduled past its estimate, by how much', () => {
    const review = task('tasks/review.md', 60);
    const blocks = [
      block('2026-10-12T09:00', '2026-10-12T10:00', review),
      block('2026-10-12T11:00', '2026-10-12T11:30', review),
    ];

    const scheduled = scheduledMinutes(review.path, blocks);

    expect(taskSchedule({ task: review, scheduled })).toMatchObject({
      scheduled: 90,
      overBy: 30,
    });
  });
});

describe('a block holding one task', () => {
  it('gives it the whole block, whatever its estimate says', () => {
    expect(shares(block('2026-10-12T09:00', '2026-10-12T11:00', task('a.md', 30)))).toEqual({
      'a.md': 120,
    });
    expect(shares(block('2026-10-12T09:00', '2026-10-12T09:45', task('a.md', null)))).toEqual({
      'a.md': 45,
    });
  });

  it('gives a finished task its block too: the time was set aside', () => {
    expect(shares(block('2026-10-12T09:00', '2026-10-12T10:00', task('a.md', 30, true)))).toEqual({
      'a.md': 60,
    });
  });

  it('is one task when it lists the same task twice', () => {
    const twice = block('2026-10-12T09:00', '2026-10-12T10:00', task('a.md', 20), task('a.md', 20));
    expect(shares(twice)).toEqual({ 'a.md': 60 });
  });

  it('gives nothing when it links no task', () => {
    expect(blockShares(block('2026-10-12T09:00', '2026-10-12T10:00')).size).toBe(0);
  });
});

describe('a container block', () => {
  it('shares itself in proportion to what each task has left, when they need all of it', () => {
    const tight = block(
      '2026-10-12T09:00',
      '2026-10-12T10:00',
      task('big.md', 90),
      task('small.md', 30),
    );
    expect(shares(tight)).toEqual({ 'big.md': 45, 'small.md': 15 });
  });

  it('gives each task what it has left and leaves the rest free, when they need less', () => {
    const roomy = block('2026-10-12T09:00', '2026-10-12T11:00', task('a.md', 20), task('b.md', 40));
    expect(shares(roomy)).toEqual({ 'a.md': 20, 'b.md': 40 });
  });

  it('gives a finished task nothing: it has nothing left to do', () => {
    const container = block(
      '2026-10-12T09:00',
      '2026-10-12T10:00',
      task('done.md', 30, true),
      task('open.md', 90),
    );
    expect(shares(container)).toEqual({ 'done.md': 0, 'open.md': 60 });
  });

  it('shares what the estimated tasks leave equally among the tasks with no estimate', () => {
    const mixed = block(
      '2026-10-12T09:00',
      '2026-10-12T10:00',
      task('known.md', 20),
      task('vague.md', null),
      task('vaguer.md', null),
    );
    expect(shares(mixed)).toEqual({ 'known.md': 20, 'vague.md': 20, 'vaguer.md': 20 });
  });

  it('shares itself equally when no task has an estimate', () => {
    const vague = block(
      '2026-10-12T09:00',
      '2026-10-12T10:30',
      task('a.md', null),
      task('b.md', null),
    );
    expect(shares(vague)).toEqual({ 'a.md': 45, 'b.md': 45 });
  });

  it('gives a task with no estimate nothing when the estimated ones need the whole block', () => {
    const full = block(
      '2026-10-12T09:00',
      '2026-10-12T10:00',
      task('known.md', 90),
      task('vague.md', null),
    );
    expect(shares(full)).toEqual({ 'known.md': 60, 'vague.md': 0 });
  });

  it('shares in whole minutes that add up to the block, the odd minute to the earliest listed', () => {
    const odd = block(
      '2026-10-12T09:00',
      '2026-10-12T09:50',
      task('first.md', 20),
      task('second.md', 20),
      task('third.md', 20),
    );
    expect(shares(odd)).toEqual({ 'first.md': 17, 'second.md': 17, 'third.md': 16 });
    expect([...blockShares(odd).values()].reduce((sum, minutes) => sum + minutes, 0)).toBe(50);
  });

  it('gives the left-over minute to the largest remainder before the earliest', () => {
    // 10 × 5/6 = 8.33 and 10 × 1/6 = 1.67: the second's remainder is the larger.
    const uneven = block(
      '2026-10-12T09:00',
      '2026-10-12T09:10',
      task('a.md', 50),
      task('b.md', 10),
    );
    expect(shares(uneven)).toEqual({ 'a.md': 8, 'b.md': 2 });
  });

  it('gives nothing to anything when every task is finished', () => {
    const finished = block(
      '2026-10-12T09:00',
      '2026-10-12T10:00',
      task('a.md', 20, true),
      task('b.md', 20, true),
    );
    expect(shares(finished)).toEqual({ 'a.md': 0, 'b.md': 0 });
  });

  it('gives nothing when it has no length', () => {
    const empty = block(
      '2026-10-12T09:00',
      '2026-10-12T09:00',
      task('a.md', 20),
      task('b.md', null),
    );
    expect(shares(empty)).toEqual({ 'a.md': 0, 'b.md': 0 });
    const emptyAndFinished = block(
      '2026-10-12T09:00',
      '2026-10-12T09:00',
      task('a.md', 20, true),
      task('b.md', 30, true),
    );
    expect(shares(emptyAndFinished)).toEqual({ 'a.md': 0, 'b.md': 0 });
  });
});

describe('a task across several blocks', () => {
  it('sums one-task blocks and its share of containers', () => {
    const report = task('report.md', 120);
    const blocks = [
      block('2026-10-12T09:00', '2026-10-12T10:00', report),
      block('2026-10-12T13:00', '2026-10-12T14:00', report, task('call.md', 60)),
    ];
    expect(Object.fromEntries(scheduledMinutesByTask(blocks))).toEqual({
      'report.md': 100,
      'call.md': 20,
    });
  });

  it('counts each of two overlapping blocks, so the task reads as over-scheduled', () => {
    const draft = task('draft.md', 60);
    const blocks = [
      block('2026-10-12T09:00', '2026-10-12T10:00', draft),
      block('2026-10-12T09:30', '2026-10-12T10:30', draft),
    ];
    const scheduled = scheduledMinutes(draft.path, blocks);
    expect(taskSchedule({ task: draft, scheduled })).toMatchObject({ scheduled: 120, overBy: 60 });
  });

  it('is scheduled for nothing when no block links it', () => {
    expect(scheduledMinutes('alone.md', [block('2026-10-12T09:00', '2026-10-12T10:00')])).toBe(0);
  });
});

describe('estimate, scheduled and done', () => {
  it('reads done from the status: all of the estimate once finished, none before', () => {
    expect(taskSchedule({ task: task('a.md', 45, true), scheduled: 30 })).toEqual({
      estimate: 45,
      scheduled: 30,
      done: 45,
      overBy: 0,
    });
    expect(taskSchedule({ task: task('a.md', 45), scheduled: 30 }).done).toBe(0);
  });

  it('says nothing of done or over-scheduling for a task with no estimate', () => {
    expect(taskSchedule({ task: task('a.md', null, true), scheduled: 600 })).toEqual({
      estimate: null,
      scheduled: 600,
      done: null,
      overBy: 0,
    });
  });

  it('is not over-scheduled when scheduled for exactly its estimate', () => {
    expect(taskSchedule({ task: task('a.md', 60), scheduled: 60 }).overBy).toBe(0);
  });
});

describe.each(ZONES)('a block’s length in %s', (zone) => {
  useZone(zone);
  const length = (start: unknown, end: unknown) => blockMinutes({ start, end });

  it('runs across midnight into the next day', () => {
    expect(length('2026-10-12T23:30', '2026-10-13T00:30')).toBe(60);
    expect(length('2026-12-31T22:00', '2027-01-01T01:00')).toBe(180);
  });

  it('is its wall-clock length across a daylight-saving change, as the calendar draws it', () => {
    // New York springs forward at 02:00 on 8 March 2026 and falls back on 1 November;
    // London on 29 March and 25 October; Lord Howe moves half an hour on 5 April.
    expect(length('2026-03-08T01:30', '2026-03-08T03:30')).toBe(120);
    expect(length('2026-11-01T00:30', '2026-11-01T02:30')).toBe(120);
    expect(length('2026-03-29T00:30', '2026-03-29T02:30')).toBe(120);
    expect(length('2026-10-25T00:30', '2026-10-25T02:30')).toBe(120);
    expect(length('2026-04-05T01:00', '2026-04-05T03:00')).toBe(120);
    expect(length('2026-03-07T23:00', '2026-03-08T03:00')).toBe(240);
  });

  it('is nothing when it ends no later than it starts', () => {
    expect(length('2026-10-12T10:00', '2026-10-12T09:00')).toBe(0);
    expect(length('2026-10-13T00:30', '2026-10-12T23:30')).toBe(0);
    expect(length('2026-10-12T10:00', '2026-10-12T10:00')).toBe(0);
  });

  it('is nothing without a day and a time at both ends', () => {
    expect(length('2026-10-12', '2026-10-13')).toBe(0);
    expect(length('2026-10-12T09:00', '2026-10-12')).toBe(0);
    expect(length('2026-10-12', '2026-10-12T10:00')).toBe(0);
    expect(length('2026-10-12T09:00', null)).toBe(0);
    expect(length(undefined, '2026-10-12T10:00')).toBe(0);
    expect(length('soon', 'later')).toBe(0);
    expect(length('2026-02-30T09:00', '2026-02-30T10:00')).toBe(0);
  });

  it('reads a time with seconds, or written with a space, as the wall-clock time it says', () => {
    expect(length('2026-10-12T09:00:00', '2026-10-12T09:45:00')).toBe(45);
    expect(length('2026-10-12 09:00', '2026-10-12 10:15')).toBe(75);
  });
});
