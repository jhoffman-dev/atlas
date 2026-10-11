import { readWeeklyReview } from '../review/read-weekly-review.ts';
import { ApiError, messageWithoutPaths } from './api-error.ts';
import type { RouteResult, VaultRequest } from './vault-request.ts';

/**
 * The weekly review (P30-07), as its page shows it: read from the index on
 * the app's clock. It writes nothing; its quick actions are the routes that
 * already write — a status or a defer through PATCH properties, held to the
 * task rules, and a project into the Archive.
 */
export async function weeklyReviewRoute(request: VaultRequest): Promise<RouteResult> {
  const { index, fs, markdown, clock } = request;
  const review = await readWeeklyReview({ index, fs, markdown, clock }).catch((error: unknown) => {
    throw new ApiError(
      'query_failed',
      `The index could not take the weekly review: ${messageWithoutPaths(error)}`,
    );
  });
  return { status: 200, body: { review } };
}
