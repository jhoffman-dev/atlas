import { meetingImportStoppedReport, messageWithoutPaths } from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import type { NoteChangeNews, NoteChanges } from '../index/note-changes.ts';
import type { Clock } from '../ports.ts';
import {
  catchUpMeetings,
  importArrivedMeetings,
  type MeetingImportOutcome,
  type MeetingImportPorts,
  type MeetingImportRun,
} from './import-arrived-meetings.ts';

/**
 * Imports meetings (P28-04): as the change feed hears of them, and all at
 * once when asked to catch up. Runs go one at a time, so two never settle the
 * same meeting at once.
 *
 * Only the Mac that runs the vault's automations imports — `active` says
 * whether this is it — so two Macs never write the same file. One that is
 * not drops what it hears; nothing is lost by that, since what a file is due
 * is in the file, and catching up when the import starts or this Mac takes
 * the automations over settles every file left.
 *
 * The ports answer for whichever vault is open, so a run for a vault that is
 * no longer open is dropped too. They are asked for at the start of each
 * run, so the window can hand over new ones — as it does whenever the tree
 * is re-read — without the queue being lost.
 */
export interface MeetingImporter {
  /** Settles once these changes are imported; null when dropped, or when the run failed (said in Activity). */
  hear(news: NoteChangeNews): Promise<MeetingImportOutcome | null>;
  /** Settles once every unsettled file in the vault's meeting folder is; null when dropped. */
  catchUp(vault: string): Promise<MeetingImportOutcome | null>;
}

export function createMeetingImporter({
  ports,
  clock,
  activity,
  openVault,
  active,
  onWritten,
}: {
  /** The ports as they are now, asked for at the start of each run. */
  ports: () => MeetingImportPorts;
  clock: Pick<Clock, 'today'>;
  activity: ActivityLog;
  /** The vault open now, which the ports answer for; null when none is. */
  openVault: () => string | null;
  /** Whether this Mac imports: it runs the vault's automations. */
  active: () => boolean;
  /** Told when the import wrote or moved a note, so the tree and the index read it again. */
  onWritten: () => void;
}): MeetingImporter {
  let queue: Promise<unknown> = Promise.resolve();

  const runFor = (
    vault: string,
    importing: (run: MeetingImportRun) => Promise<MeetingImportOutcome>,
  ): Promise<MeetingImportOutcome | null> => {
    const next = queue.then(async () => {
      if (!active() || openVault() !== vault) return null;
      const recorder = activity.inVault(vault);
      try {
        const outcome = await importing({
          ports: ports(),
          today: clock.today(),
          activity: recorder,
        });
        if (outcome.wrote) onWritten();
        return outcome;
      } catch (cause) {
        // Not one file, which the run says itself: the run could not start, or the folder be read.
        recorder.record(meetingImportStoppedReport(messageWithoutPaths(cause)));
        return null;
      }
    });
    queue = next;
    return next;
  };

  return {
    hear: (news) =>
      runFor(news.vault, (run) => importArrivedMeetings({ ...run, changes: news.changes })),
    catchUp: (vault) => runFor(vault, catchUpMeetings),
  };
}

/** Hands every sync's news to the importer; returns the way to stop. */
export function importMeetingsOnArrival({
  changes,
  importer,
}: {
  changes: NoteChanges;
  importer: MeetingImporter;
}): () => void {
  return changes.subscribe((news) => {
    // A run never rejects: what goes wrong is said in Activity by the importer.
    void importer.hear(news);
  });
}
