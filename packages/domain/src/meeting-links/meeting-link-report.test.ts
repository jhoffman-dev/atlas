import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { meetingLinkReport } from './meeting-link-report.ts';

const MEETING = createVaultPath('Inbox/Meetings/2026-10-06 Standup.md');

describe('meetingLinkReport', () => {
  it('names who it linked and how many it proposed, about the meeting', () => {
    expect(
      meetingLinkReport({
        meeting: MEETING,
        linked: [
          createVaultPath('People/Mara Quill.md'),
          createVaultPath('Companies/Larkspur Payroll.md'),
        ],
        proposed: 2,
        left: [],
      }),
    ).toEqual({
      level: 'info',
      kind: 'meeting',
      message: '2026-10-06 Standup: linked Mara Quill, Larkspur Payroll; proposed 2 in the Inbox.',
      subject: { kind: 'note', path: MEETING },
    });
  });

  it('warns of what it left, and says when it linked no one new', () => {
    const report = meetingLinkReport({
      meeting: MEETING,
      linked: [],
      proposed: 0,
      left: [{ path: MEETING, reason: 'It has unsaved typing.' }],
    });
    expect(report.level).toBe('warning');
    expect(report.message).toBe(
      '2026-10-06 Standup: linked no one new; left 2026-10-06 Standup: It has unsaved typing.',
    );
  });
});
