import { describe, expect, it } from 'vitest';
import { blockShares, scheduledMinutesByTask, type ScheduledTask } from './scheduling.ts';

/**
 * P31-01, adversarial: a container's shares (ADR-0030) are whole minutes
 * that add up to the block, "the odd minute to the largest remainder, then
 * the earliest listed" — whatever the estimates are.
 */
const task = (path: string, estimate: number | null): ScheduledTask => ({
  path,
  estimate,
  finished: false,
});

describe('a container block, attacked', () => {
  it('gives the odd minute to the earliest listed when two remainders are equal, however the division rounds', () => {
    // 30 min shared by 30 : 85 : 50 (of 165) is 5 5/11, 15 5/11 and 9 1/11. The
    // first two remainders are both 5/11, so the odd minute is the first's.
    // In floating point 15.4545… keeps a hair more than 5.4545…, and the second takes it.
    const admin = {
      path: 'blocks/Admin.md',
      start: '2026-10-12T09:00',
      end: '2026-10-12T09:30',
      tasks: [task('invoice.md', 30), task('report.md', 85), task('call.md', 50)],
    };

    expect(Object.fromEntries(blockShares(admin))).toEqual({
      'invoice.md': 6,
      'report.md': 15,
      'call.md': 9,
    });
  });

  it('schedules whole minutes adding up to the block, however large an estimate is written', () => {
    // `estimate: 1e308` is a finite number the index and estimateMinutes both accept.
    const huge = {
      path: 'blocks/Huge.md',
      start: '2026-10-12T09:00',
      end: '2026-10-12T10:00',
      tasks: [task('first.md', 1e308), task('second.md', 1e308)],
    };

    const scheduled = [...scheduledMinutesByTask([huge]).values()];

    expect(scheduled.every(Number.isInteger)).toBe(true);
    expect(scheduled.reduce((sum, minutes) => sum + minutes, 0)).toBe(60);
  });
});
