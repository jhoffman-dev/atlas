import { describe, expect, it } from 'vitest';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import type { TranscriptTurn } from '../meetings/transcript.ts';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import {
  matchAttendees,
  type DirectoryCompany,
  type DirectoryPerson,
} from './attendee-matching.ts';
import {
  attendeesOf,
  linkedEntities,
  namedSpeakers,
  planMeetingLinks,
  type MeetingLinkInput,
} from './meeting-link-plan.ts';
import type { RankedProject } from './project-ranking.ts';

const MEETING = createVaultPath('Inbox/Meetings/2026-10-06 Standup.md');
const p = (path: string) => createVaultPath(path);

const MARA: DirectoryPerson = {
  path: p('People/Mara Quill.md'),
  name: 'Mara Quill',
  emails: ['mara@larkspur.example'],
  aliases: [],
  company: null,
};
const TOBIAS: DirectoryPerson = {
  path: p('People/Tobias Fenn.md'),
  name: 'Tobias Fenn',
  emails: [],
  aliases: ['Toby'],
  company: null,
};
const TOBIAS_LIN: DirectoryPerson = {
  ...TOBIAS,
  path: p('People/Tobias Lin.md'),
  name: 'Tobias Lin',
};
const LARKSPUR: DirectoryCompany = {
  path: p('Companies/Larkspur Payroll.md'),
  name: 'Larkspur Payroll',
  aliases: [],
  domains: ['larkspur.example'],
};
const LEDGER: RankedProject = {
  project: p('Projects/Ledger migration.md'),
  title: 'Ledger migration',
  entities: [MARA.path, LARKSPUR.path],
};
const PAYRUN: RankedProject = {
  project: p('Projects/Payrun.md'),
  title: 'Payrun',
  entities: [MARA.path],
};

const NOTES = [
  MEETING,
  MARA.path,
  TOBIAS.path,
  TOBIAS_LIN.path,
  LARKSPUR.path,
  LEDGER.project,
  PAYRUN.project,
];

function plan({
  attendees,
  properties = {},
  speakers = [],
  projects = [],
  selfName = null,
}: {
  attendees: MeetingAttendee[];
  properties?: Record<string, unknown>;
  speakers?: DirectoryPerson[];
  projects?: RankedProject[];
  selfName?: string | null;
}) {
  const input: MeetingLinkInput = {
    meeting: MEETING,
    properties: { title: 'Standup', ...properties },
    notePaths: NOTES,
    matching: matchAttendees(attendees, [MARA, TOBIAS, TOBIAS_LIN], [LARKSPUR]),
    speakers,
    projects,
    selfName,
  };
  return planMeetingLinks(input);
}

const mara = { name: 'Mara Quill', email: 'mara@larkspur.example', group: false };

