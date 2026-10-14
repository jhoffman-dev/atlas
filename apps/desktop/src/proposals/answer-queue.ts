import { useCallback, useEffect, useMemo, useRef } from 'react';

/** The answers being written, one after another, behind the Proposals section. */
export interface AnswerQueue {
  /** Writes `work` once every answer queued before it is written. */
  readonly enqueue: (work: () => Promise<void>) => void;
  /** Where the queue stands, to hand back to {@link AnswerQueue.quietSince} once a read lands. */
  readonly mark: () => number;
  /** Whether no answer has been queued or written since `mark`, and none is being written now. */
  readonly quietSince: (mark: number) => boolean;
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
  const changes = useRef(0);
  const drained = useRef(onDrained);
  useEffect(() => {
    drained.current = onDrained;
  });

  const enqueue = useCallback((work: () => Promise<void>) => {
    pending.current += 1;
    changes.current += 1;
    tail.current = tail.current
      .then(work)
      .catch((cause: unknown) => {
        // Each answer says its own failure; one that escapes it must still not stop the rest.
        console.error('An answer to a proposal failed unsaid:', cause);
      })
      .finally(() => {
        pending.current -= 1;
        changes.current += 1;
        if (pending.current === 0) drained.current();
      });
  }, []);
  const mark = useCallback(() => changes.current, []);
  const quietSince = useCallback(
    (begun: number) => pending.current === 0 && changes.current === begun,
    [],
  );
  return useMemo(() => ({ enqueue, mark, quietSince }), [enqueue, mark, quietSince]);
}
