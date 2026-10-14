import { describe, expect, it } from 'vitest';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import type { MeetingIdentity } from '../meetings/meeting-holding.ts';
import type { DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { atlasItemKey } from './claude-proposal-id.ts';
import {
  decideMeetingItems,
  TASK_CONFIDENCE_FLOOR,
  vaultNamesItsOwner,
  type MeetingItemsRun,
} from './meeting-item-apply.ts';
import type {
  AnsweredNote,
  AnswerContext,
  AnswerVault,
  CheckedProposal,
} from './proposal-schema.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';

/**
 * ADR-0036, #178: which of a meeting's action items become the owner's tasks
 * without a click. Each item goes through the whole of the domain — the
 * answer read, its owner resolved from the cited turn's speaker, the caps —
 * and then the apply policy. The model's "You" is a hint; the speaker decides.
 */

const IDENTITY: MeetingIdentity = { provider: 'granola', externalId: 'granola-5c1d' };
const MEETING_PATH = createVaultPath('Inbox/Meetings/Renewal review.md');

const MARA: MeetingAttendee = { name: 'Mara Quill', email: 'mara.quill@example.com', group: false };
const TOBIAS: MeetingAttendee = {
  name: 'Tobias Fenn',
  email: 'tobias.fenn@example.com',
  group: false,
};
const OTHER_MARA: MeetingAttendee = {
  name: 'Mara Lind',
  email: 'mara.lind@example.com',
  group: false,
};

/** Who spoke each turn, and what they said. */
const TURNS = [
  ['t0001', 'Mara Quill', 'I’ll send the renewal contract by Friday.'],
  ['t0002', 'Tobias Fenn', 'Mara, could you book the review room?'],
  ['t0003', 'Unknown', 'Somebody should chase the invoice.'],
  ['t0004', 'You', 'I’ll draft the summary for Larkspur Payroll.'],
  ['t0005', 'Mara', 'I’ll check the figures.'],
] as const;

const MEETING_TEXT = [
  '---',
  'type: meeting',
  'atlas_import: meeting/v1',
  'title: Renewal review',
  "date: '2026-10-12'",
  'provider: granola',
  "external_id: 'granola-5c1d'",
  '---',
  '',
  '## Transcript',
  '',
  ...TURNS.flatMap(([id, speaker, words]) => [`**${speaker}** [10:0${id.at(-1)}:00] ${words} ^${id}`, '']),
].join('\n');

const meeting = (
  attendees: readonly MeetingAttendee[] = [MARA, TOBIAS],
  identity: MeetingIdentity | null = IDENTITY,
): AnsweredNote => ({
  path: MEETING_PATH,
  text: MEETING_TEXT,
  meeting: { identity, date: '2026-10-12', attendees },
});

const person = (name: string, emails: string[] = []): DirectoryPerson => ({
  path: createVaultPath(`People/${name}.md`),
  name,
  emails,
  aliases: [],
  company: null,
});

/** Mara owns the vault, by name and address; Tobias has a Person note. */
const VAULT: AnswerVault = {
  selfName: 'Mara Quill',
  selfEmails: ['mara.quill@example.com'],
  people: [person('Tobias Fenn', ['tobias.fenn@example.com'])],
  notePaths: [MEETING_PATH, createVaultPath('People/Tobias Fenn.md')],
  terms: [],
};

const RUN: MeetingItemsRun = {
  today: '2026-10-14',
  backfilled: false,
  madeItems: [],
  linkedTaskSources: [],
};

const schema = proposalSchemaNamed('meeting-items')!;

const item = (fields: Record<string, unknown> = {}) => ({
  kind: 'task',
  title: 'Send the renewal contract',
  owner: 'You',
  source_block: 't0001',
  confidence: 'high',
  ...fields,
});

function proposalsFor(items: readonly unknown[], context: AnswerContext): readonly CheckedProposal[] {
  const reading = schema.read(JSON.stringify({ items }), context);
  if (!reading.ok) throw new Error(reading.problem);
  expect(reading.dropped).toEqual([]);
  return reading.value;
}

interface Setting {
  readonly note?: AnsweredNote;
  readonly vault?: AnswerVault;
  readonly run?: Partial<MeetingItemsRun>;
}

function decide(items: readonly unknown[], { note = meeting(), vault = VAULT, run }: Setting = {}) {
  const proposals = proposalsFor(items, { notes: [note], vault });
  expect(proposals).toHaveLength(items.length);
  return decideMeetingItems({ proposals, vault, run: { ...RUN, ...run } });
}

const decideOne = (fields: Record<string, unknown>, setting?: Setting) => {
  const decided = decide([item(fields)], setting);
  return decided.items[0]!.decision;
};

const SELF_KEY = atlasItemKey({ meeting: IDENTITY, block: 't0001', owner: 'self' });

describe('the outcome table (ADR-0036): which items become the owner’s tasks', () => {
  it.each([
    {
      cell: 'the owner, by “You”, spoken by the owner, high',
      fields: { owner: 'You', confidence: 'high' },
    },
    {
      cell: 'the owner, by name, spoken by the owner, medium',
      fields: { owner: 'Mara Quill', confidence: 'medium' },
    },
    {
      cell: 'the owner, cited turn written “You” by the transcript',
      fields: { owner: 'You', source_block: 't0004' },
    },
    {
      cell: 'the owner, by their address',
      fields: { owner: 'mara.quill@example.com' },
    },
    {
      cell: 'a follow-up the owner took on, spoken by the owner',
      fields: { kind: 'follow-up', title: 'Chase the countersigned copy' },
    },
  ])('makes a task: $cell', ({ fields }) => {
    expect(decideOne(fields)).toMatchObject({ outcome: 'task' });
  });

  it.each([
    {
      cell: 'the owner, low',
      fields: { confidence: 'low' },
      because: 'below-floor',
    },
    {
      cell: 'another person with a Person note',
      fields: { owner: 'Tobias Fenn', source_block: 't0002' },
      because: 'someone-elses',
    },
    {
      cell: 'a name the vault has no note for',
      fields: { owner: 'Lena Hart' },
      because: 'someone-elses',
    },
    {
      cell: 'nobody named',
      fields: { owner: '' },
      because: 'owner-undecided',
    },
    {
      cell: 'a group',
      fields: { owner: 'everyone' },
      because: 'owner-undecided',
    },
    {
      cell: 'a decision, even the owner’s, at high',
      fields: { kind: 'decision', title: 'Renew for a year' },
      because: 'decision',
    },
    {
      cell: 'a follow-up another person took on',
      fields: { kind: 'follow-up', owner: 'Tobias Fenn', source_block: 't0002' },
      because: 'someone-elses',
    },
    {
      cell: 'a follow-up nobody was named for',
      fields: { kind: 'follow-up', owner: '' },
      because: 'owner-undecided',
    },
    {
      cell: 'a follow-up of the owner’s, low',
      fields: { kind: 'follow-up', confidence: 'low' },
      because: 'below-floor',
    },
  ])('makes a proposal: $cell', ({ fields, because }) => {
    expect(decideOne(fields)).toEqual({ outcome: 'proposal', because });
  });

  it.each([
    {
      cell: 'spoken by another (the hint says “You”, the speaker is Tobias)',
      fields: { source_block: 't0002', title: 'Book the review room' },
      caps: ['spoken-by-another'],
    },
    {
      cell: 'an unnamed speaker',
      fields: { source_block: 't0003', title: 'Chase the invoice' },
      caps: ['unnamed-speaker'],
    },
    {
      cell: '“we”',
      fields: { owner: 'We' },
      caps: ['we'],
    },
    {
      cell: '“You and Tobias Fenn”',
      fields: { owner: 'You and Tobias Fenn' },
      caps: ['with-others'],
    },
    {
      cell: 'a mixed-up kind (a waiting-for, naming the owner)',
      fields: { kind: 'waiting' },
      caps: ['mixed-kind'],
    },
    {
      cell: 'a follow-up of the owner’s spoken by another',
      fields: { kind: 'follow-up', source_block: 't0002' },
      caps: ['spoken-by-another'],
    },
    {
      cell: 'a follow-up of the owner’s from an unnamed speaker',
      fields: { kind: 'follow-up', source_block: 't0003' },
      caps: ['unnamed-speaker'],
    },
  ])('keeps the owner’s item a proposal, even at medium, when capped: $cell', ({ fields, caps }) => {
    for (const confidence of ['high', 'medium']) {
      expect(decideOne({ ...fields, confidence })).toEqual({
        outcome: 'proposal',
        because: 'capped',
        caps,
      });
    }
  });

  it('names every cap an item has, not just the first', () => {
    expect(decideOne({ owner: 'We', kind: 'waiting', source_block: 't0002' })).toEqual({
      outcome: 'proposal',
      because: 'capped',
      caps: ['spoken-by-another', 'we', 'mixed-kind'],
    });
  });

  it('applies the medium floor after the caps: medium is the one constant', () => {
    expect(TASK_CONFIDENCE_FLOOR).toBe('medium');
    expect(decideOne({ owner: 'We', confidence: 'low' })).toMatchObject({ because: 'capped' });
  });
});

describe('the speaker decides; the model’s “You” is a hint', () => {
  it('keeps an item a proposal when the hint names someone else and the owner spoke the turn', () => {
    expect(decideOne({ owner: 'Tobias Fenn', source_block: 't0001' })).toEqual({
      outcome: 'proposal',
      because: 'someone-elses',
    });
  });

  it('keeps an item a proposal when the owner spoke the turn but the model named nobody', () => {
    expect(decideOne({ owner: '', source_block: 't0004' })).toEqual({
      outcome: 'proposal',
      because: 'owner-undecided',
    });
  });

  it('takes a first name the owner alone has, as the speaker, for the owner', () => {
    expect(decideOne({ source_block: 't0005', title: 'Check the figures' })).toMatchObject({
      outcome: 'task',
    });
  });

  it('caps a turn spoken by a first name two attendees share (two called Mara)', () => {
    const note = meeting([MARA, OTHER_MARA, TOBIAS]);

    expect(decideOne({ source_block: 't0005', title: 'Check the figures' }, { note })).toEqual({
      outcome: 'proposal',
      because: 'capped',
      caps: ['spoken-by-another'],
    });
  });

  it('cannot tell which Mara a hint of “Mara” is when two attend', () => {
    const note = meeting([MARA, OTHER_MARA, TOBIAS]);

    expect(decideOne({ owner: 'Mara' }, { note })).toEqual({
      outcome: 'proposal',
      because: 'owner-undecided',
    });
  });
});

describe('who the owner is: selfEmails and the profile name (#173)', () => {
  const NOBODY: AnswerVault = { ...VAULT, selfName: null, selfEmails: [] };

  it('makes no task, and says why, when the vault names neither', () => {
    const decided = decide([item(), item({ kind: 'follow-up' })], { vault: NOBODY });

    expect(decided.noTasksBecause).toBe('owner-unknown');
    expect(decided.items.map(({ decision }) => decision)).toEqual([
      { outcome: 'proposal', because: 'owner-unknown' },
      { outcome: 'proposal', because: 'owner-unknown' },
    ]);
  });

  it('does not read a blank profile name as a name', () => {
    expect(vaultNamesItsOwner({ ...NOBODY, selfName: '   ' })).toBe(false);
  });

  it('does not read the owner’s Person note as theirs without a profile name to find it by', () => {
    const people = [person('Mara Quill', ['mara.quill@example.com'])];

    expect(vaultNamesItsOwner({ ...NOBODY, people })).toBe(false);
  });

  it('makes tasks with the profile name alone', () => {
    const vault = { ...NOBODY, selfName: 'Mara Quill' };

    expect(vaultNamesItsOwner(vault)).toBe(true);
    expect(decideOne({}, { vault })).toMatchObject({ outcome: 'task' });
  });

  it('makes tasks with selfEmails alone: the speaker is matched by the attendee’s address', () => {
    const vault = { ...NOBODY, selfEmails: ['MARA.QUILL@example.com'] };

    expect(vaultNamesItsOwner(vault)).toBe(true);
    expect(decideOne({ owner: 'mara.quill@example.com' }, { vault })).toMatchObject({
      outcome: 'task',
    });
  });

  it('says nothing is withheld when the owner is named and the meeting is new', () => {
    expect(decide([item({ owner: 'Tobias Fenn' })]).noTasksBecause).toBeNull();
  });
});

describe('backfill (14 days) makes proposals only', () => {
  it('turns every item into a proposal, and says why', () => {
    const decided = decide([item(), item({ kind: 'follow-up' }), item({ owner: 'Tobias Fenn' })], {
      run: { backfilled: true },
    });

    expect(decided.noTasksBecause).toBe('backfilled');
    expect(decided.items.map(({ decision }) => decision)).toEqual([
      { outcome: 'proposal', because: 'backfilled' },
      { outcome: 'proposal', because: 'backfilled' },
      { outcome: 'proposal', because: 'backfilled' },
    ]);
  });

  it('names the missing owner first: fixing it is what the person can do', () => {
    const vault = { ...VAULT, selfName: null, selfEmails: [] };

    expect(decide([item()], { vault, run: { backfilled: true } }).noTasksBecause).toBe(
      'owner-unknown',
    );
  });
});

describe('the task made', () => {
  it('is the proposal’s note, in the Inbox, joined to the meeting’s tasks, keyed by its item', () => {
    const decision = decideOne({ due: '2026-10-16' });

    expect(decision).toEqual({
      outcome: 'task',
      atlasItem: SELF_KEY,
      payload: {
        title: 'Send the renewal contract',
        folder: null,
        properties: { status: 'inbox', due: '2026-10-16' },
        body: '',
        linkFrom: { note: MEETING_PATH, property: 'tasks', meeting: IDENTITY },
      },
    });
  });

  it('keeps a due date of today', () => {
    expect(decideOne({ due: '2026-10-14' })).toMatchObject({
      payload: { properties: { due: '2026-10-14' } },
    });
  });

  it('sets no due date in the past, and its body says what was said', () => {
    const decision = decideOne({ due: '2026-10-13' });

    expect(decision.outcome).toBe('task');
    if (decision.outcome !== 'task') return;
    expect(decision.payload.properties).toEqual({ status: 'inbox' });
    expect(decision.payload.body).toBe(
      'Due 2026-10-13, as said in the meeting: that day had passed when this task was made, so it has no due date.',
    );
  });

  it('keeps a follow-up’s tag', () => {
    expect(decideOne({ kind: 'follow-up' })).toMatchObject({
      payload: { properties: { status: 'inbox', tags: ['follow-up'] } },
    });
  });
});

describe('the identity key, atlas_item: primary meeting + cited block + resolved owner', () => {
  it('is the same for the same block when the model retitles the item', () => {
    const first = decideOne({ title: 'Send the renewal contract' });
    const again = decideOne({ title: 'Email Larkspur Payroll the signed renewal' });

    expect(first).toMatchObject({ atlasItem: SELF_KEY });
    expect(again).toMatchObject({ atlasItem: SELF_KEY });
  });

  it('differs by block, by owner and by meeting', () => {
    const keys = [
      SELF_KEY,
      atlasItemKey({ meeting: IDENTITY, block: 't0004', owner: 'self' }),
      atlasItemKey({ meeting: IDENTITY, block: 't0001', owner: 'tobias fenn' }),
      atlasItemKey({ meeting: { ...IDENTITY, externalId: 'granola-9e2f' }, block: 't0001', owner: 'self' }),
      atlasItemKey({ meeting: { ...IDENTITY, provider: 'gemini' }, block: 't0001', owner: 'self' }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cannot be forged by moving text between its parts', () => {
    expect(atlasItemKey({ meeting: { provider: 'a', externalId: 'b\nc' }, block: 'd', owner: 'self' })).not.toBe(
      atlasItemKey({ meeting: { provider: 'a', externalId: 'b' }, block: 'c\nd', owner: 'self' }),
    );
  });

  it('ignores the spaces around an external id, as the meeting’s identity does', () => {
    expect(
      atlasItemKey({ meeting: { ...IDENTITY, externalId: ' granola-5c1d ' }, block: 't0001', owner: 'self' }),
    ).toBe(SELF_KEY);
  });

  it('keys on the primary, first-imported copy when another copy exists', () => {
    const primary = { provider: 'gemini', externalId: 'gemini-77aa' };

    expect(decideOne({}, { run: { primaryMeeting: primary } })).toMatchObject({
      atlasItem: atlasItemKey({ meeting: primary, block: 't0001', owner: 'self' }),
    });
  });

  it('makes no task from a meeting the import does not vouch for: it has no identity to key on', () => {
    expect(decideOne({}, { note: meeting([MARA, TOBIAS], null) })).toEqual({
      outcome: 'proposal',
      because: 'not-imported',
    });
  });
});

describe('an item already made is skipped', () => {
  it('skips an item whose atlas_item a task already holds, in the vault or the Archive', () => {
    expect(decideOne({}, { run: { madeItems: [SELF_KEY] } })).toEqual({
      outcome: 'skipped',
      because: 'already-made',
      atlasItem: SELF_KEY,
    });
  });

  it.each([
    '[[Renewal review#^t0001]]',
    '[[Inbox/Meetings/Renewal review.md#^t0001]]',
    '[[renewal review#^t0001|the contract]]',
  ])('skips an item when a task linked to the meeting already cites its block (%s)', (source) => {
    expect(decideOne({}, { run: { linkedTaskSources: [source] } })).toEqual({
      outcome: 'skipped',
      because: 'block-cited',
      atlasItem: SELF_KEY,
    });
  });

  it.each([
    ['another block', '[[Renewal review#^t0004]]'],
    ['the same block of another meeting', '[[Platform weekly sync#^t0001]]'],
    ['the meeting, not a block', '[[Renewal review]]'],
    ['no link', 'Renewal review ^t0001'],
  ])('makes the task when a linked task cites %s', (_, source) => {
    expect(decideOne({}, { run: { linkedTaskSources: [source] } })).toMatchObject({
      outcome: 'task',
    });
  });

  it('makes one task from two of the owner’s items on one turn, and proposes the other', () => {
    const decided = decide([item(), item({ title: 'Book the signing call' })]);

    expect(decided.items.map(({ decision }) => decision.outcome)).toEqual(['task', 'proposal']);
    expect(decided.items[1]!.decision).toEqual({ outcome: 'proposal', because: 'turn-already-a-task' });
  });

  it('decides the same on a rerun: the made one is skipped, the other is still a proposal', () => {
    const decided = decide([item(), item({ title: 'Book the signing call' })], {
      run: { madeItems: [SELF_KEY], linkedTaskSources: ['[[Renewal review#^t0001]]'] },
    });

    expect(decided.items.map(({ decision }) => decision)).toEqual([
      { outcome: 'skipped', because: 'already-made', atlasItem: SELF_KEY },
      { outcome: 'proposal', because: 'turn-already-a-task' },
    ]);
  });

  it('does not let a proposal take the key a later task of the same turn needs', () => {
    const decided = decide([item({ confidence: 'low' }), item({ title: 'Book the signing call' })]);

    expect(decided.items.map(({ decision }) => decision.outcome)).toEqual(['proposal', 'task']);
  });
});

describe('what the decision is handed', () => {
  it('keeps each proposal beside its decision, in the answer’s order', () => {
    const decided = decide([item(), item({ owner: 'Tobias Fenn', source_block: 't0002' })]);

    expect(decided.items.map(({ proposal }) => proposal.cites.block)).toEqual(['t0001', 't0002']);
  });

  it('keeps a proposal no meeting item made a proposal', () => {
    const [proposal] = proposalsFor([item()], { notes: [meeting()], vault: VAULT });
    const { meetingItem: _, ...plain } = proposal!;

    expect(
      decideMeetingItems({ proposals: [plain], vault: VAULT, run: RUN }).items[0]!.decision,
    ).toEqual({ outcome: 'proposal', because: 'not-an-action-item' });
  });
});
