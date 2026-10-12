import { describe, expect, it } from 'vitest';
import type { VaultPath } from '@atlas/domain';
import { acceptProposalNote } from '../proposals/accept-proposal.ts';
import { listProposals } from '../proposals/list-proposals.ts';
import { setNoteProperties } from '../query/set-property.ts';
import { MEETING_BODY } from '../testing/meeting-files.ts';
import {
  jsonLinesMarkdown,
  jsonLinesNote,
  proposalVault,
  vaultPath,
  type ProposalVault,
} from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { linkMeeting, MeetingLinkRefusedError, type MeetingLinkPorts } from './link-meeting.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { LinkUndoRefusedError, undoMeetingLinks } from './undo-meeting-link.ts';

const TODAY = '2026-10-06';
const MEETING = 'Inbox/Meetings/2026-10-06 Standup.md';

const meeting = (
  attendees: readonly Record<string, unknown>[],
  more: Record<string, unknown> = {},
) =>
  jsonLinesNote(
    {
      type: 'meeting',
      atlas_import: 'meeting/v1',
      atlas_import_outcome: 'imported',
      title: 'Standup',
      date: '2026-10-06',
      start: '09:30',
      provider: 'gemini',
      external_id: 'gemini-7f3a9c21',
      attendees,
      ...more,
    },
    MEETING_BODY,
  );

const PEOPLE = {
  'People/Mara Quill.md': jsonLinesNote({
    type: 'person',
    email: 'mara@larkspur.example',
    company: '[[Larkspur Payroll]]',
  }),
  'People/Tobias Fenn.md': jsonLinesNote({ type: 'person', aliases: ['Toby'] }),
  'People/Tobias Lin.md': jsonLinesNote({ type: 'person', aliases: ['Toby'] }),
  'Companies/Larkspur Payroll.md': jsonLinesNote({
    type: 'company',
    domains: ['larkspur.example'],
  }),
  'Projects/Ledger migration.md': jsonLinesNote({
    type: 'project',
    status: 'active',
    owner: '[[Mara Quill]]',
  }),
  '.atlas/types/meeting.md': jsonLinesNote({
    name: 'meeting',
    properties: {
      people: { kind: 'relation', target: 'person', many: true },
      companies: { kind: 'relation', target: 'company', many: true },
      project: { kind: 'relation', target: 'project' },
    },
  }),
};

const MARA = { name: 'Mara Quill', email: 'mara@larkspur.example' };
const ADA = { name: 'Ada Venn', email: 'ada@larkspur.example' };

/** A vault whose index holds these notes as the files are now: it lags whatever is written after. */
function vault(files: Record<string, string>): { setup: ProposalVault; ports: MeetingLinkPorts } {
  const setup = proposalVault({ ...PEOPLE, ...files });
  const query = atlasQueryIndex({ files: { ...PEOPLE, ...files }, markdown: jsonLinesMarkdown() });
  return { setup, ports: { ...setup.ports, index: { ...setup.ports.index, query } } };
}

const link = (ports: MeetingLinkPorts, selfName: string | null = null) =>
  linkMeeting({ ports, path: vaultPath(MEETING), today: TODAY, selfName });

/** The meeting's file as it is now. */
const textOf = (setup: ProposalVault) => setup.fixture.files.get(MEETING)?.text;

const proposalsIn = (setup: ProposalVault) =>
  setup.paths().filter((path) => path.startsWith('Inbox/Proposals/'));

