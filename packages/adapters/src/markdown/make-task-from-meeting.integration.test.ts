/**
 * Making a task from a meeting's action item (#177) through the real YAML
 * reader and writer: a meeting's `tasks` written by hand as a map, or as a
 * list holding one, is never written back as words — the join is refused
 * and nothing is written. All names are made up.
 */
import { describe, expect, it } from 'vitest';
import { apiFixture, makeTaskFromMeeting } from '@atlas/application';
import { createVaultPath, type VaultPath } from '@atlas/domain';
import { remarkMarkdown } from './markdown-port.ts';

const MEETING = 'Projects/Ledger/2026-10-06 Standup.md';
const TASK = 'Send Mara the payroll file.md';

const MEETING_TYPE = [
  '---',
  'name: meeting',
  'properties:',
  '  tasks:',
  '    kind: relation',
  '    target: task',
  '    many: true',
  '---',
  '',
].join('\n');

const meetingWith = (tasks: string) =>
  [
    '---',
    'type: meeting',
    'atlas_import: meeting/v1',
    'atlas_import_outcome: imported',
    'title: Standup',
    "date: '2026-10-06'",
    "start: '09:30'",
    'provider: gemini',
    'external_id: gemini-7f3a9c21',
    tasks,
    '---',
    '',
    '**Mara Quill** [~00:00:00] Send me the payroll file. ^t0001',
    '',
  ].join('\n');

function vault(meeting: string) {
  const fixture = apiFixture({
    files: { [MEETING]: meeting, '.atlas/types/meeting.md': MEETING_TYPE },
    markdown: remarkMarkdown,
  });
  const fs = {
    ...fixture.fs,
    trashEntry: async ({ path }: { path: VaultPath }) => {
      fixture.files.delete(path);
    },
  };
  const ports = { fs, markdown: remarkMarkdown, editors: fixture.deps.movingNotes };
  const make = () =>
    makeTaskFromMeeting({
      ports,
      meeting: {
        path: createVaultPath(MEETING),
        identity: { provider: 'gemini', externalId: 'gemini-7f3a9c21' },
      },
      item: {
        kind: 'task',
        title: 'Send Mara the payroll file',
        folder: null,
        properties: { status: 'inbox' },
        body: '',
        source: '[[2026-10-06 Standup#^t0001]]',
        atlasItem: null,
      },
      notePaths: [...fixture.files.keys()].map(createVaultPath),
      today: '2026-10-06',
    });
  return { fixture, make };
}

describe('makeTaskFromMeeting through the real YAML adapter', () => {
  it('joins a `tasks` list of links, keeping what it held', async () => {
    const { fixture, make } = vault(meetingWith('tasks:\n  - "[[Book the room]]"'));

    await make();

    expect(fixture.files.get(MEETING)?.text).toContain(
      'tasks:\n  - "[[Book the room]]"\n  - "[[Send Mara the payroll file]]"\n',
    );
    expect(fixture.files.has(TASK)).toBe(true);
  });

  it.each([
    ['a map', 'tasks:\n  room: "[[Book the room]]"'],
    [
      'a list holding a map',
      'tasks:\n  - "[[Call Ines]]"\n  - link: "[[Book the room]]"\n    note: carried over',
    ],
  ])('refuses to join a `tasks` that is %s, writing nothing', async (_shape, tasks) => {
    const meeting = meetingWith(tasks);
    const { fixture, make } = vault(meeting);

    await expect(make()).rejects.toThrow(
      '2026-10-06 Standup’s tasks holds something other than links, which adding one would write over; nothing was written.',
    );

    expect(fixture.files.get(MEETING)?.text).toBe(meeting);
    expect(fixture.files.has(TASK)).toBe(false);
  });
});
