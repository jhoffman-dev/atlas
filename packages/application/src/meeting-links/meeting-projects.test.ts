import { describe, expect, it } from 'vitest';
import type { ProjectBackfillRow } from '@dfai/domain';
import { MEETING_BODY } from '../testing/meeting-files.ts';
import {
  jsonLinesMarkdown,
  jsonLinesNote,
  proposalVault,
  vaultPath,
  type ProposalVault,
} from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { linkMeeting, type MeetingLinkPorts } from './link-meeting.ts';
import {
  applyProjectBackfill,
  FILED_SINCE,
  previewProjectBackfill,
  undoProjectBackfill,
} from './meeting-project-backfill.ts';
import { undoMeetingLink } from './undo-meeting-link.ts';

/**
 * #227: a meeting gets its project from its series — the meetings of its
 * title with its people — or from its twin, the same meeting recorded by the
 * other notetaker: on arrival, and for the meetings already in the vault
 * through a backfill that is previewed, files only `project`, and is undone.
 */

const TODAY = '2026-10-15';
const OWNER = { selfName: 'Mara Quill', selfEmails: ['mara@larkspur.example'] };
const MARA = { name: 'Mara Quill', email: 'mara@larkspur.example' };
const TOBIAS = { name: 'Tobias Fenn', email: 'tobias@larkspur.example' };
const ADA = { name: 'Ada Venn', email: 'ada@larkspur.example' };

const meeting = ({
  title = 'Larkspur Standup',
  date,
  start = '09:30',
  provider = 'gemini',
  attendees = [MARA, TOBIAS],
  project,
}: {
  title?: string;
  date: string;
  start?: string;
  provider?: string;
  attendees?: readonly Record<string, unknown>[];
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
      external_id: `${provider}-${date}-${title}`,
      attendees,
      ...(project !== undefined && { project }),
    },
    MEETING_BODY,
  );

const VAULT = {
  'People/Mara Quill.md': jsonLinesNote({ type: 'person', email: 'mara@larkspur.example' }),
  'People/Tobias Fenn.md': jsonLinesNote({ type: 'person', email: 'tobias@larkspur.example' }),
  'Projects/Ledger.md': jsonLinesNote({ type: 'project', status: 'active' }),
  'Projects/Payrun.md': jsonLinesNote({ type: 'project' }),
  'Projects/Old payrun.md': jsonLinesNote({ type: 'project', para: 'archive' }),
  'Resources/Style guide.md': jsonLinesNote({ type: 'project', para: 'resource' }),
  'Areas/Operations.md': jsonLinesNote({ type: 'project', para: 'area' }),
  '.atlas/types/meeting.md': jsonLinesNote({
    name: 'meeting',
    properties: {
      people: { kind: 'relation', target: 'person', many: true },
      companies: { kind: 'relation', target: 'company', many: true },
      project: { kind: 'relation', target: 'project' },
    },
  }),
};

/** Three standups filed under Ledger, before the one in question. */
const LEDGER_SERIES = {
  'Meetings/2026-10-01 Larkspur Standup.md': meeting({ date: '2026-10-01', project: '[[Ledger]]' }),
  'Meetings/2026-10-02 Larkspur Standup.md': meeting({ date: '2026-10-02', project: '[[Ledger]]' }),
  'Meetings/2026-10-05 Larkspur Standup.md': meeting({ date: '2026-10-05', project: '[[Ledger]]' }),
};

/** A vault whose index holds these notes as the files are now: it lags whatever is written after. */
function vault(files: Record<string, string>): { setup: ProposalVault; ports: MeetingLinkPorts } {
  const all = { ...VAULT, ...files };
  const setup = proposalVault(all);
  const query = atlasQueryIndex({ files: all, markdown: jsonLinesMarkdown() });
  return { setup, ports: { ...setup.ports, index: { ...setup.ports.index, query } } };
}

const ARRIVING = 'Inbox/Meetings/2026-10-06 Larkspur Standup.md';

const arrive = (ports: MeetingLinkPorts) =>
  linkMeeting({ ports, path: vaultPath(ARRIVING), today: TODAY, ...OWNER });

const proposalsIn = (setup: ProposalVault) =>
  setup.paths().filter((path) => path.startsWith('Inbox/Proposals/'));