describe('linkMeeting', () => {
  it('links an attendee whose email matches a person, and their company, without a proposal', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA]) });
    const run = await link(ports);
    expect(setup.propertiesOf(MEETING)).toMatchObject({
      people: ['[[Mara Quill]]', '[[Tobias Fenn]]'],
      companies: ['[[Larkspur Payroll]]'],
    });
    expect(run.linked).toEqual([
      'People/Mara Quill.md',
      'People/Tobias Fenn.md',
      'Companies/Larkspur Payroll.md',
    ]);
    expect(run.done).toEqual([
      {
        kind: 'set',
        path: MEETING,
        key: 'people',
        before: { absent: true },
        after: { value: ['[[Mara Quill]]', '[[Tobias Fenn]]'] },
      },
      {
        kind: 'set',
        path: MEETING,
        key: 'companies',
        before: { absent: true },
        after: { value: ['[[Larkspur Payroll]]'] },
      },
    ]);
    expect(proposalsIn(setup).filter((path) => !path.includes('Ledger'))).toEqual([]);
  });

  it('links the transcript’s named speakers who are surely people', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([]) });
    await link(ports);
    // The transcript's speakers are Mara Quill and Tobias Fenn (MEETING_BODY).
    expect(setup.propertiesOf(MEETING)?.['people']).toEqual(['[[Mara Quill]]', '[[Tobias Fenn]]']);
  });

  it('proposes an unknown attendee as a person; accepting makes them and links the meeting', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA, ADA]) });
    const run = await link(ports);
    const open = (await listProposals(setup.ports)).open.map(({ proposal }) => proposal);
    const person = open.find((proposal) => proposal.kind === 'person');
    expect(person?.payload).toMatchObject({
      title: 'Ada Venn',
      properties: { email: 'ada@larkspur.example', company: '[[Larkspur Payroll]]' },
      linkFrom: { note: MEETING, property: 'people' },
    });
    expect(run.proposed).toContain(person?.path);

    await acceptProposalNote({ ports: setup.ports, path: person!.path, today: TODAY });

    expect(setup.propertiesOf('People/Ada Venn.md')).toEqual({
      type: 'person',
      email: 'ada@larkspur.example',
      company: '[[Larkspur Payroll]]',
    });
    expect(setup.propertiesOf(MEETING)?.['people']).toEqual([
      '[[Mara Quill]]',
      '[[Tobias Fenn]]',
      '[[Ada Venn]]',
    ]);
  });

  it('refuses to accept a person while their meeting has unsaved typing, making no one', async () => {
    const { setup, ports } = vault({
      [MEETING]: meeting([ADA], { project: '[[Ledger migration]]' }),
    });
    const [person] = (await link(ports)).proposed;
    setup.dirty.add(MEETING);
    await expect(
      acceptProposalNote({ ports: setup.ports, path: person!, today: TODAY }),
    ).rejects.toThrow(/unsaved typing/);
    expect(setup.paths()).not.toContain('People/Ada Venn.md');
  });

  it('proposes each person an alias could be, linking neither, and never a group', async () => {
    const team = { name: 'Payroll team', email: 'team@larkspur.example', group: true };
    // No transcript: its speakers would link Tobias Fenn, which answers the ambiguity.
    const untranscribed = meeting([{ name: 'Toby' }, team]).replace(/## Transcript[\s\S]*$/, '');
    const { setup, ports } = vault({ [MEETING]: untranscribed });
    await link(ports);
    const open = (await listProposals(setup.ports)).open.map(({ proposal }) => proposal);
    const proposed = open.map(({ kind, payload }) => [
      kind,
      'link' in payload ? payload.link : payload.title,
    ]);
    expect(proposed.sort()).toEqual([
      ['link', '[[Tobias Fenn]]'],
      ['link', '[[Tobias Lin]]'],
    ]);
    expect(setup.propertiesOf(MEETING)?.['people']).toBeUndefined();
    expect(setup.propertiesOf(MEETING)?.['companies']).toEqual(['[[Larkspur Payroll]]']);
  });

  it('proposes the open project its people are tied to, once, for a meeting with none', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA]) });
    await link(ports);
    const open = (await listProposals(setup.ports)).open.map(({ proposal }) => proposal);
    expect(open.map(({ kind, confidence, payload }) => [kind, confidence, payload])).toEqual([
      [
        'link',
        'medium',
        {
          note: MEETING,
          property: 'project',
          link: '[[Ledger migration]]',
          digest: null,
          meeting: { provider: 'gemini', externalId: 'gemini-7f3a9c21' },
        },
      ],
    ]);
  });

  it('proposes nothing twice, however often it runs — the index lagging its own writes', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA, ADA]) });
    await link(ports);
    const first = proposalsIn(setup);
    const again = await link(ports);
    expect(again.proposed).toEqual([]);
    expect(again.done).toEqual([]);
    expect(proposalsIn(setup)).toEqual(first);
  });

  it('does not propose again what was answered and archived — for another meeting too', async () => {
    const answered = jsonLinesNote({
      type: 'proposal',
      kind: 'person',
      state: 'rejected',
      // Rejected from some earlier meeting: it is the person who was answered, not that meeting's card.
      proposal_id: 'meeting links:person:email:ada@larkspur.example',
      payload: { title: 'Ada Venn' },
    });
    const { setup, ports } = vault({
      [MEETING]: meeting([ADA], { project: '[[Ledger migration]]' }),
      'Archive/Inbox/Proposals/Ada Venn — Standup.md': answered,
    });
    const run = await link(ports);
    expect(run.proposed).toEqual([]);
    expect(proposalsIn(setup)).toEqual([]);
  });

  it('never proposes the vault’s owner', async () => {
    const { setup, ports } = vault({
      [MEETING]: meeting([{ name: 'James Hoffman', email: 'james@home.example' }], {
        project: '[[Ledger migration]]',
      }),
    });
    await link(ports, 'James Hoffman');
    expect(proposalsIn(setup)).toEqual([]);
  });

  it.each(['Hoffman, James', '  james   hoffman '])(
    'never proposes the vault’s owner however the attendee list spells them (%j)',
    async (spelling) => {
      const { setup, ports } = vault({
        [MEETING]: meeting([{ name: spelling, email: 'jh@elsewhere.example' }], {
          project: '[[Ledger migration]]',
        }),
      });
      await link(ports, 'James Hoffman');
      expect(proposalsIn(setup)).toEqual([]);
    },
  );

  it('leaves a meeting with unsaved typing as it is, and says so', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA]) });
    setup.dirty.add(MEETING);
    const run = await link(ports);
    expect(run.done).toEqual([]);
    expect(run.linked).toEqual([]);
    expect(run.left).toEqual([
      { path: MEETING, reason: expect.stringMatching(/unsaved typing/) as string },
    ]);
    expect(setup.propertiesOf(MEETING)?.['people']).toBeUndefined();
  });

  it('leaves a relation holding something other than links, and says so', async () => {
    const { setup, ports } = vault({
      [MEETING]: meeting([MARA], {
        people: { lead: '[[Tobias Fenn]]' },
        project: '[[Ledger migration]]',
      }),
    });
    const run = await link(ports);
    expect(setup.propertiesOf(MEETING)?.['people']).toEqual({ lead: '[[Tobias Fenn]]' });
    expect(setup.propertiesOf(MEETING)?.['companies']).toEqual(['[[Larkspur Payroll]]']);
    expect(run.left).toEqual([
      {
        path: MEETING,
        reason: 'Its people holds something other than links, so it was left as it is.',
      },
    ]);
  });

  it('passes on a fault reading the meeting, rather than calling it missing', async () => {
    const { ports } = vault({ [MEETING]: meeting([]) });
    const failing = {
      ...ports,
      fs: { ...ports.fs, readTextFile: async () => Promise.reject(new Error('disk on fire')) },
    };
    await expect(link(failing)).rejects.toThrow('disk on fire');
  });

  it('refuses what is not a meeting, or not there', async () => {
    const { ports } = vault({ [MEETING]: jsonLinesNote({ type: 'task' }) });
    await expect(link(ports)).rejects.toThrow(MeetingLinkRefusedError);
    const { ports: empty } = vault({});
    await expect(link(empty)).rejects.toThrow(/no meeting at/);
  });
});

