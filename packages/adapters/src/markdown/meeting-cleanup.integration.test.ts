/**
 * The offered cleanup (#226): the tasks the "After a meeting" rule made that
 * today's rules would not have, listed for the owner, and archived — never
 * deleted — only once they say so, less any they keep. Over a vault held in
 * memory whose index answers with real SQL, read and written through the
 * real YAML adapter. All names are made up.
 */
import { describe, expect, it } from 'vitest';
import {
  applyMeetingCleanup,
  meetingCleanupNeedsOwner,
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

describe('the cleanup preview (#226)', () => {
  it('lists the rule’s open tasks whose turn was not the owner’s, and why', async () => {
    const vault = setUp();

    expect(await previewMeetingCleanup({ ports: vault.ports, owner: OWNER })).toEqual([
      {
        path: UNNAMED,
        title: 'Book the room',
        because: 'unnamed-speaker',
        digest: expect.any(String),
      },
      {
        path: TOBIAS,
        title: 'Flag the new cache',
        because: 'spoken-by-another',
        digest: expect.any(String),
      },
    ]);
  });

  it('lists nothing while the vault does not say who its owner is: no task can be judged', async () => {
    const vault = setUp();

    const listed = await previewMeetingCleanup({
      ports: vault.ports,
      owner: { selfName: null, selfEmails: [] },
    });

    expect(listed).toEqual([]);
  });

  it('says it needs the owner only while the rule made tasks and the vault names nobody', async () => {
    const nobody = { selfName: null, selfEmails: [] };
    const empty = automationVault({
      notes: { [MEETING]: meetingFile },
      today: TODAY,
      markdown: remarkMarkdown,
    });

    expect(await meetingCleanupNeedsOwner({ ports: setUp().ports, owner: nobody })).toBe(true);
    expect(await meetingCleanupNeedsOwner({ ports: setUp().ports, owner: OWNER })).toBe(false);
    expect(await meetingCleanupNeedsOwner({ ports: empty.ports, owner: nobody })).toBe(false);
  });

  it('lists nothing in a vault where the rule made no task', async () => {
    const vault = automationVault({
      notes: {
        [MEETING]: meetingFile,
        [BY_HAND]: madeTask('t0002').replace(/atlas_item: .*\n/, ''),
      },
      today: TODAY,
      markdown: remarkMarkdown,
    });

    expect(await previewMeetingCleanup({ ports: vault.ports, owner: OWNER })).toEqual([]);
  });

  it('guesses nothing of a task whose source is not a link, or names no note there is', async () => {
    const vault = automationVault({
      notes: {
        [MEETING]: meetingFile,
        [TOBIAS]: madeTask('t0002').replace(/source: .*\n/, 'source: 7\n'),
        [UNNAMED]: madeTask('t0003').replace('2026-10-14 Renewal review#', 'A meeting long gone#'),
      },
      today: TODAY,
      markdown: remarkMarkdown,
    });

    expect(await previewMeetingCleanup({ ports: vault.ports, owner: OWNER })).toEqual([]);
  });

  it('reads only: nothing is written', async () => {
    const vault = setUp();
    const before = new Map(vault.files);

    await previewMeetingCleanup({ ports: vault.ports, owner: OWNER });

    expect(vault.files).toEqual(before);
  });
});

describe('applying the cleanup (#226)', () => {
  it('archives exactly the tasks listed, less those kept, and deletes nothing', async () => {
    const vault = setUp();
    const shown = await previewMeetingCleanup({ ports: vault.ports, owner: OWNER });

    const done = await applyMeetingCleanup({
      ports: vault.ports,
      owner: OWNER,
      shown,
      kept: [createVaultPath(UNNAMED)],
      today: TODAY,
    });

    expect(done.moves.map(({ move }) => move.from)).toEqual([TOBIAS]);
    expect(vault.files.has(TOBIAS)).toBe(false);
    const archived = [...vault.files.keys()].find((path) => path.endsWith('Flag the new cache.md'));
    expect(archived).toMatch(/^Archive\//);
    for (const stays of [MINE, UNNAMED, FINISHED, GONE_TURN, BY_HAND, MEETING]) {
      expect(vault.files.has(stays)).toBe(true);
    }
  });

  it('archives nothing the person did not see listed', async () => {
    const vault = setUp();

    const done = await applyMeetingCleanup({
      ports: vault.ports,
      owner: OWNER,
      shown: [],
      kept: [],
      today: TODAY,
    });

    expect(done.moves).toEqual([]);
    expect(vault.files.has(TOBIAS)).toBe(true);
  });

  it('leaves a task listed but finished since the preview where it is', async () => {
    const vault = setUp();
    const shown = await previewMeetingCleanup({ ports: vault.ports, owner: OWNER });
    vault.files.set(TOBIAS, madeTask('t0002', 'archive'));

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
