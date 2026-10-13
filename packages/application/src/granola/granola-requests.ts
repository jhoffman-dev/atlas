import { backoff, paceOf, REQUESTS_PER_SECOND } from '@atlas/domain';
import type { Clock } from '../ports.ts';
import { GranolaError } from './ports.ts';

/** Waits this many milliseconds: a timer in the app, the test's own clock in a test. */
export type Wait = (milliseconds: number) => Promise<void>;

/** Sends one request to Granola, paced, and asked again while Granola says to slow down. */
export type GranolaSend = <T>(request: () => Promise<T>) => Promise<T>;

const isSlowDown = (error: unknown) =>
  error instanceof GranolaError &&
  error.failure.kind === 'api_refused' &&
  error.failure.status === 429;

/**
 * One pull's requests, kept under Granola's rate limit by the domain's pace,
 * and a 429 answered by waiting the domain's backoff and asking again. Past
 * the last retry the 429 is the request's failure.
 */
export function pacedRequests({
  clock,
  wait,
}: {
  clock: Pick<Clock, 'now'>;
  wait: Wait;
}): GranolaSend {
  const sentAt: number[] = [];

  const paced = async () => {
    const delay = paceOf({ sentAt, now: clock.now() });
    if (delay > 0) await wait(delay);
    sentAt.push(clock.now());
    // The pace looks at the last few only; older ones need not be kept.
    if (sentAt.length > REQUESTS_PER_SECOND) sentAt.shift();
  };

  return async (request) => {
    for (let attempt = 1; ; attempt += 1) {
      await paced();
      try {
        return await request();
      } catch (error) {
        const delay = isSlowDown(error) ? backoff(attempt) : null;
        if (delay === null) throw error;
        await wait(delay);
      }
    }
  };
}