describe('the record linking leaves on the meeting (P29-06)', () => {
  it('records the links it added and the proposals it wrote, in the write that adds the links', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA, ADA]) });
    const writes: string[] = [];
    const write = ports.fs.writeTextFile;
    const counting = {
      ...ports,
      fs: {
        ...ports.fs,
        writeTextFile: (args: Parameters<typeof write>[0]) => {
          if (args.path === MEETING) writes.push(args.contents);
          return write(args);
        },
      },
    };

    const run = await link(counting);

    expect(writes).toHaveLength(1);
    expect(run.recorded).toBe(true);
    expect(setup.propertiesOf(MEETING)).toMatchObject({
      atlas_links: [
        { key: 'people', added: ['[[Mara Quill]]', '[[Tobias Fenn]]'] },
        { key: 'companies', added: ['[[Larkspur Payroll]]'] },
      ],
      atlas_link_proposals: run.proposed,
    });
    expect(run.proposed.length).toBeGreaterThan(0);
  });

  it('records only the links that were not there before', async () => {
    const { setup, ports } = vault({
      [MEETING]: meeting([MARA], { people: ['[[Tobias Fenn]]'] }),
    });
    await link(ports);
    expect(setup.propertiesOf(MEETING)?.['atlas_links']).toEqual([
      { key: 'people', added: ['[[Mara Quill]]'] },
      { key: 'companies', added: ['[[Larkspur Payroll]]'] },
    ]);
  });

  it('marks a meeting nobody was linked to, so it is not read again', async () => {
    const { setup, ports } = vault({
      [MEETING]: meeting([], { people: ['[[Mara Quill]]', '[[Tobias Fenn]]'], project: '[[X]]' }),
    });
    const run = await link(ports);
    expect(run.linked).toEqual([]);
    expect(setup.propertiesOf(MEETING)?.['atlas_links']).toBe('none');
    expect(setup.propertiesOf(MEETING)?.['atlas_link_proposals']).toBeUndefined();
  });

  it('links a meeting once: a second run answers "already" and writes nothing', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA, ADA]) });
    await link(ports);
    // The person takes Tobias out: linking must not put him back.
    const people = (setup.propertiesOf(MEETING)?.['people'] as string[]).filter(
      (each) => each !== '[[Tobias Fenn]]',
    );
    await setNoteProperties({ ...setup.ports, path: MEETING, today: TODAY, values: { people } });
    const before = textOf(setup);
    const proposals = proposalsIn(setup);

    const again = await link(ports);

    expect(again.already).toEqual({ undone: false });
    expect(again.linked).toEqual([]);
    expect(again.proposed).toEqual([]);
    expect(textOf(setup)).toBe(before);
    expect(proposalsIn(setup)).toEqual(proposals);
  });

  it('leaves a meeting being typed in without a record, so the next run links it', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA]) });
    setup.dirty.add(vaultPath(MEETING));
    const first = await link(ports);
    expect(first.recorded).toBe(false);
    expect(setup.propertiesOf(MEETING)?.['atlas_links']).toBeUndefined();

    setup.dirty.delete(vaultPath(MEETING));
    const second = await link(ports);
    expect(second.already).toBeUndefined();
    expect(second.recorded).toBe(true);
    expect(setup.propertiesOf(MEETING)?.['people']).toEqual(['[[Mara Quill]]', '[[Tobias Fenn]]']);
  });

  it('hands the record back instead of writing it, when asked to and nothing was linked', async () => {
    const { setup, ports } = vault({
      [MEETING]: meeting([{ name: 'Odile' }], { people: ['[[Mara Quill]]', '[[Tobias Fenn]]'] }),
    });
    const before = textOf(setup);

    const run = await linkMeeting({
      ports,
      path: vaultPath(MEETING),
      today: TODAY,
      recordInStamp: true,
    });

    expect(textOf(setup)).toBe(before);
    expect(run.recorded).toBe(false);
    expect(run.stamp).toEqual({ atlas_links: 'none', atlas_link_proposals: run.proposed });
    expect(run.proposed.length).toBeGreaterThan(0);
  });

  it('writes the record with the links even when asked to hand it back, when it linked someone', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA]) });
    const run = await linkMeeting({
      ports,
      path: vaultPath(MEETING),
      today: TODAY,
      recordInStamp: true,
    });
    expect(run.stamp).toBeUndefined();
    expect(run.recorded).toBe(true);
    expect(setup.propertiesOf(MEETING)?.['atlas_links']).toEqual([
      { key: 'people', added: ['[[Mara Quill]]', '[[Tobias Fenn]]'] },
      { key: 'companies', added: ['[[Larkspur Payroll]]'] },
    ]);
  });
});

