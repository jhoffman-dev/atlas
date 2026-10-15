import { isArchivedPath } from '../archive/archive.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import type { MeetingOnRecord } from './meeting-series-queries.ts';
import { suggestMeetingProject, type ProjectSuggestion } from './meeting-series.ts';

/** A meeting with no project, as the backfill's preview lists it (#227). */
export interface ProjectBackfillRow {
  readonly meeting: VaultPath;
  readonly title: string;
  readonly date: string;
  /** What its twin or series says; null when nothing does, and it is left empty. */
  readonly suggestion: ProjectSuggestion | null;
}

/**
 * Every meeting outside the Archive whose `project` holds nothing, with what
 * its twin or series says it is filed under (#227), newest first. Each is
 * judged against the vault as it is: one the backfill files does not vote
 * for another in the same preview, so running it twice proposes the same.
 */
export function planProjectBackfill(meetings: readonly MeetingOnRecord[]): ProjectBackfillRow[] {
  return meetings
    .filter((meeting) => !meeting.filed && !isArchivedPath(meeting.path))
    .map((meeting) => ({
      meeting: meeting.path,
      title: meeting.title,
      date: meeting.date,
      suggestion: suggestMeetingProject({ meeting, others: meetings }),
    }))
    .sort(
      (left, right) =>
        compareText(right.date, left.date) || compareText(left.meeting, right.meeting),
    );
}

/** What a row says when nothing says where its meeting is filed. */
export const NO_SERIES_PROJECT =
  'Nothing in its series, or another copy of it, says which project.';

/** Whether a row is filed when the backfill runs as offered: only what is sure. */
export function isFiledByDefault(row: ProjectBackfillRow): boolean {
  return row.suggestion?.confidence === 'high';
}

const meetings = (count: number) => (count === 1 ? '1 meeting' : `${count} meetings`);

/** What a backfill did, in a sentence for Activity and the offer: "Filed 12 meetings under their projects." */
export function projectBackfillLine({ filed, left }: { filed: number; left: number }): string {
  const leftWords =
    left === 0 ? '' : ` ${meetings(left)} left as ${left === 1 ? 'it was' : 'they were'}.`;
  return `Filed ${meetings(filed)} under ${filed === 1 ? 'its project' : 'their projects'}.${leftWords}`;
}

/** What undoing a backfill did, in a sentence. */
export function projectBackfillUndoLine({
  restored,
  left,
}: {
  restored: number;
  left: number;
}): string {
  const leftWords =
    left === 0
      ? ''
      : ` ${meetings(left)} changed since, so left as ${left === 1 ? 'it is' : 'they are'}.`;
  return `Took the project off ${meetings(restored)}.${leftWords}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
