import { describe, expect, it } from 'vitest';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import type { MeetingIdentity } from '../meetings/meeting-holding.ts';
import type { DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { decideMeetingItems, type MeetingItemsRun } from './meeting-item-apply.ts';
import { itemOwner } from './meeting-item-owner.ts';
import type { AnsweredNote, AnswerVault, CheckedProposal } from './proposal-schema.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';

/**
 * Adversarial pass on #226 (PR #231): owner detection now takes every name,
 * alias and address of "the owner's own Person notes" — and a Person note is
 * the owner's when it merely shares one address with the owner's. These
 * tests show a colleague becoming the vault's owner, and their own
 * commitments becoming the owner's tasks without a click. All names are made up.
 */

const IDENTITY: MeetingIdentity = { provider: 'gemini', externalId: 'gemini-7a2b' };
const MEETING_PATH = createVaultPath('Inbox/Meetings/Renewal review.md');

const MARA: MeetingAttendee = { name: 'Mara Quill', email: 'mara.quill@example.com', group: false };
const TOBIAS: MeetingAttendee = {
  name: 'Tobias Fenn',
  email: 'tobias.fenn@example.com',
  group: false,
};
const MARA_LIND: MeetingAttendee = {
  name: 'Mara Lind',
  email: 'mara.lind@example.com',
  group: false,
};

const person = (name: string, more: Partial<DirectoryPerson> = {}): DirectoryPerson => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  emails: [],
  aliases: [],
  company: null,
  ...more,
});

function meetingText(turns: readonly (readonly [string, string, string])[]): string {
  return [
    '---',
    'type: meeting',
    'atlas_import: meeting/v1',
    'title: Renewal review',
    "date: '2026-10-12'",
    'provider: gemini',
    "external_id: 'gemini-7a2b'",
    '---',
    '',
    '## Transcript',
    '',
    ...turns.flatMap(([id, speaker, words], at) => [
      `**${speaker}** [10:00:${String(at).padStart(2, '0')}] ${words} ^${id}`,
      '',
    ]),
  ].join('\n');
}

const meeting = (text: string, attendees: readonly MeetingAttendee[]): AnsweredNote => ({
  path: MEETING_PATH,
  text,
  meeting: { identity: IDENTITY, date: '2026-10-12', attendees },
});

const RUN: MeetingItemsRun = {
  today: '2026-10-14',
  backfilled: false,
  madeItems: [],
  linkedTasks: [],
};

const schema = proposalSchemaNamed('meeting-items')!;

function decide(items: readonly Record<string, unknown>[], note: AnsweredNote, vault: AnswerVault) {
  const reading = schema.read(JSON.stringify({ items }), { notes: [note], vault });
  if (!reading.ok) throw new Error(reading.problem);
  const proposals: readonly CheckedProposal[] = reading.value;
  expect(proposals).toHaveLength(items.length);
  return decideMeetingItems({ proposals, vault, run: RUN }).items.map(({ decision }) => decision);
}

describe('a Person note that shares one address with the owner’s is read as the owner’s (#226)', () => {
  // A shared inbox both of them list on their Person notes.
  const SHARED = 'renewals@example.com';
  const OWNER_NOTE = person('Mara Quill', { emails: ['mara.quill@example.com', SHARED] });
  const TOBIAS_NOTE = person('Tobias Fenn', { emails: ['tobias.fenn@example.com', SHARED] });
  const TURNS = [
    ['t0001', 'Mara Quill', 'Thanks for joining.'],
    ['t0002', 'Tobias Fenn', 'I’ll flag the new cache to the platform team by Friday.'],
  ] as const;
  const note = meeting(meetingText(TURNS), [MARA, TOBIAS]);

  // No selfEmails saved: the owner's Person-note addresses are used (ADR-0036 amendment, the new default).
  const VAULT: AnswerVault = {
    selfName: 'Mara Quill',
    selfEmails: [],
    people: [OWNER_NOTE, TOBIAS_NOTE],
    notePaths: [MEETING_PATH, OWNER_NOTE.path, TOBIAS_NOTE.path],
    terms: [],
  };

  it('reads Tobias Fenn as Tobias Fenn, not as the vault’s owner', () => {
    const owner = itemOwner('Tobias Fenn', {
      attendees: [MARA, TOBIAS],
      people: VAULT.people,
      selfName: VAULT.selfName,
      selfEmails: VAULT.selfEmails,
      speakers: TURNS.map(([, speaker]) => speaker),
    });

    expect(owner.kind).toBe('person');
  });

  it('never makes Tobias’s own commitment, spoken by Tobias, the owner’s task', () => {
    const [decision] = decide(
      [
        {
          kind: 'task',
          title: 'Flag the new cache',
          owner: 'Tobias Fenn',
          source_block: 't0002',
          confidence: 'high',
        },
      ],
      note,
      VAULT,
    );

    expect(decision).toEqual({ outcome: 'left-out', because: 'someone-elses' });
  });

  it('does the same when the shared address is one of the saved selfEmails', () => {
    const vault = { ...VAULT, selfEmails: ['mara.quill@example.com', SHARED] };
    const [decision] = decide(
      [
        {
          kind: 'task',
          title: 'Flag the new cache',
          owner: 'Tobias Fenn',
          source_block: 't0002',
          confidence: 'high',
        },
      ],
      note,
      vault,
    );

    expect(decision).toEqual({ outcome: 'left-out', because: 'someone-elses' });
  });
});

