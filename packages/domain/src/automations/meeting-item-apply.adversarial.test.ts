import { describe, expect, it } from 'vitest';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import type { MeetingIdentity } from '../meetings/meeting-holding.ts';
import type { DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { atlasItemKey } from './claude-proposal-id.ts';
import { decideMeetingItems, type MeetingItemsRun } from './meeting-item-apply.ts';
import type {
  AnsweredNote,
  AnswerContext,
  AnswerVault,
  CheckedProposal,
} from './proposal-schema.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';

/**
 * Adversarial pass on #178 (decideMeetingItems). Each test is a defect: the
 * owner gets a task that is not theirs, or loses one that is.
 */

const IDENTITY: MeetingIdentity = { provider: 'granola', externalId: 'granola-7a2e' };
const MEETING_PATH = createVaultPath('Inbox/Meetings/Vendor sync.md');

const OWNER: MeetingAttendee = {
  name: 'Mara Quill',
  email: 'mara.quill@example.com',
  group: false,
};
const TOBIAS: MeetingAttendee = {
  name: 'Tobias Fenn',
  email: 'tobias.fenn@example.com',
  group: false,
};

function meetingWith(
  turns: readonly (readonly [string, string, string])[],
  attendees: readonly MeetingAttendee[],
): AnsweredNote {
  const text = [
    '---',
    'type: meeting',
    'atlas_import: meeting/v1',
    'title: Vendor sync',
    "date: '2026-10-12'",
    'provider: granola',
    "external_id: 'granola-7a2e'",
    '---',
    '',
    '## Transcript',
    '',
    ...turns.flatMap(([id, speaker, words]) => [
      `**${speaker}** [10:0${id.at(-1)}:00] ${words} ^${id}`,
      '',
    ]),
  ].join('\n');
  return {
    path: MEETING_PATH,
    text,
    meeting: { identity: IDENTITY, date: '2026-10-12', attendees },
  };
}

const person = (name: string, emails: string[] = [], aliases: string[] = []): DirectoryPerson => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  emails,
  aliases,
  company: null,
});

const VAULT: AnswerVault = {
  selfName: 'Mara Quill',
  selfEmails: ['mara.quill@example.com'],
  people: [person('Tobias Fenn', ['tobias.fenn@example.com'])],
  notePaths: [MEETING_PATH],
  terms: [],
};

const RUN: MeetingItemsRun = {
  today: '2026-10-14',
  backfilled: false,
  madeItems: [],
  linkedTasks: [],
};

const schema = proposalSchemaNamed('meeting-items')!;

function proposalsFor(
  items: readonly unknown[],
  context: AnswerContext,
): readonly CheckedProposal[] {
  const reading = schema.read(JSON.stringify({ items }), context);
  if (!reading.ok) throw new Error(reading.problem);
  expect(reading.dropped).toEqual([]);
  return reading.value;
}

function decide(
  items: readonly unknown[],
  note: AnsweredNote,
  vault: AnswerVault,
  run: Partial<MeetingItemsRun> = {},
) {
  const proposals = proposalsFor(items, { notes: [note], vault });
  return decideMeetingItems({ proposals, vault, run: { ...RUN, ...run } });
}

describe('a guest who shares the owner’s first name is not the owner', () => {
  // A Granola-style transcript: the owner is "You". A guest not on the invite
  // whose display name is just "Mara" speaks t0002. The prompt tells the model
  // to name anyone else as the transcript/attendee list does, so it writes "Mara".
  const TURNS = [
    ['t0001', 'You', 'Thanks for joining, everyone.'],
    ['t0002', 'Mara', 'I’ll send over the signed vendor contract by Friday.'],
    ['t0003', 'Tobias Fenn', 'Great, thanks Mara.'],
  ] as const;
  const note = meetingWith(TURNS, [OWNER, TOBIAS]);
  const guestsItem = {
    kind: 'task',
    title: 'Send the signed vendor contract',
    owner: 'Mara',
    source_block: 't0002',
    confidence: 'high',
  };

  it('does not make the guest’s commitment the owner’s task (the owner is "You" in this transcript)', () => {
    const decided = decide([guestsItem], note, VAULT);
    expect(decided.items[0]!.decision.outcome).not.toBe('task');
  });

  it('does not make it the owner’s task even when the vault has a Person note for the guest with the alias "Mara"', () => {
    const vault: AnswerVault = {
      ...VAULT,
      people: [...VAULT.people, person('Mara Lind', ['mara.lind@vendor.example'], ['Mara'])],
      notePaths: [MEETING_PATH, createVaultPath('People/Mara Lind.md')],
    };
    const decided = decide([guestsItem], note, vault);
    expect(decided.items[0]!.decision.outcome).not.toBe('task');
  });
});

describe('a rerun after a new answer, with items in another order', () => {
  // Run 1's answer made "Send the renewal contract" (t0001) a task. The
  // transcript was then corrected (a speaker renamed), so the step asked again
  // (ADR-0036: a new ask when the transcript digest changes). The new answer
  // lists a second item of the owner's on the same turn first.
  const TURNS = [
    ['t0001', 'You', 'I’ll send the renewal contract and book the signing call.'],
    ['t0002', 'Tobias Fenn', 'Sounds good.'],
  ] as const;
  const note = meetingWith(TURNS, [OWNER, TOBIAS]);
  const made = atlasItemKey({ meeting: IDENTITY, block: 't0001', owner: 'self' });
  const sendContract = {
    kind: 'task',
    title: 'Send the renewal contract',
    owner: 'You',
    source_block: 't0001',
    confidence: 'high',
  };
  const bookCall = {
    kind: 'task',
    title: 'Book the signing call',
    owner: 'You',
    source_block: 't0001',
    confidence: 'high',
  };
  const run = {
    madeItems: [made],
    linkedTasks: [{ source: '[[Vendor sync#^t0001]]', owner: 'self' }],
  };

  it('decides each item the same whatever the answer’s order (the made one skipped, the new one surfaced)', () => {
    const inOrder = decide([sendContract, bookCall], note, VAULT, run);
    const reordered = decide([bookCall, sendContract], note, VAULT, run);
    const byTitle = (decided: ReturnType<typeof decide>) =>
      Object.fromEntries(
        decided.items.map(({ proposal, decision }) => [proposal.payload.title, decision.outcome]),
      );

    expect(byTitle(inOrder)).toEqual({
      'Send the renewal contract': 'skipped',
      'Book the signing call': 'proposal',
    });
    // Actual: { 'Book the signing call': 'skipped', 'Send the renewal contract': 'proposal' } —
    // the new item is dropped without even a proposal, and the made task is re-proposed.
    expect(byTitle(reordered)).toEqual(byTitle(inOrder));
  });
});
