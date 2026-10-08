import { meetingImportStoppedReport, messageWithoutPaths } from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import type { NoteChangeNews, NoteChanges } from '../index/note-changes.ts';
import type { Clock } from '../ports.ts';
import {
  importArrivedMeetings,
  type MeetingImportOutcome,
  type MeetingImportPorts,
  type SeenVersions,
} from './import-arrived-meetings.ts';

/** How many note versions the importer remembers having looked at, newest kept. */
export const SEEN_VERSIONS_KEPT = 2000;

/**
 * Imports meetings as the change feed hears of them (P28-04): every sync's
 * changes, one sync's at a time, so two never decide the same meeting at
 * once. A version heard again — the same note with the same bytes — is not
 * looked at twice.
 *
 * The ports answer for whichever vault is open, so news of a vault that is
 * no longer open is dropped, as the syncer drops its sync: reading it would
 * read the other vault under this one's name. They are asked for at the start
 * of each run, so the window can hand over new ones — as it does whenever
 * the tree is re-read — without the queue and what was heard being lost.
 */
export interface MeetingImporter {
  /** Settles once these changes are imported; null when they were dropped. */
  hear(news: NoteChangeNews): Promise<MeetingImportOutcome | null>;
}

export function createMeetingImporter({
  ports,
  clock,
  activity,
  openVault,
  onWritten,
}: {
  /** The ports as they are now, asked for at the start of each run. */
  ports: () => MeetingImportPorts;
  clock: Pick<Clock, 'today'>;
  activity: ActivityLog;
  /** The vault open now, which the ports answer for; null when none is. */
  openVault: () => string | null;
  /** Told when the import wrote or moved a note, so the tree and the index read it again. */
  onWritten: () => void;
}): MeetingImporter {
  let queue: Promise<unknown> = Promise.resolve();
  let seen: { vault: string; versions: SeenVersions } | null = null;

  const importNews = async (news: NoteChangeNews): Promise<MeetingImportOutcome | null> => {
    if (openVault() !== news.vault) return null;
    if (seen?.vault !== news.vault) seen = { vault: news.vault, versions: seenVersions() };
    const outcome = await importArrivedMeetings({
      ports: ports(),
      changes: news.changes,
      today: clock.today(),
      activity: activity.inVault(news.vault),
      seen: seen.versions,
    });
    if (outcome.wrote) onWritten();
    return outcome;
  };

  return {
    hear(news) {
      const next = queue.then(() => importNews(news));
      // The queue only orders; each caller gets its own run's outcome.
      queue = next.catch(() => undefined);
      return next;
    },
  };
}

/**
 * Hands every sync's news to the importer; returns the way to stop. A run
 * that fails outright — not one file, which the run says itself — is said in
 * the Activity log of the vault it was for.
 */
export function importMeetingsOnArrival({
  changes,
  importer,
  activity,
}: {
  changes: NoteChanges;
  importer: MeetingImporter;
  activity: ActivityLog;
}): () => void {
  return changes.subscribe((news) => {
    importer.hear(news).catch((cause: unknown) => {
      activity.inVault(news.vault).record(meetingImportStoppedReport(messageWithoutPaths(cause)));
    });
  });
}

/** The last {@link SEEN_VERSIONS_KEPT} versions looked at, oldest let go first. */
export function seenVersions(kept = SEEN_VERSIONS_KEPT): SeenVersions {
  const versions = new Set<string>();
  return {
    firstTime(path, digest) {
      const version = `${path}\u0000${digest}`;
      if (versions.has(version)) return false;
      versions.add(version);
      if (versions.size > kept) {
        const [oldest] = versions;
        if (oldest !== undefined) versions.delete(oldest);
      }
      return true;
    },
  };
}
