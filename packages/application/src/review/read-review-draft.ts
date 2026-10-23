import {
  compileReviewDoneQuery,
  compileReviewMeetingsQuery,
  reviewDraftData,
  reviewDraftWindow,
  reviewSource,
  type ReviewDraftData,
} from '@dfai/domain';
import type { Clock } from '../ports.ts';
import { readWeeklyReview } from './read-weekly-review.ts';
import { rowsOf, type ReviewReadPorts } from './review-reads.ts';

/**
 * What the Friday review draft (#40) is handed, read at one moment on the
 * injected clock: the weekly review as its page shows it, with the tasks
 * finished and the meetings held in the last `REVIEW_DRAFT_DAYS` days,
 * and the notes the draft may cite.
 */
export async function readReviewDraft({
  clock,
  ...reads
}: ReviewReadPorts & { clock: Pick<Clock, 'today' | 'now'> }): Promise<ReviewDraftData> {
  const now = clock.now();
  const today = clock.today();
  const { since, sinceDay } = reviewDraftWindow({ today, now });
  const [report, done, meetings] = await Promise.all([
    readWeeklyReview({ clock: { today: () => today, now: () => now }, ...reads }),
    rowsOf(reads.index, compileReviewDoneQuery(since)),
    rowsOf(reads.index, compileReviewMeetingsQuery({ sinceDay, today })),
  ]);
  return reviewDraftData({
    review: report,
    done: done.rows.map(reviewSource),
    meetings: meetings.rows.map(reviewSource),
    inbox: report.inbox,
    truncated: report.truncated || done.truncated || meetings.truncated,
    today,
    now,
  });
}