describe('a meeting arriving in a known series (#227)', () => {
  it('arrives filed under the project its series is, and says why', async () => {
    const { setup, ports } = vault({
      ...LEDGER_SERIES,
      [ARRIVING]: meeting({ date: '2026-10-06' }),
    });
    const run = await arrive(ports);
    expect(setup.propertiesOf(ARRIVING)?.['project']).toBe('[[Ledger]]');
    expect(run.filed).toMatchObject({
      project: 'Projects/Ledger.md',
      confidence: 'high',
      via: 'series',
    });
    expect(run.done).toContainEqual({
      kind: 'set',
      path: ARRIVING,
      key: 'project',
      before: { absent: true },
      after: { value: '[[Ledger]]' },
    });
    // Sure, so nothing about its project waits in the Inbox.
    expect(proposalsIn(setup)).toEqual([]);
  });

  it('arrives filed as its twin from the other notetaker is: same title and people', async () => {
    const { setup, ports } = vault({
      'Meetings/2026-10-06 Payroll sync.md': meeting({
        title: 'Payroll sync',
        date: '2026-10-06',
        start: '09:36',
        project: '[[Operations]]',
      }),
      [ARRIVING]: meeting({ title: 'Payroll sync', date: '2026-10-06', provider: 'granola' }),
    });
    const run = await arrive(ports);
    expect(setup.propertiesOf(ARRIVING)?.['project']).toBe('[[Operations]]');
    expect(run.filed?.via).toBe('twin');
  });

  it('only proposes what its series says when the owner cannot be told from the others', async () => {
    const { setup, ports } = vault({
      ...LEDGER_SERIES,
      [ARRIVING]: meeting({ date: '2026-10-06' }),
    });
    const run = await linkMeeting({
      ports,
      path: vaultPath(ARRIVING),
      today: TODAY,
      selfName: null,
      selfEmails: [],
    });
    expect(setup.propertiesOf(ARRIVING)?.['project']).toBeUndefined();
    expect(run.filed).toBeNull();
    expect(run.proposed).toHaveLength(1);
  });

  it('never writes over a project already set', async () => {
    const { setup, ports } = vault({
      ...LEDGER_SERIES,
      [ARRIVING]: meeting({ date: '2026-10-06', project: '[[Payrun]]' }),
    });
    const run = await arrive(ports);
    expect(setup.propertiesOf(ARRIVING)?.['project']).toBe('[[Payrun]]');
    expect(run.filed).toBeNull();
    expect(proposalsIn(setup)).toEqual([]);
  });

  it('proposes, rather than sets, what a series of one says', async () => {
    const { setup, ports } = vault({
      'Meetings/2026-10-01 Larkspur Standup.md': meeting({
        date: '2026-10-01',
        project: '[[Ledger]]',
      }),
      [ARRIVING]: meeting({ date: '2026-10-06' }),
    });
    const run = await arrive(ports);
    expect(setup.propertiesOf(ARRIVING)?.['project']).toBeUndefined();
    expect(run.filed).toBeNull();
    expect(run.proposed).toHaveLength(1);
  });

  it('is never filed under an archived project or a resource, however its series was filed', async () => {
    const { setup, ports } = vault({
      'Meetings/2026-10-01 Larkspur Standup.md': meeting({
        date: '2026-10-01',
        project: '[[Old payrun]]',
      }),
      'Meetings/2026-10-02 Larkspur Standup.md': meeting({
        date: '2026-10-02',
        project: '[[Old payrun]]',
      }),
      'Meetings/2026-10-05 Larkspur Standup.md': meeting({
        date: '2026-10-05',
        project: '[[Style guide]]',
      }),
      [ARRIVING]: meeting({ date: '2026-10-06' }),
    });
    const run = await arrive(ports);
    expect(setup.propertiesOf(ARRIVING)?.['project']).toBeUndefined();
    expect(run.filed).toBeNull();
  });

  it('is put back by undoing the meeting’s linking', async () => {
    const { setup, ports } = vault({
      ...LEDGER_SERIES,
      [ARRIVING]: meeting({ date: '2026-10-06' }),
    });
    const run = await arrive(ports);
    const undone = await undoMeetingLink({ ports, run, today: TODAY });
    expect(undone.restored.map((line) => ('key' in line ? line.key : null))).toContain('project');
    expect(setup.propertiesOf(ARRIVING)?.['project']).toBeUndefined();
  });
});

