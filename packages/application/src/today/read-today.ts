import { todayLists, type TodayLists } from '@dfai/domain';
import type { Clock } from '../ports.ts';
import {
  readReviewSources,
  type InboxCount,
  type InboxRule,
  type ReviewReadPorts,
} from '../review/review-reads.ts';

/** The Today page as it is shown: its sections, and what waits elsewhere. */
export interface TodayReport extends TodayLists {
  /** The day it was taken, `YYYY-MM-DD`, from the injected clock. */
  readonly today: string;
  readonly inbox: InboxCount;
  /** The index held rows back, so a section may be missing tasks. */
  readonly truncated: boolean;
}

/**
 * Reads the Today page (#111): the weekly review's reads — every open task
 * in one statement, the projects, the Inbox's count — put through the page's
 * rules on the injected clock, whose `today` is the day everything turns on.
 */
export async function readToday({
  clock,
  ...reads
}: ReviewReadPorts &
  InboxRule & {
    clock: Pick<Clock, 'today' | 'now'>;
  }): Promise<TodayReport> {
  const { tasks, projects, inbox, truncated } = await readReviewSources(reads);
  const at = { today: clock.today(), now: clock.now() };
  return { ...todayLists({ tasks, projects, at }), today: at.today, inbox, truncated };
}