describe('undoMeetingLinks', () => {
  const undo = (ports: MeetingLinkPorts) =>
    undoMeetingLinks({ ports, path: vaultPath(MEETING), today: TODAY });

  it('takes the links it added back out and its open proposals away, from the record alone', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA, ADA]) });
    const run = await link(ports);

    const undone = await undo(ports);

    expect(setup.propertiesOf(MEETING)?.['people']).toBeUndefined();
    expect(setup.propertiesOf(MEETING)?.['companies']).toBeUndefined();
    expect(setup.propertiesOf(MEETING)?.['atlas_links']).toBe('undone');
    expect(setup.propertiesOf(MEETING)?.['atlas_link_proposals']).toBeUndefined();
    expect(proposalsIn(setup)).toEqual([]);
    expect(undone).toEqual({ removed: 3, withdrawn: run.proposed, left: [] });
  });

  it('keeps a link the person had, one added since, and one an accepted proposal added', async () => {
    const { setup, ports } = vault({
      [MEETING]: meeting([MARA, ADA], { people: ['[[Tobias Fenn]]'] }),
    });
    const run = await link(ports);
    const person = run.proposed.find((path) => path.includes('Ada Venn')) as VaultPath;
    await acceptProposalNote({ ports: setup.ports, path: person, today: TODAY });

    const undone = await undo(ports);

    // Tobias was there before; Ada came by an accepted proposal: only Mara, whom linking added, goes.
    expect(setup.propertiesOf(MEETING)?.['people']).toEqual(['[[Tobias Fenn]]', '[[Ada Venn]]']);
    expect(setup.propertiesOf(MEETING)?.['companies']).toBeUndefined();
    expect(undone.removed).toBe(2);
    expect(undone.withdrawn).not.toContain(person);
  });

  it('leaves a proposal with unsaved typing and says why; one gone since is nothing to say', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA, ADA, { name: 'Odile' }]) });
    const run = await link(ports);
    const [typing, gone] = run.proposed.filter((path) => !path.includes('Ledger'));
    setup.dirty.add(typing!);
    await ports.fs.trashEntry({ path: gone! });

    const undone = await undo(ports);

    expect(undone.left).toEqual([
      { path: typing, reason: 'It has unsaved typing, so it was left as it is.' },
    ]);
    expect(undone.withdrawn).not.toContain(gone);
    expect(setup.paths()).toContain(typing);
  });

  it('is refused for a meeting with nothing recorded, one undone already, and a note that is no meeting', async () => {
    const { ports } = vault({ [MEETING]: meeting([]) });
    await expect(undo(ports)).rejects.toThrow('This meeting has no links to undo.');

    const linked = vault({ [MEETING]: meeting([MARA]) });
    await link(linked.ports);
    await undo(linked.ports);
    const after = textOf(linked.setup);
    await expect(undo(linked.ports)).rejects.toThrow(LinkUndoRefusedError);
    expect(textOf(linked.setup)).toBe(after);

    const task = vault({ [MEETING]: jsonLinesNote({ type: 'task', atlas_links: 'none' }) });
    await expect(undo(task.ports)).rejects.toThrow(/is not a meeting/);
  });

  it('writes nothing while the meeting is being typed in', async () => {
    const { setup, ports } = vault({ [MEETING]: meeting([MARA, ADA]) });
    await link(ports);
    const before = textOf(setup);
    const proposals = proposalsIn(setup);
    setup.dirty.add(vaultPath(MEETING));

    await expect(undo(ports)).rejects.toThrow(UnsavedTypingError);

    expect(textOf(setup)).toBe(before);
    expect(proposalsIn(setup)).toEqual(proposals);
  });

  it('believes only what linking writes: a record naming another key or another folder takes nothing', async () => {
    const forged = meeting([], {
      title: 'Kept',
      people: ['[[Mara Quill]]'],
      atlas_links: [
        { key: 'title', added: ['Kept'] },
        { key: 'people', added: ['[[Mara Quill]]'] },
      ],
      atlas_link_proposals: ['People/Mara Quill.md'],
    });
    const { setup, ports } = vault({ [MEETING]: forged });

    const undone = await undo(ports);

    expect(setup.propertiesOf(MEETING)?.['title']).toBe('Kept');
    expect(setup.paths()).toContain('People/Mara Quill.md');
    expect(undone).toEqual({ removed: 1, withdrawn: [], left: [] });
  });
});
