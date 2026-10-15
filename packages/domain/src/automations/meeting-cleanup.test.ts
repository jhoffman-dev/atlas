import { describe, expect, it } from 'vitest';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import type { OwnerSettings } from './meeting-item-apply.ts';
import {
  meetingTasksFailingRules,
  type CitedMeeting,
  type MadeMeetingTask,
} from './meeting-cleanup.ts';

/** #226: which tasks the rule made today's rules would not have, judged from the task and its meeting. */

const ATTENDEES: MeetingAttendee[] = [
  { name: 'Mara Quill', email: 'mara.quill@example.com', group: false },
  { name: 'Tobias Fenn', email: 'tobias.fenn@example.com', group: false },
];
const TEXT = [
  '## Transcript',
  '',
  '**Mara Quill** [10:00:01] I’ll send it. ^t0001',
  '',
  '**Tobias Fenn** [10:00:02] I’ll flag it. ^t0002',
  '',
  '**Unknown** [10:00:03] Someone book it. ^t0003',
  '',
].join('\n');
const REVIEW: CitedMeeting = { text: TEXT, attendees: ATTENDEES };
const OWNER: OwnerSettings = { selfName: 'Mara Quill', selfEmails: [], people: [] };

const task = (
  source: unknown,
  more: Record<string, unknown> = {},
  at = 'Tasks/A.md',
): MadeMeetingTask => ({
  path: createVaultPath(at),
  title: 'A',
  properties: { type: 'task', status: 'inbox', source, ...more },
});

const judge = (
  tasks: MadeMeetingTask[],
  owner = OWNER,
  meetingOf = (target: string) => (target === 'Renewal review' ? REVIEW : null),
) => meetingTasksFailingRules({ tasks, meetingOf, owner }).map(({ because }) => because);

describe('meetingTasksFailingRules', () => {
  it('keeps a task whose turn the owner spoke, by name', () => {
    expect(judge([task('[[Renewal review#^t0001]]')])).toEqual([]);
  });

  it('lists a task whose turn someone else spoke, or nobody named spoke', () => {
    expect(judge([task('[[Renewal review#^t0002]]'), task('[[Renewal review#^t0003]]')])).toEqual([
      'spoken-by-another',
      'unnamed-speaker',
    ]);
  });

  it('knows the owner by the address the meeting lists them at', () => {
    const owner = { selfName: null, selfEmails: ['MARA.QUILL@example.com'], people: [] };
    expect(judge([task('[[Renewal review#^t0001]]')], owner)).toEqual([]);
  });

  it('lists every open task while the vault does not say who its owner is', () => {
    const nobody = { selfName: null, selfEmails: [], people: [] };
    expect(judge([task('[[Renewal review#^t0001]]'), task('nothing')], nobody)).toEqual([
      'owner-unknown',
      'owner-unknown',
    ]);
  });

  it('leaves alone a task finished, or in the Archive', () => {
    expect(
      judge([
        task('[[Renewal review#^t0002]]', { status: 'archive' }),
        task('[[Renewal review#^t0002]]', {}, 'Archive/Tasks/A.md'),
      ]),
    ).toEqual([]);
  });

  it('guesses nothing when the task or its meeting no longer says whose it was', () => {
    expect(
      judge([
        task(undefined),
        task('Renewal review ^t0002'),
        task('[[Renewal review]]'),
        task('[[Gone meeting#^t0002]]'),
        task('[[Renewal review#^t0099]]'),
      ]),
    ).toEqual([]);
  });
});
