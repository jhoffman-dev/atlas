/**
 * Adversarial pass on #177 (PR #205). Uncommitted: failing tests that prove
 * defects, for bug-fixer. Over the in-memory proposal vault.
 */
import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  linkTargets,
  resolveWikiLinkTarget,
  type MeetingIdentity,
} from '@atlas/domain';
import { MEETING_BODY } from '../testing/meeting-files.ts';
import {
  jsonLinesNote,
  proposalVault,
  vaultPath,
  type ProposalVault,
} from '../testing/proposal-vault.ts';
import {
  makeTaskFromMeeting,
  undoMadeTask,
  type MeetingItemTask,
} from './make-task-from-meeting.ts';

const TODAY = '2026-10-06';
const MEETING = 'Projects/Ledger/2026-10-06 Standup.md';
const TASK = 'Tasks/2026/10/Send Mara the payroll file.md';
const IDENTITY: MeetingIdentity = { provider: 'gemini', externalId: 'gemini-7f3a9c21' };

const meetingNote = (more: Record<string, unknown> = {}) =>
  jsonLinesNote(
    {
      type: 'meeting',
      atlas_import: 'meeting/v1',
      atlas_import_outcome: 'imported',
      title: 'Standup',
      date: '2026-10-06',
      start: '09:30',
      provider: IDENTITY.provider,
      external_id: IDENTITY.externalId,
      attendees: [],
      ...more,
    },
    MEETING_BODY,
  );

const MEETING_TYPE_FILE = jsonLinesNote({
  name: 'meeting',
  properties: { tasks: { kind: 'relation', target: 'task', many: true } },
});

const vault = (files: Record<string, string> = {}): ProposalVault =>
  proposalVault({
    [MEETING]: meetingNote(),
    '.atlas/types/meeting.md': MEETING_TYPE_FILE,
    ...files,
  });

const item = (more: Partial<MeetingItemTask> = {}): MeetingItemTask => ({
  kind: 'task',
  title: 'Send Mara the payroll file',
  folder: null,
  properties: { status: 'inbox' },
  body: 'Mara asked for it by Friday.\n',
  source: '[[2026-10-06 Standup#^t0001]]',
  atlasItem: 'gemini:gemini-7f3a9c21:t0001:self',
  ...more,
});

const make = (setup: ProposalVault, task = item(), ports = setup.ports) =>
  makeTaskFromMeeting({
    ports,
    meeting: { path: vaultPath(MEETING), identity: IDENTITY },
    item: task,
    notePaths: setup.paths().map(vaultPath),
    today: TODAY,
  });

describe('adversarial #177 — the meeting’s `tasks` in odd shapes', () => {
  it.each([
    ['a map', { 'Book the room': '[[Book the room]]' }],
    ['a list holding a map', [{ link: '[[Book the room]]', note: 'carried over' }]],
    ['a nested list', [['[[Book the room]]', '[[Call Ines]]']]],
  ])('does not overwrite a `tasks` that is %s with String() of it', async (_shape, tasks) => {
    const setup = vault({ [MEETING]: meetingNote({ tasks }) });

    await make(setup).catch(() => undefined);

    // Either refused (meeting as it was) or joined keeping what was there; never "[object Object]".
    const after = JSON.stringify(setup.propertiesOf(MEETING)?.['tasks']);
    expect(after).not.toContain('[object Object]');
    expect(after).toContain('Book the room');
    if (setup.paths().includes(TASK)) {
      expect(after).toContain('Send Mara the payroll file');
    }
  });
});

describe('adversarial #177 — failures mid-write', () => {
  // Known defect, left for #208: still fails as written. `it.fails` turns red once it is fixed — then make it `it` again.
  it.fails(
    'a create the host carried out but reported as failed is not left as an orphan task',
    async () => {
      const setup = vault();
      const { fs } = setup.ports;
      const ports = {
        ...setup.ports,
        fs: {
          ...fs,
          createNote: async (args: Parameters<typeof fs.createNote>[0]) => {
            await fs.createNote(args);
            throw new Error('bridge timed out');
          },
        },
      };

      await expect(make(setup, item(), ports)).rejects.toThrow();

      // Refused saying nothing was written — so nothing may be there.
      expect(setup.paths()).not.toContain(TASK);
    },
  );

  it('undo whose trash fails after the meeting was put back leaves the pair linked, not half undone', async () => {
    const setup = vault();
    const made = await make(setup);
    const ports = {
      ...setup.ports,
      fs: {
        ...setup.ports.fs,
        trashEntry: async () => {
          throw new Error('Trash is not available');
        },
      },
    };

    await expect(undoMadeTask({ ports, made })).rejects.toThrow();

    // The task is still there, so the meeting must still list it.
    expect(setup.paths()).toContain(TASK);
    expect(setup.propertiesOf(MEETING)?.['tasks']).toEqual(['[[Send Mara the payroll file]]']);
  });
});

describe('adversarial #177 — titles the meeting’s link cannot reach', () => {
  it.each(['Fix bug #123', 'Re: [Q3] plan', 'Notes on [draft]'])(
    'the meeting’s `tasks` link for “%s” resolves to the task made',
    async (title) => {
      const setup = vault();
      const made = await make(setup, item({ title }));

      const paths = setup.paths().map(createVaultPath);
      const tasks = setup.propertiesOf(MEETING)?.['tasks'] as string[];
      const reached = tasks.map((link) => {
        const [target] = linkTargets(link);
        return target === undefined ? null : resolveWikiLinkTarget(target, paths);
      });
      expect(reached).toEqual([made.task]);
    },
  );
});
