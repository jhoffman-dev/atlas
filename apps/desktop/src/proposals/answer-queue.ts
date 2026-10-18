import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { WindowClosingPort } from '@atlas/application';

/** Whose answer a write is: the vault it was given in, named by any object that stands for it. */
export type AnswerVault = object;

/** The answers being written, one after another, behind the Proposals section. */
export interface AnswerQueue {
  /** Writes `work` — an answer given in `vault` — once every answer queued before it is written. */
  readonly enqueue: (vault: AnswerVault, work: () => Promise<void>) => void;
  /** Where `vault`'s answers stand, to hand back to {@link AnswerQueue.quietSince} once a read lands. */
  readonly mark: (vault: AnswerVault) => number;
  /**
   * Whether no answer given in `vault` has been queued or written since
   * `mark`, and none is being written now. Another vault's answers, still
   * being written after a switch, do not hold back this one's reads.
   */
  readonly quietSince: (vault: AnswerVault, mark: number) => boolean;
  /** Settles once every answer queued so far has been written, or has failed. */
  readonly drained: () => Promise<void>;
}

interface VaultCount {
  pending: number;
  changes: number;
}

/**
 * Answers are written in the background, in the order given (#166), so the
 * next proposal can be answered while the last one is still being written.
 * Each `work` says its own failure where it belongs; once none is left to
 * write, `onDrained` runs — once for a run of answers, not once for each.
 */
export function useAnswerQueue(onDrained: () => void): AnswerQueue {
  const tail = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const counts = useRef(new WeakMap<AnswerVault, VaultCount>());
  const drained = useRef(onDrained);
  useEffect(() => {
    drained.current = onDrained;
  });

  const countOf = useCallback((vault: AnswerVault): VaultCount => {
    const known = counts.current.get(vault);
    if (known !== undefined) return known;
    const fresh = { pending: 0, changes: 0 };
    counts.current.set(vault, fresh);
    return fresh;
  }, []);

  const enqueue = useCallback(
    (vault: AnswerVault, work: () => Promise<void>) => {
      const count = countOf(vault);
      pending.current += 1;
      count.pending += 1;
      count.changes += 1;
      tail.current = tail.current
        .then(work)
        .catch((cause: unknown) => {
          // Each answer says its own failure; one that escapes it must still not stop the rest.
          console.error('An answer to a proposal failed unsaid:', cause);
        })
        .finally(() => {
          pending.current -= 1;
          count.pending -= 1;
          count.changes += 1;
          if (pending.current === 0) drained.current();
        });
    },
    [countOf],
  );
  const mark = useCallback((vault: AnswerVault) => countOf(vault).changes, [countOf]);
  const quietSince = useCallback(
    (vault: AnswerVault, begun: number) => {
      const count = countOf(vault);
      return count.pending === 0 && count.changes === begun;
    },
    [countOf],
  );
  const whenDrained = useCallback(() => tail.current, []);
  return useMemo(
    () => ({ enqueue, mark, quietSince, drained: whenDrained }),
    [enqueue, mark, quietSince, whenDrained],
  );
}

/** The longest closing the window, or leaving a vault, waits for the answers still being written. */
export const ANSWERS_CLOSE_WAIT_MS = 10_000;

/**
 * Settles once `drained` has — every answer queued written — or once
 * {@link ANSWERS_CLOSE_WAIT_MS} has passed: a hung disk must not hold the
 * window, or the vault, for ever.
 */
export function answersWrittenOrGivenUp(drained: Promise<unknown>): Promise<void> {
  return Promise.race([
    drained.then(() => undefined),
    new Promise<void>((resolve) => void window.setTimeout(resolve, ANSWERS_CLOSE_WAIT_MS)),
  ]);
}

/**
 * Holds the window's close until the answers queued are written (#166), so
 * an answer given just before closing is not lost with the window. A hung
 * disk must not keep the window open, so the wait has an end.
 */
export function useAnswersWrittenBeforeClose(
  queue: Pick<AnswerQueue, 'drained'>,
  closing: WindowClosingPort,
) {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let live = true;
    void closing
      .beforeClose(() => answersWrittenOrGivenUp(queue.drained()))
      .then(
        (stopListening) => {
          if (live) stop = stopListening;
          else stopListening();
        },
        // Without the close watched, an answer still being written may be cut short; say so.
        (cause: unknown) => console.error("The window's close cannot be watched:", cause),
      );
    return () => {
      live = false;
      stop?.();
    };
  }, [queue, closing]);
}
