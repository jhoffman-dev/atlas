import { describe, expect, it } from 'vitest';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import {
  matchAttendees,
  type DirectoryCompany,
  type DirectoryPerson,
} from './attendee-matching.ts';
import { planMeetingLinks, type MeetingLinkInput } from './meeting-link-plan.ts';

const p = (path: string) => createVaultPath(path);
const MEETING = p('Inbox/Meetings/2026-10-06 Standup.md');

const MARA: DirectoryPerson = {
  path: p('People/Mara Quill.md'),
  name: 'Mara Quill',
  emails: ['mara@larkspur.example'],
  aliases: [],
  company: null,
};

const LARKSPUR: DirectoryCompany = {
  path: p('Companies/Larkspur Payroll.md'),
  name: 'Larkspur Payroll',
  aliases: [],
  domains: [],
};

const attendee = (name: string, email: string | null = null): MeetingAttendee => ({
  name,
  email,
  group: false,
});

function plan(
  attendees: readonly MeetingAttendee[],
  properties: Record<string, unknown> = {},
  people: readonly DirectoryPerson[] = [MARA],
) {
  const input: MeetingLinkInput = {
    meeting: MEETING,
    properties: { title: 'Standup', ...properties },
    notePaths: [MEETING, MARA.path, LARKSPUR.path],
    matching: matchAttendees(attendees, people, [LARKSPUR]),
    speakers: [],
    projects: [],
    selfName: null,
  };
  return planMeetingLinks(input);
}

describe('meeting links, adversarially', () => {
  it('proposes one new person for an attendee listed both with and without their address', () => {
    // A calendar lists Ada with her address; the notetaker lists her again by name alone.
    const made = plan([attendee('Ada Venn', 'ada@larkspur.example'), attendee('Ada Venn')]);
    const people = made.proposals.filter((proposal) => proposal.kind === 'person');
    expect(people).toHaveLength(1);
  });

  it('matches a company whose site is written with a port', () => {
    const company = { ...LARKSPUR, domains: ['https://larkspur.example:8443/'] };
    const matching = matchAttendees([attendee('Ada Venn', 'ada@larkspur.example')], [], [company]);
    expect(matching.companies.map(({ company: found }) => found.path)).toEqual([company.path]);
  });

  it('reads an address the way a mail client copies it onto a person note', () => {
    const copied = { ...MARA, emails: ['Mara Quill <mara@larkspur.example>'] };
    const matching = matchAttendees([attendee('M. Quill', 'mara@larkspur.example')], [copied], []);
    expect(matching.linked.map(({ person }) => person.path)).toEqual([MARA.path]);
  });

  it('never writes a malformed people value back as text it did not hold', () => {
    // `people:` hand-edited into a map: linking must not turn it into "[object Object]".
    const made = plan([attendee('Mara Quill', 'mara@larkspur.example')], {
      people: { lead: '[[Tobias Fenn]]' },
    });
    expect(made.changes['people'] ?? []).not.toContain('[object Object]');
  });
});
