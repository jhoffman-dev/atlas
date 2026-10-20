import { act } from '@testing-library/react';
import { vi } from 'vitest';

/** How many rounds of queued work `settles` runs before it gives up: a count, not a time. */
const ROUNDS = 100;

/**
 * Testing Library's `waitFor`, for fake timers that stand still: runs the work
 * already queued (promises, and timers already due) a round at a time until
 * `check` passes, and never moves the clock. `waitFor` times itself on the
 * timers it is given, so it needs a fake clock that also follows the real one,
 * and a slow machine then moves the hook's own timers too (#403).
 */
export async function settles(check: () => void): Promise<void> {
  for (let round = 0; ; round += 1) {
    try {
      check();
      return;
    } catch (notYet) {
      // Not yet is expected while work is queued; only the last round's failure is the answer.
      if (round === ROUNDS) throw notYet;
    }
    await runQueuedRound();
  }
}

/** Runs every round of the work already queued, and never moves the clock. */
export async function drained(): Promise<void> {
  for (let round = 0; round < ROUNDS; round += 1) await runQueuedRound();
}

const runQueuedRound = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
