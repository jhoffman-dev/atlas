import { meetingLinkReport, messageWithoutPaths, type VaultPath } from '@atlas/domain';
import type { ActivityLog } from '../activity/ports.ts';
import type { MeetingImporter } from '../meetings/meeting-importer.ts';
import type { Clock } from '../ports.ts';
import { linkMeeting, type MeetingLinkPorts, type MeetingLinkRun } from './link-meeting.ts';

/** Links the meetings at these paths in this vault; settles with each run, or none when the vault has changed. */
export type MeetingLinker = (
  vault: string,
  paths: readonly VaultPath[],
) => Promise<readonly MeetingLinkRun[]>;

/**
 * The importer, linking each meeting it lets in — one that arrived following
 * the contract, or whose import error was fixed — once, as it is let in: a
 * meeting stamped `imported` is never judged again, so it is never linked
 * again, and a person taken out of its `people` stays out.
 */
export function linkImportedMeetings({
  importer,
  linker,
}: {
  importer: MeetingImporter;
  linker: MeetingLinker;
}): MeetingImporter {
  const thenLink =
    (vault: string) => async (outcome: Awaited<ReturnType<MeetingImporter['hear']>>) => {
      const letIn = (outcome?.happenings ?? []).flatMap((happening) =>
        happening.kind === 'arrived' || happening.kind === 'fixed' ? [happening.path] : [],
      );
      if (letIn.length > 0) await linker(vault, letIn);
      return outcome;
    };
  return {
    hear: (news) => importer.hear(news).then(thenLink(news.vault)),
    catchUp: (vault) => importer.catchUp(vault).then(thenLink(vault)),
  };
}

/**
 * Links meetings one at a time, each said in Activity: who it linked, what it
 * proposed, what it could not write. One meeting's failure is its own line,
 * and the rest are linked. Nothing is linked once another vault is open.
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
  return async (vault, paths) => {
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
        });
        const { linked, proposed, left } = run;
        recorder.record(
          meetingLinkReport({ meeting: path, linked, proposed: proposed.length, left }),
        );
        runs.push(run);
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
