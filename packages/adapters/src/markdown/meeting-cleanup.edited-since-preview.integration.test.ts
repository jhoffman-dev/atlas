/**
 * The offered cleanup (#226) once the person has acted on what it listed: a
 * task edited, finished or moved since the preview stays where it is, and a
 * task they chose to keep is never listed, nor ticked, again. Over a vault held in
 * memory whose index answers with real SQL, read and written through the
 * real YAML adapter. All names are made up.
 */
import { describe, expect, it } from 'vitest';
import {
  applyMeetingCleanup,
  keepMeetingCleanupTasks,
  previewMeetingCleanup,
} from '@dfai/application';
import { automationVault } from '@dfai/application/testing/sqlite';
import { createVaultPath } from '@dfai/domain';
import { remarkMarkdown } from './markdown-port.ts';

const TODAY = '2026-10-14';
const MEETING = 'Meetings/2026-10-14 Renewal review.md';
const OWNER = { selfName: 'Mara Quill', selfEmails: ['mara.quill@example.com'] };

const meetingFile = [
  '---',
  'type: meeting',
  'atlas_import: meeting/v1',
  'atlas_import_outcome: imported',
  'title: Renewal review',
  "date: '2026-10-14'",
  'provider: gemini',
  'external_id: gemini-5c1d',
  'attendees:',
  '  - name: Mara Quill',
  '    email: mara.quill@example.com',
  '  - name: Tobias Fenn',
  '    email: tobias.fenn@example.com',
  '---',
  '',
  '## Transcript',
  '',
  '**Mara Quill** [~00:00:10] I’ll send the renewal contract by Friday. ^t0001',
  '',
  '**Tobias Fenn** [~00:00:20] I’ll flag the new cache. ^t0002',
  '',
  '**Unknown** [~00:00:30] Someone should book the room. ^t0003',
  '',
].join('\n');

/** A task the rule made from a turn of the meeting. */
const madeTask = (block: string, status = 'inbox') =>
  [
    '---',
    'type: task',
    `status: ${status}`,
    "meeting: '[[2026-10-14 Renewal review]]'",
    `atlas_item: item-${block}`,
    `source: '[[2026-10-14 Renewal review#^${block}]]'`,
    '---',
    '',
  ].join('\n');

const MINE = 'Tasks/2026/10/Send the renewal contract.md';
const TOBIAS = 'Tasks/2026/10/Flag the new cache.md';
const UNNAMED = 'Tasks/2026/10/Book the room.md';
const FINISHED = 'Tasks/2026/10/Flag the old cache.md';
const GONE_TURN = 'Tasks/2026/10/Check the figures.md';
const BY_HAND = 'Tasks/2026/10/Call Tobias.md';

function setUp() {
  return automationVault({
    notes: {
      [MEETING]: meetingFile,
      [MINE]: madeTask('t0001'),
      [TOBIAS]: madeTask('t0002'),
      [UNNAMED]: madeTask('t0003'),
      [FINISHED]: madeTask('t0002', 'archive'),
      [GONE_TURN]: madeTask('t0009'),
      // A task the person made, citing a turn of someone else's: never the rule's to clean up.
      [BY_HAND]: [
        '---',
        'type: task',
        'status: inbox',
        "source: '[[2026-10-14 Renewal review#^t0002]]'",
        '---',
        '',
      ].join('\n'),
    },
    today: TODAY,
    markdown: remarkMarkdown,
  });
}

describe('applying the cleanup after the person changed a listed task (#226)', () => {
  it('leaves a listed task the person edited since the preview where it is, as applyMeetingCleanup promises', async () => {
    const vault = setUp();
    const shown = await previewMeetingCleanup({ ports: vault.ports, owner: OWNER });
    expect(shown.map(({ path }) => path)).toContain(TOBIAS);
    // Opened from the preview's own link, and worked on: moved to Next Action, with notes.
    vault.files.set(
      TOBIAS,
      madeTask('t0002', 'next-action') + 'Talked to Tobias: I am taking this one after all.\n',
    );

    await applyMeetingCleanup({ ports: vault.ports, owner: OWNER, shown, kept: [], today: TODAY });

    expect(vault.files.has(TOBIAS)).toBe(true);
    expect(vault.files.get(TOBIAS)).toContain('I am taking this one after all.');
  });
});

describe('a listed task with typing not yet saved (#226)', () => {
  it('stays where it is: the person is working on it', async () => {
    const vault = setUp();
    const shown = await previewMeetingCleanup({ ports: vault.ports, owner: OWNER });
    vault.unsaved.add(TOBIAS);

    const done = await applyMeetingCleanup({
      ports: vault.ports,
      owner: OWNER,
      shown,
      kept: [],
      today: TODAY,
    });

    expect(done.moves.map(({ move }) => move.from)).toEqual([UNNAMED]);
    expect(vault.files.has(TOBIAS)).toBe(true);
  });
});

describe('a task the person chose to keep (#226)', () => {
  const listedNow = async (vault: ReturnType<typeof setUp>) =>
    (await previewMeetingCleanup({ ports: vault.ports, owner: OWNER })).map(({ path }) => path);

  it('is never listed, nor ticked, again once the rest were archived', async () => {
    const vault = setUp();
    const shown = await previewMeetingCleanup({ ports: vault.ports, owner: OWNER });

    await applyMeetingCleanup({
      ports: vault.ports,
      owner: OWNER,
      shown,
      kept: [createVaultPath(UNNAMED)],
      today: TODAY,
    });

    expect(vault.files.has(UNNAMED)).toBe(true);
    expect(vault.properties(UNNAMED)['atlas_item_kept']).toBe(true);
    expect(await listedNow(vault)).toEqual([]);
  });

  it('is remembered when the person puts the offer away without archiving', async () => {
    const vault = setUp();
    expect(await listedNow(vault)).toEqual([UNNAMED, TOBIAS]);

    const failed = await keepMeetingCleanupTasks({
      ports: vault.ports,
      paths: [createVaultPath(TOBIAS)],
    });

    expect(failed).toEqual([]);
    expect(await listedNow(vault)).toEqual([UNNAMED]);
    // Only the mark is added: what the person wrote is kept.
    expect(vault.files.get(TOBIAS)).toContain('atlas_item: item-t0002');
  });

  it('says which could not be marked, and archives nothing for them', async () => {
    const vault = setUp();

    const failed = await keepMeetingCleanupTasks({
      ports: vault.ports,
      paths: [createVaultPath('Tasks/2026/10/Moved away.md')],
    });

    expect(failed).toEqual([
      {
        path: 'Tasks/2026/10/Moved away.md',
        reason: expect.stringContaining('could not be marked as kept'),
      },
    ]);
  });
});
