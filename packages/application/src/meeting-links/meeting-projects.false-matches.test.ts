/**
 * #227, end to end on arrival: a meeting is never filed by a false twin or
 * another team's series. Found by the adversarial review of PR #228.
 * Fictional names only.
 */
import { describe, expect, it } from 'vitest';
import { MEETING_BODY } from '../testing/meeting-files.ts';
import {
  jsonLinesMarkdown,
  jsonLinesNote,
  proposalVault,
  vaultPath,
} from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { linkMeeting, type MeetingLinkPorts } from './link-meeting.ts';

const TODAY = '2026-10-15';
const OWNER = { selfName: 'Mara Quill', selfEmails: ['mara@larkspur.example'] };
const MARA = { name: 'Mara Quill', email: 'mara@larkspur.example' };
const TOBIAS = { name: 'Tobias Fenn', email: 'tobias@larkspur.example' };
const ADA = { name: 'Ada Venn', email: 'ada@larkspur.example' };
const IVO = { name: 'Ivo Brandt', email: 'ivo@larkspur.example' };
const ODETTE = { name: 'Odette Lune', email: 'odette@larkspur.example' };

const meeting = ({
  title,
  date,
  start = '09:30',
  provider = 'gemini',
  attendees,
  project,
}: {
  title: string;
  date: string;
  start?: string;
  provider?: string;
  attendees: readonly Record<string, unknown>[];
  project?: unknown;
}) =>
  jsonLinesNote(
    {
      type: 'meeting',
      atlas_import: 'meeting/v1',
      atlas_import_outcome: 'imported',
      title,
      date,
      start,
      provider,
      external_id: `${provider}-${date}-${start}-${title}`,
      attendees,
      ...(project !== undefined && { project }),
    },
    MEETING_BODY,
  );

const VAULT = {
  'People/Mara Quill.md': jsonLinesNote({ type: 'person', email: 'mara@larkspur.example' }),
  'People/Tobias Fenn.md': jsonLinesNote({ type: 'person', email: 'tobias@larkspur.example' }),
  'People/Ada Venn.md': jsonLinesNote({ type: 'person', email: 'ada@larkspur.example' }),
  'Projects/Ledger.md': jsonLinesNote({ type: 'project', status: 'active' }),
  'Projects/Payrun.md': jsonLinesNote({ type: 'project', status: 'active' }),
  '.atlas/types/meeting.md': jsonLinesNote({
    name: 'meeting',
    properties: {
      people: { kind: 'relation', target: 'person', many: true },
      companies: { kind: 'relation', target: 'company', many: true },
      project: { kind: 'relation', target: 'project' },
    },
  }),
};

function vault(files: Record<string, string>) {
  const all = { ...VAULT, ...files };
  const setup = proposalVault(all);
  const query = atlasQueryIndex({ files: all, markdown: jsonLinesMarkdown() });
  const ports: MeetingLinkPorts = { ...setup.ports, index: { ...setup.ports.index, query } };
  return { setup, ports };
}

describe('arrival files no meeting from a false twin or another team’s series', () => {
  it('does not file a 1:1 with Ada under Ledger because a 1:1 with Tobias, filed under Ledger, started 15 minutes earlier', async () => {
    const arriving = 'Inbox/Meetings/2026-10-14 1-1 Ada.md';
    const { setup, ports } = vault({
      'Meetings/2026-10-14 1-1 Tobias.md': meeting({
        title: '1:1',
        date: '2026-10-14',
        start: '10:00',
        attendees: [MARA, TOBIAS],
        project: '[[Ledger]]',
      }),
      [arriving]: meeting({
        title: '1:1',
        date: '2026-10-14',
        start: '10:15',
        provider: 'granola',
        attendees: [MARA, ADA],
      }),
    });
    const run = await linkMeeting({ ports, path: vaultPath(arriving), today: TODAY, ...OWNER });
    // Before the fix: '[[Ledger]]' written to the meeting, run.filed.via === 'twin', confidence high.
    expect(run.filed).toBeNull();
    expect(setup.propertiesOf(arriving)?.['project']).toBeUndefined();
  });

  it("does not file team B's Standup under team A's project because one colleague attends both", async () => {
    const teamA = Object.fromEntries(
      ['09', '10', '11', '12', '13'].map((day) => [
        `Meetings/2026-10-${day} Standup A.md`,
        meeting({
          title: 'Standup',
          date: `2026-10-${day}`,
          attendees: [MARA, TOBIAS, ADA, IVO],
          project: '[[Ledger]]',
        }),
      ]),
    );
    const arriving = 'Inbox/Meetings/2026-10-14 Standup B.md';
    const { setup, ports } = vault({
      ...teamA,
      'Meetings/2026-10-07 Standup B.md': meeting({
        title: 'Standup',
        date: '2026-10-07',
        start: '15:00',
        attendees: [MARA, IVO, ODETTE],
        project: '[[Payrun]]',
      }),
      [arriving]: meeting({
        title: 'Standup',
        date: '2026-10-14',
        start: '15:00',
        attendees: [MARA, IVO, ODETTE],
      }),
    });
    await linkMeeting({ ports, path: vaultPath(arriving), today: TODAY, ...OWNER });
    // Before the fix: '[[Ledger]]' — team A's project, at high, written without asking.
    expect(setup.propertiesOf(arriving)?.['project']).not.toBe('[[Ledger]]');
  });
});