describe('the backfill (#227)', () => {
  const UNFILED = 'Meetings/2026-10-06 Larkspur Standup.md';
  const STRANGER = 'Meetings/2026-10-07 Coffee.md';
  const files = {
    ...LEDGER_SERIES,
    [UNFILED]: meeting({ date: '2026-10-06' }),
    [STRANGER]: meeting({ title: 'Coffee', date: '2026-10-07', attendees: [MARA, ADA] }),
    'Archive/Meetings/2026-01-01 Larkspur Standup.md': meeting({ date: '2026-01-01' }),
  };

  it('previews every meeting with no project: its suggestion and why, or none, newest first', async () => {
    const { ports } = vault(files);
    const rows = await previewProjectBackfill({ ports, owner: OWNER });
    expect(
      rows.map((row) => [
        row.meeting,
        row.suggestion?.title ?? null,
        row.suggestion?.confidence ?? null,
      ]),
    ).toEqual([
      [STRANGER, null, null],
      [UNFILED, 'Ledger', 'high'],
    ]);
    expect(rows[1]?.suggestion?.reason).toBe(
      'Same series as 2026-10-05 Larkspur Standup: 3 of its last 3 were filed under Ledger.',
    );
  });

  it('files only `project`, takes it back on undo, and files nothing twice', async () => {
    const { setup, ports } = vault(files);
    const before = setup.fixture.files.get(UNFILED)?.text ?? '';
    const rows = await previewProjectBackfill({ ports, owner: OWNER });
    const run = await applyProjectBackfill({ ports, rows, today: TODAY });

    expect(run.done).toEqual([
      {
        kind: 'set',
        path: UNFILED,
        key: 'project',
        before: { absent: true },
        after: { value: '[[Ledger]]' },
      },
    ]);
    expect(setup.propertiesOf(UNFILED)).toEqual({ ...propertiesIn(before), project: '[[Ledger]]' });
    expect(setup.propertiesOf(STRANGER)?.['project']).toBeUndefined();

    const again = await applyProjectBackfill({ ports, rows, today: TODAY });
    expect(again).toEqual({ done: [], left: [{ path: UNFILED, reason: FILED_SINCE }] });

    const undone = await undoProjectBackfill({ ports, run, today: TODAY });
    expect(undone.done).toHaveLength(1);
    expect(setup.fixture.files.get(UNFILED)?.text).toBe(before);
  });

  it('leaves a meeting someone filed since the preview as it is', async () => {
    const { setup, ports } = vault(files);
    const rows = await previewProjectBackfill({ ports, owner: OWNER });
    const read = setup.fixture.files.get(UNFILED)!;
    setup.fixture.files.set(UNFILED, {
      ...read,
      text: meeting({ date: '2026-10-06', project: '[[Payrun]]' }),
      modified: read.modified + 1000,
    });
    const run = await applyProjectBackfill({ ports, rows, today: TODAY });
    expect(run.done).toEqual([]);
    expect(setup.propertiesOf(UNFILED)?.['project']).toBe('[[Payrun]]');
  });

  it('files nothing for a row with no suggestion, whatever it is handed', async () => {
    const { ports } = vault(files);
    const empty: ProjectBackfillRow = {
      meeting: vaultPath(STRANGER),
      title: 'Coffee',
      date: '2026-10-07',
      suggestion: null,
    };
    expect(await applyProjectBackfill({ ports, rows: [empty], today: TODAY })).toEqual({
      done: [],
      left: [],
    });
  });

  it('undoes only `project`, whatever the run it is handed says', async () => {
    const { setup, ports } = vault(files);
    const forged = {
      done: [
        {
          kind: 'set' as const,
          path: vaultPath(STRANGER),
          key: 'title',
          before: { value: 'Something else' },
          after: { value: 'Coffee' },
        },
      ],
      left: [],
    };
    expect((await undoProjectBackfill({ ports, run: forged, today: TODAY })).done).toEqual([]);
    expect(setup.propertiesOf(STRANGER)?.['title']).toBe('Coffee');
  });
});

/** The properties a meeting's text holds, as the markdown port reads them. */
function propertiesIn(text: string): Record<string, unknown> {
  const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(text)?.[0] ?? null;
  return jsonLinesMarkdown().frontmatterProperties(frontmatter);
}
