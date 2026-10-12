import {
  meetingLinkReport,
  messageWithoutPaths,
  type VaultPath,
  type Vocabulary,
} from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import type { LetInStamp } from '../meetings/meeting-files.ts';
import type { Clock } from '../ports.ts';
import { linkMeeting, type MeetingLinkPorts, type MeetingLinkRun } from './link-meeting.ts';

/** Links the meetings at these paths in this vault; settles with each run, or none when the vault has changed. */
export type MeetingLinker = (
  vault: string,
  paths: readonly VaultPath[],
  /**
   * What the caller's run has already read — the vocabulary it corrects by,
   * for the speakers to be read by too — and whether it writes the record of
   * a linking that added nothing itself (`linkMeeting`'s `recordInStamp`).
   */
  reading?: { readonly vocabulary?: Vocabulary | undefined; readonly recordInStamp?: boolean },
) => Promise<readonly MeetingLinkRun[]>;

/**
 * Links meetings one at a time, each said in Activity: who it linked, what it
 * proposed, what it could not write. One meeting's failure is its own line,
 * and the rest are linked. Nothing is linked once another vault is open.
 *
 * The importer runs it as each meeting is about to be let in (`beforeLetIn`):
 * once per meeting, before the stamp, so the links are part of the meeting
 * that arrives and no write to it follows. A meeting stamped `imported` is
 * never judged again, so never linked again, and a person taken out of its
 * `people` stays out. A meeting whose linking failed is let in without the
 * record linking leaves (`atlas_links`), which is what marks it for another
 * try: the "after a meeting" rule's link step links any meeting that lacks
 * it (#19); Activity says the first try failed. A
 * meeting whose links were written and whose proposals then could not be is
 * said as linked, with why nothing was proposed, and its run is kept.
 */
export function createMeetingLinker({
  ports,
  clock,
  activity,
  openVault,
  selfName,
  onWritten,
}: {
  ports: () => MeetingLinkPorts;
  clock: Pick<Clock, 'today'>;
  activity: ActivityLog;
  openVault: () => string | null;
  /** The vault owner's name, from their profile, as it is now. */
  selfName: () => string | null;
  /** Told when linking wrote a note, so the tree and the index read it again. */
  onWritten: () => void;
}): MeetingLinker {
  return async (vault, paths, reading = {}) => {
    const recorder = activity.inVault(vault);
    const runs: MeetingLinkRun[] = [];
    for (const path of paths) {
      if (openVault() !== vault) break;
      try {
        const run = await linkMeeting({
          ports: ports(),
          path,
          today: clock.today(),
          selfName: selfName(),
          vocabulary: reading.vocabulary,
          ...(reading.recordInStamp !== undefined && { recordInStamp: reading.recordInStamp }),
        });
        runs.push(run);
        // Linked before — a first try whose stamp write was refused: nothing was done, so nothing is said.
        if (run.already !== undefined) continue;
        const { linked, proposed, left, unproposed } = run;
        recorder.record(
          meetingLinkReport({ meeting: path, linked, proposed: proposed.length, left, unproposed }),
        );
      } catch (cause) {
        recorder.record({
          level: 'error',
          kind: 'meeting',
          message: `Could not link the meeting: ${messageWithoutPaths(cause)}`,
          subject: { kind: 'note', path },
        });
      }
    }
    if (runs.some((run) => run.done.length > 0 || run.proposed.length > 0)) onWritten();
    return runs;
  };
}

/**
 * The importer's hook that links each meeting just before it is let in
 * (`createMeetingImporter`'s `beforeLetIn`). The record of a linking that
 * added no link comes back for the stamp write to carry, so such a meeting
 * is written once, by the stamp; one that gained links was written by the
 * linking, record and all.
 */
export function linkBeforeLetIn(
  linker: MeetingLinker,
): (
  vault: string,
  path: VaultPath,
  reading: { readonly vocabulary: Vocabulary },
) => Promise<LetInStamp | undefined> {
  return async (vault, path, reading) => {
    const [run] = await linker(vault, [path], { ...reading, recordInStamp: true });
    return run?.stamp === undefined ? undefined : { stamp: run.stamp };
  };
}