describe('planMeetingLinks', () => {
  it('adds sure people and companies to the meeting, and proposes nothing for them', () => {
    const planned = plan({ attendees: [mara] });
    expect(planned.changes).toEqual({
      people: ['[[Mara Quill]]'],
      companies: ['[[Larkspur Payroll]]'],
    });
    expect(planned.added).toEqual({ people: [MARA.path], companies: [LARKSPUR.path] });
    expect(planned.proposals).toEqual([]);
  });

  it('keeps what the meeting links, never adding a note it links already however it is spelt', () => {
    const planned = plan({
      attendees: [mara],
      speakers: [TOBIAS],
      properties: { people: '[[people/mara quill|Mara]]', companies: ['[[Larkspur Payroll]]'] },
    });
    expect(planned.changes).toEqual({ people: ['[[people/mara quill|Mara]]', '[[Tobias Fenn]]'] });
    expect(planned.added).toEqual({ people: [TOBIAS.path] });
  });

  it('writes nothing when everything is linked already', () => {
    const planned = plan({
      attendees: [mara],
      properties: { people: ['[[Mara Quill]]'], companies: ['[[Larkspur Payroll]]'] },
    });
    expect(planned.changes).toEqual({});
    expect(planned.added).toEqual({});
  });

  it('proposes an unknown attendee as a person — name, email, company — who joins the meeting', () => {
    const planned = plan({
      attendees: [{ name: 'Ada Venn', email: 'ada@larkspur.example', group: false }],
    });
    expect(planned.proposals).toEqual([
      {
        kind: 'person',
        confidence: 'high',
        source: '[[2026-10-06 Standup]]',
        madeBy: 'meeting links',
        id: `meeting links:${MEETING}:person:email:ada@larkspur.example`,
        name: 'Ada Venn — Standup',
        reason: expect.stringContaining(
          'Ada Venn (ada@larkspur.example), at Larkspur Payroll,',
        ) as string,
        payload: {
          title: 'Ada Venn',
          folder: 'People',
          properties: { email: 'ada@larkspur.example', company: '[[Larkspur Payroll]]' },
          body: '',
          linkFrom: { note: MEETING, property: 'people' },
        },
      },
    ]);
  });

  it('proposes an attendee with no address with less confidence, and no company', () => {
    const [proposal] = plan({
      attendees: [{ name: 'Odile', email: null, group: false }],
    }).proposals;
    expect(proposal?.confidence).toBe('medium');
    expect(proposal?.payload).toMatchObject({ properties: {} });
    expect(proposal?.id).toBe(`meeting links:${MEETING}:person:name:odile`);
  });

  it('never proposes a group address, nor the vault’s owner', () => {
    const planned = plan({
      attendees: [
        { name: 'Payroll team', email: 'team@larkspur.example', group: true },
        { name: 'james  HOFFMAN', email: 'me@home.example', group: false },
      ],
      selfName: 'James Hoffman',
    });
    expect(planned.proposals).toEqual([]);
    expect(planned.passedOver).toEqual([]);
  });

  it('passes over a name no link could hold, saying why', () => {
    const planned = plan({ attendees: [{ name: 'Ada #2 Venn', email: null, group: false }] });
    expect(planned.proposals).toEqual([]);
    expect(planned.passedOver).toEqual([
      { name: 'Ada #2 Venn', reason: expect.stringMatching(/cannot be linked/) as string },
    ]);
  });

  it('proposes each person an ambiguous attendee could be, never linking one', () => {
    const planned = plan({ attendees: [{ name: 'Toby', email: null, group: false }] });
    expect(planned.changes).toEqual({});
    expect(
      planned.proposals.map(({ kind, confidence, payload }) => [kind, confidence, payload]),
    ).toEqual([
      ['link', 'low', { note: MEETING, property: 'people', link: '[[Tobias Fenn]]', digest: null }],
      ['link', 'low', { note: MEETING, property: 'people', link: '[[Tobias Lin]]', digest: null }],
    ]);
    expect(planned.proposals[0]?.reason).toContain('could be [[Tobias Fenn]] or [[Tobias Lin]]');
  });

  it('proposes nothing for an ambiguous attendee once one of them is linked', () => {
    const planned = plan({
      attendees: [{ name: 'Toby', email: null, group: false }],
      speakers: [TOBIAS_LIN],
    });
    expect(planned.proposals).toEqual([]);
    expect(planned.changes).toEqual({ people: ['[[Tobias Lin]]'] });
  });

  it('proposes the likeliest open project, naming the others, for a meeting with none', () => {
    const [proposal] = plan({ attendees: [mara], projects: [LEDGER, PAYRUN] }).proposals;
    expect(proposal).toMatchObject({
      kind: 'link',
      confidence: 'high',
      id: `meeting links:${MEETING}:project`,
      payload: { note: MEETING, property: 'project', link: '[[Ledger migration]]', digest: null },
    });
    expect(proposal?.reason).toBe(
      'Ledger migration is open and tied to 2 of its people and companies. Also likely: [[Payrun]].',
    );
  });

  it('proposes no project for a meeting that has one, or when none is tied', () => {
    expect(
      plan({ attendees: [mara], projects: [LEDGER], properties: { project: '[[Payrun]]' } })
        .proposals,
    ).toEqual([]);
    expect(plan({ attendees: [mara], projects: [] }).proposals).toEqual([]);
  });
});

describe('linkedEntities', () => {
  it('is every sure person, speaker and company, each once', () => {
    const matching = matchAttendees([mara], [MARA], [LARKSPUR]);
    expect(linkedEntities(matching, [MARA, TOBIAS])).toEqual<VaultPath[]>([
      MARA.path,
      TOBIAS.path,
      LARKSPUR.path,
    ]);
  });
});

describe('attendeesOf', () => {
  it('reads the attendees leniently, skipping entries without a name', () => {
    expect(
      attendeesOf({
        attendees: [
          { name: ' Mara Quill ', email: ' mara@larkspur.example ' },
          { name: 'Team', email: 'team@larkspur.example', group: true },
          { name: 'Odile', email: '' },
          { email: 'nameless@x.example' },
          'Ada',
          null,
        ],
      }),
    ).toEqual([
      { name: 'Mara Quill', email: 'mara@larkspur.example', group: false },
      { name: 'Team', email: 'team@larkspur.example', group: true },
      { name: 'Odile', email: null, group: false },
    ]);
    expect(attendeesOf({ attendees: 'Mara' })).toEqual([]);
  });
});

describe('namedSpeakers', () => {
  it('is each named speaker once, leaving out You and the unknown', () => {
    const turn = (speaker: TranscriptTurn['speaker']): TranscriptTurn => ({
      speaker,
      writtenSpeaker: '',
      time: { kind: 'none' },
      words: '',
      blockId: null,
      line: 1,
    });
    expect(
      namedSpeakers([
        turn({ kind: 'named', name: 'Mara Quill' }),
        turn({ kind: 'self', name: 'James Hoffman' }),
        turn({ kind: 'unknown' }),
        turn({ kind: 'named', name: 'Mara Quill' }),
        turn({ kind: 'named', name: 'Toby' }),
      ]),
    ).toEqual(['Mara Quill', 'Toby']);
  });
});
