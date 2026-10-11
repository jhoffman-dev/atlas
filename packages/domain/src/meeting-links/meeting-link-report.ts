import type { ActivityReport } from '../activity/activity-event.ts';
import { noteTitle } from '../vault/vault-entry.ts';
import type { VaultPath } from '../vault/vault-path.ts';

/** What linking one meeting did, as Activity says it. */
export interface MeetingLinkHappening {
  readonly meeting: VaultPath;
  /** The people and companies it linked. */
  readonly linked: readonly VaultPath[];
  /** How many proposals it wrote. */
  readonly proposed: number;
  /** Notes it could not write, and why — the meeting, or a proposal. */
  readonly left: readonly { readonly path: VaultPath; readonly reason: string }[];
}

/** One Activity line per meeting linked: who it linked, what it proposed, and what it could not do. */
export function meetingLinkReport(happening: MeetingLinkHappening): ActivityReport {
  const { meeting, linked, proposed, left } = happening;
  const parts = [
    linked.length > 0 ? `linked ${linked.map(noteTitle).join(', ')}` : 'linked no one new',
    ...(proposed > 0 ? [`proposed ${proposed} in the Inbox`] : []),
    ...left.map(({ path, reason }) => `left ${noteTitle(path)}: ${reason.replace(/\.$/, '')}`),
  ];
  return {
    level: left.length > 0 ? 'warning' : 'info',
    kind: 'meeting',
    message: `${noteTitle(meeting)}: ${parts.join('; ')}.`,
    subject: { kind: 'note', path: meeting },
  };
}