describe('an alias on the owner’s Person note that is a colleague’s first name (#226)', () => {
  // The owner's own note lists her first name as an alias, as people commonly do.
  const OWNER_NOTE = person('Mara Quill', {
    emails: ['mara.quill@example.com'],
    aliases: ['Mara'],
  });
  const VAULT: AnswerVault = {
    selfName: 'Mara Quill',
    selfEmails: ['mara.quill@example.com'],
    people: [OWNER_NOTE],
    notePaths: [MEETING_PATH, OWNER_NOTE.path],
    terms: [],
  };

  it('cannot tell which Mara a hint of “Mara” is when two Maras attend (as without the alias)', () => {
    const turns = [
      ['t0001', 'Mara Quill', 'Mara will send the figures on Friday.'],
      ['t0002', 'Mara Lind', 'Yes, I’ll send them Friday.'],
    ] as const;
    const note = meeting(meetingText(turns), [MARA, MARA_LIND, TOBIAS]);

    const [decision] = decide(
      [
        {
          kind: 'task',
          title: 'Send the figures',
          owner: 'Mara',
          source_block: 't0001',
          confidence: 'high',
        },
      ],
      note,
      VAULT,
    );

    // Without the alias this is { left-out, owner-undecided }; with it, a task is made for the owner.
    expect(decision).toEqual({ outcome: 'left-out', because: 'owner-undecided' });
  });

  it('does not read a colleague labelled by first name as the owner when the owner is labelled by full name', () => {
    // Meet/Zoom style: display names differ, so one speaker is a full name and one a first name.
    const turns = [
      ['t0001', 'Mara Quill', 'Let’s go through the renewal.'],
      ['t0002', 'Tobias Fenn', 'Mara, can you check the figures?'],
      ['t0003', 'Mara', 'Sure, I’ll check the figures by Friday.'],
    ] as const;
    const note = meeting(meetingText(turns), [MARA, MARA_LIND, TOBIAS]);

    const [decision] = decide(
      [
        {
          kind: 'task',
          title: 'Check the figures',
          owner: 'Mara',
          source_block: 't0003',
          confidence: 'high',
        },
      ],
      note,
      VAULT,
    );

    // Mara Lind's own commitment: it must not become the owner's task.
    expect(decision!.outcome).not.toBe('task');
  });

  it('does not count a colleague labelled by the alias as the owner taking part in a decision', () => {
    const turns = [
      ['t0001', 'Mara Quill', 'I have to drop off, carry on without me.'],
      ['t0002', 'Tobias Fenn', 'Mara, shall we split the tickets by region?'],
      ['t0003', 'Mara', 'Agreed, let’s split them by region.'],
    ] as const;
    // Mara Quill's goodbye is outside the exchange: shift it out of EXCHANGE_TURNS' reach.
    const padded = [
      turns[0],
      ...Array.from({ length: 7 }, (_, at) => [`t01${at}0`, 'Tobias Fenn', 'Next item.'] as const),
      turns[1],
      turns[2],
    ];
    const note = meeting(meetingText(padded), [MARA, MARA_LIND, TOBIAS]);

    const [decision] = decide(
      [
        {
          kind: 'decision',
          title: 'Split the tickets by region',
          owner: '',
          source_block: 't0003',
          confidence: 'high',
        },
      ],
      note,
      VAULT,
    );

    expect(decision).toEqual({ outcome: 'left-out', because: 'not-the-owners-decision' });
  });
});
