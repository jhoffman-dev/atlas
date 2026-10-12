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
  p('Companies/Fenn.md'),
  p('People/James Hoffman.md'),
];

function plan({
  attendees,
  properties = {},
  speakers = [],
  projects = [],
  selfName = null,
  selfEmails = [],
  meeting = MEETING,
  directoryPeople = [MARA, TOBIAS, TOBIAS_LIN],
  directoryCompanies = [LARKSPUR],
}: {
  attendees: MeetingAttendee[];
  properties?: Record<string, unknown>;
  speakers?: DirectoryPerson[];
  projects?: RankedProject[];
  selfName?: string | null;
  selfEmails?: string[];
  meeting?: VaultPath;
  directoryPeople?: DirectoryPerson[];
  directoryCompanies?: DirectoryCompany[];
}) {
  const input: MeetingLinkInput = {
    meeting,
    properties: { title: 'Standup', ...properties },
    notePaths: NOTES,
    matching: matchAttendees(attendees, directoryPeople, directoryCompanies),
    speakers,
    projects,
    selfName,
    selfEmails,
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
        id: 'meeting links:person:email:ada@larkspur.example',
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
    expect(proposal?.id).toBe('meeting links:person:name:odile');
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

describe('planMeetingLinks: the vault’s owner', () => {
  const unknownAs = (name: string, email: string | null = null) => [{ name, email, group: false }];

  it.each([
    'James Hoffman',
    'james hoffman',
    '  James   HOFFMAN ',
    'Hoffman, James',
    'HOFFMAN,JAMES',
    'Hoffman , James',
  ])('never proposes the owner spelt %j', (spelling) => {
    expect(plan({ attendees: unknownAs(spelling), selfName: 'James Hoffman' }).proposals).toEqual(
      [],
    );
  });

  it('knows the owner from a profile written Last, First too', () => {
    expect(
      plan({ attendees: unknownAs('James Hoffman'), selfName: 'Hoffman, James' }).proposals,
    ).toEqual([]);
  });

  it('never proposes an attendee at one of the owner’s own addresses, whatever name they show', () => {
    const planned = plan({
      attendees: unknownAs('JH', 'Me@Home.example'),
      selfName: 'James Hoffman',
      selfEmails: ['me@home.example'],
    });
    expect(planned.proposals).toEqual([]);
    expect(planned.passedOver).toEqual([]);
  });

  it('still proposes someone else with the owner’s first name', () => {
    expect(
      plan({ attendees: unknownAs('James Okoro'), selfName: 'James Hoffman' }).proposals,
    ).toHaveLength(1);
  });

  it('never proposes the owner’s own note as who an attendee could be', () => {
    const owner: DirectoryPerson = {
      ...MARA,
      path: p('People/James Hoffman.md'),
      name: 'James Hoffman',
      emails: ['james@work.example'],
    };
    const planned = plan({
      attendees: unknownAs('James Hoffman', 'jh@elsewhere.example'),
      selfName: 'James Hoffman',
      directoryPeople: [owner],
    });
    expect(planned.proposals).toEqual([]);
  });
});

describe('planMeetingLinks: what a proposal remembers', () => {
  const IDENTITY = { provider: 'gemini', external_id: 'g-1' };
  const FILED = p('Meetings/2026-10-06 Standup.md');
  const ada = [{ name: 'Ada Venn', email: 'ada@larkspur.example', group: false }];

  it('knows a person by their address alone, so rejecting one covers every later meeting', () => {
    const first = plan({ attendees: ada, properties: IDENTITY }).proposals[0];
    const later = plan({
      attendees: ada,
      meeting: p('Inbox/Meetings/2026-10-13 Standup.md'),
      properties: { provider: 'gemini', external_id: 'g-2' },
    }).proposals[0];
    expect(first?.id).toBe('meeting links:person:email:ada@larkspur.example');
    expect(later?.id).toBe(first?.id);
  });

  it('knows the other proposals by the meeting’s identity, so filing it does not make them new', () => {
    const attendees = [
      { name: 'Toby', email: null, group: false },
      { name: 'Mara', email: 'mara@larkspur.example', group: false },
    ];
    const inbox = plan({ attendees, properties: IDENTITY, projects: [LEDGER] }).proposals;
    const filed = plan({
      attendees,
      meeting: FILED,
      properties: IDENTITY,
      projects: [LEDGER],
    }).proposals;
    expect(filed.map(({ id }) => id)).toEqual(inbox.map(({ id }) => id));
    expect(inbox.map(({ id }) => id)).toContain('meeting links:gemini/g-1:project');
  });

  it('records which meeting it is for in the payload, to find it once filed', () => {
    const [person] = plan({ attendees: ada, properties: IDENTITY }).proposals;
    expect(person?.payload).toMatchObject({
      linkFrom: {
        note: MEETING,
        property: 'people',
        meeting: { provider: 'gemini', externalId: 'g-1' },
      },
    });
    const [link] = plan({
      attendees: [{ name: 'Toby', email: null, group: false }],
      properties: IDENTITY,
    }).proposals;
    expect(link?.payload).toMatchObject({ meeting: { provider: 'gemini', externalId: 'g-1' } });
  });

  it('records no identity for a meeting that has none', () => {
    const [person] = plan({ attendees: ada }).proposals;
    expect(person?.payload).not.toHaveProperty('linkFrom.meeting');
  });
});

describe('planMeetingLinks: a company only guessed from a domain', () => {
  it('is proposed as a link, never written', () => {
    const fenn: DirectoryCompany = {
      path: p('Companies/Fenn.md'),
      name: 'Fenn',
      aliases: [],
      domains: [],
    };
    const planned = plan({
      attendees: [{ name: 'Bo', email: 'bo@fenn.example', group: false }],
      directoryCompanies: [fenn],
      directoryPeople: [],
    });
    expect(planned.changes).toEqual({});
    expect(planned.added).toEqual({});
    const link = planned.proposals.find(({ kind }) => kind === 'link');
    expect(link).toMatchObject({
      kind: 'link',
      confidence: 'low',
      payload: { note: MEETING, property: 'companies', link: '[[Fenn]]', digest: null },
    });
    expect(link?.reason).toContain('fenn.example');
  });
});

describe('planMeetingLinks: a name with another address', () => {
  it('is proposed as a link to the person, saying their address differs', () => {
    const planned = plan({
      attendees: [{ name: 'Mara Quill', email: 'mara.q@elsewhere.example', group: false }],
    });
    expect(planned.changes).toEqual({});
    expect(planned.proposals).toHaveLength(1);
    expect(planned.proposals[0]?.payload).toMatchObject({
      property: 'people',
      link: '[[Mara Quill]]',
    });
    expect(planned.proposals[0]?.reason).toContain('different address');
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
