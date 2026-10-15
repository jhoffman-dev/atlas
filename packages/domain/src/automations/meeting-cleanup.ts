/**
 * The offered cleanup (#226): the tasks the "After a meeting" rule made that
 * today's rules would not have made — judged from what the task and its
 * meeting still hold, never from the model. Nothing is archived until the
 * person says so, and they may keep any.
 *
 * What can be judged again is whose the item was: the cited turn must have
 * been spoken by the owner, by name, in a vault that says who its owner is.
 * How sure the model was is not kept on a task, so a task made at medium
 * confidence under the earlier floor cannot be told from one made at high,
 * and is not listed. A task already finished, archived, or whose meeting or
 * turn can no longer be found is left alone: nothing is guessed.
 */

import { FINISHED_TASK_STATUS, holdsStatus, TASK_KEYS } from '../gtd/gtd-status.ts';
import { isArchivedPath } from '../archive/archive.ts';
import { readWikiLink } from '../markdown/wikilink-spans.ts';
import { meetingTurnsOf } from '../meetings/meeting-turns.ts';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import type { VaultPath } from '../vault/vault-path.ts';
import { itemOwner } from './meeting-item-owner.ts';
import { vaultNamesItsOwner, type OwnerSettings } from './meeting-item-apply.ts';

/** Why a made task fails today's rules. */
export type CleanupReason =
  /** The turn it cites was spoken by someone other than the owner. */
  | 'spoken-by-another'
  /** The turn it cites has no named speaker: whose it was is a guess. */
  | 'unnamed-speaker'
  /** The vault does not say who its owner is: no task can be known to be theirs. */
  | 'owner-unknown';

/** A task the rule made, as the cleanup reads it. */
export interface MadeMeetingTask {
  readonly path: VaultPath;
  readonly title: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/** The meeting a task cites, as it is now. */
export interface CitedMeeting {
  readonly text: string;
  readonly attendees: readonly MeetingAttendee[];
}

/** A task the cleanup lists, and why. */
export interface CleanupCandidate {
  readonly path: VaultPath;
  readonly title: string;
  readonly because: CleanupReason;
}

/** What the preview says of each reason, in a sentence. */
export const CLEANUP_REASON_WORDS: Readonly<Record<CleanupReason, string>> = {
  'spoken-by-another': 'Someone else said it, not you.',
  'unnamed-speaker': 'Nobody named said it, so it may not be yours.',
  'owner-unknown': 'Atlas can’t tell which items are yours.',
};

/**
 * The tasks of `tasks` today's rules would not have made, in the order given.
 * `meetingOf` finds the meeting a link's target names, or null when there is
 * none to read.
 */
export function meetingTasksFailingRules({
  tasks,
  meetingOf,
  owner,
}: {
  tasks: readonly MadeMeetingTask[];
  meetingOf: (target: string) => CitedMeeting | null;
  owner: OwnerSettings;
}): CleanupCandidate[] {
  const known = vaultNamesItsOwner(owner);
  return tasks.flatMap((task) => {
    if (
      isArchivedPath(task.path) ||
      holdsStatus(task.properties[TASK_KEYS.status], FINISHED_TASK_STATUS)
    ) {
      return [];
    }
    const because = known ? reasonOf(task, meetingOf, owner) : 'owner-unknown';
    return because === null ? [] : [{ path: task.path, title: task.title, because }];
  });
}

/** Why the task's cited turn was not the owner's to take on; null when it was, or cannot be read. */
function reasonOf(
  task: MadeMeetingTask,
  meetingOf: (target: string) => CitedMeeting | null,
  owner: OwnerSettings,
): CleanupReason | null {
  const source = task.properties[TASK_KEYS.source];
  const link = typeof source === 'string' ? readWikiLink(source.trim()) : null;
  if (link === null || link.heading?.startsWith('#^') !== true) return null;
  const meeting = meetingOf(link.target);
  if (meeting === null) return null;
  const turns = meetingTurnsOf(meeting.text);
  const turn = turns.find((each) => each.blockId === link.heading!.slice(2));
  if (turn === undefined) return null;
  if (turn.speaker.kind === 'unknown') return 'unnamed-speaker';
  const directory = {
    attendees: meeting.attendees,
    people: owner.people,
    selfName: owner.selfName,
    selfEmails: owner.selfEmails,
    speakers: turns.map((each) => each.writtenSpeaker),
  };
  return itemOwner(turn.writtenSpeaker, directory).kind === 'self' ? null : 'spoken-by-another';
}
