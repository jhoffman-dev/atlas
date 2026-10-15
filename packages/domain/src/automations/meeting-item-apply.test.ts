import { describe, expect, it } from 'vitest';
import type { MeetingAttendee } from '../meetings/meeting-header.ts';
import type { MeetingIdentity } from '../meetings/meeting-holding.ts';
import type { DirectoryPerson } from '../meeting-links/attendee-matching.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { atlasItemKey } from './claude-proposal-id.ts';
import { EXCHANGE_TURNS } from './meeting-items.ts';
import {
  decideMeetingItems,
  ownerNeededBy,
  REVIEW_CONFIDENCE_FLOOR,
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
  ...TURNS.flatMap(([id, speaker, words]) => [
    `**${speaker}** [10:0${id.at(-1)}:00] ${words} ^${id}`,
    '',
  ]),
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
  linkedTasks: [],
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

function proposalsFor(
  items: readonly unknown[],
  context: AnswerContext,
): readonly CheckedProposal[] {
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
      cell: 'the owner, by name, spoken by the owner',
      fields: { owner: 'Mara Quill' },
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
      cell: 'the owner, medium',
      fields: { confidence: 'medium' },
      because: 'below-floor',
    },
    {
      cell: 'the owner, by name, medium',
      fields: { owner: 'Mara Quill', confidence: 'medium' },
      because: 'below-floor',
    },
    {
      cell: 'a follow-up of the owner’s, medium',
      fields: { kind: 'follow-up', confidence: 'medium' },
      because: 'below-floor',
    },
    {
      cell: 'a decision the owner took part in, at high',
      fields: { kind: 'decision', title: 'Renew for a year' },
      because: 'decision',
    },
  ])('shows it in the meeting’s review: $cell', ({ fields, because }) => {
    expect(decideOne(fields)).toEqual({ outcome: 'proposal', because });
  });

  it.each([
    {
      cell: 'the owner, low',
      fields: { confidence: 'low' },
      because: 'unsure',
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
      because: 'unsure',
    },
    {
      cell: 'a decision the owner took part in, at medium',
      fields: { kind: 'decision', title: 'Renew for a year', confidence: 'medium' },
      because: 'unsure',
    },
  ])('leaves it out (#226): $cell', ({ fields, because }) => {
    expect(decideOne(fields)).toEqual({ outcome: 'left-out', because });
  });

  it.each([
    {
      cell: 'spoken by another (the hint says “You”, the speaker is Tobias)',
      fields: { source_block: 't0002', title: 'Book the review room' },
      caps: ['spoken-by-another'],
    },
    {
      cell: 'a follow-up of the owner’s spoken by another',
      fields: { kind: 'follow-up', source_block: 't0002' },
      caps: ['spoken-by-another'],
    },
  ])(
    'shows the owner’s item in the review, even at high, when capped: $cell',
    ({ fields, caps }) => {
      for (const confidence of ['high', 'medium']) {
        expect(decideOne({ ...fields, confidence })).toEqual({
          outcome: 'proposal',
          because: 'capped',
          caps,
        });
      }
    },
  );

  it.each([
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
      cell: 'a follow-up of the owner’s from an unnamed speaker',
      fields: { kind: 'follow-up', source_block: 't0003' },
      caps: ['unnamed-speaker'],
    },
  ])(
    'leaves out the owner’s item, even at high, when a cap makes whose it is a guess: $cell',
    ({ fields, caps }) => {
      const [proposal] = proposalsFor([item({ ...fields, confidence: 'high' })], {
        notes: [meeting()],
        vault: VAULT,
      });
      expect(proposal!.meetingItem?.caps).toEqual(caps);
      for (const confidence of ['high', 'medium']) {
        expect(decideOne({ ...fields, confidence })).toEqual({
          outcome: 'left-out',
          because: 'unsure',
        });
      }
    },
  );

  it('names every cap an item has, not just the first', () => {
    const [proposal] = proposalsFor(
      [item({ owner: 'We', kind: 'waiting', source_block: 't0002' })],
      { notes: [meeting()], vault: VAULT },
    );

    expect(proposal!.meetingItem?.caps).toEqual(['spoken-by-another', 'we', 'mixed-kind']);
  });

  it('makes a task only at high, and shows medium in the review (#226)', () => {
    expect(TASK_CONFIDENCE_FLOOR).toBe('high');
    expect(REVIEW_CONFIDENCE_FLOOR).toBe('medium');
    expect(decideOne({ confidence: 'high' })).toMatchObject({ outcome: 'task' });
    expect(decideOne({ confidence: 'medium' })).toEqual({
      outcome: 'proposal',
      because: 'below-floor',
    });
  });
});

describe('the speaker decides; the model’s “You” is a hint', () => {
  it('leaves an item out when the hint names someone else and the owner spoke the turn', () => {
    expect(decideOne({ owner: 'Tobias Fenn', source_block: 't0001' })).toEqual({
      outcome: 'left-out',
      because: 'someone-elses',
    });
  });

  it('leaves an item out when the owner spoke the turn but the model named nobody', () => {
    expect(decideOne({ owner: '', source_block: 't0004' })).toEqual({
      outcome: 'left-out',
      because: 'owner-undecided',
    });
  });

  it('takes a first name the owner alone has, as the speaker, for the owner, when the transcript has no other label for them', () => {
    const text = MEETING_TEXT.replace(/\*\*(?:You|Mara Quill)\*\*/g, '**Tobias Fenn**');
    const note = { ...meeting(), text };

    expect(
      decideOne({ source_block: 't0005', title: 'Check the figures' }, { note }),
    ).toMatchObject({ outcome: 'task' });
  });

  it('caps a turn of a first-name label beside the owner’s own “You”: that speaker is someone else', () => {
    expect(decideOne({ source_block: 't0005', title: 'Check the figures' })).toEqual({
      outcome: 'proposal',
      because: 'capped',
      caps: ['spoken-by-another'],
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
      outcome: 'left-out',
      because: 'owner-undecided',
    });
  });
});

describe('who the owner is: selfEmails and the profile name (#173)', () => {
  const NOBODY: AnswerVault = { ...VAULT, selfName: null, selfEmails: [] };

  it('makes no task, and says why, when the vault names neither: what would be one is shown for review', () => {
    const decided = decide(
      [item({ source_block: 't0004' }), item({ kind: 'follow-up', source_block: 't0004' })],
      { vault: NOBODY },
    );

    expect(decided.noTasksBecause).toBe('owner-unknown');
    expect(decided.items.map(({ decision }) => decision)).toEqual([
      { outcome: 'proposal', because: 'owner-unknown' },
      { outcome: 'proposal', because: 'owner-unknown' },
    ]);
  });

  it('still leaves out what is not the owner’s while the vault names neither', () => {
    const decided = decide([item({ owner: 'Tobias Fenn', source_block: 't0002' })], {
      vault: NOBODY,
    });

    expect(decided.items[0]!.decision).toEqual({ outcome: 'left-out', because: 'someone-elses' });
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
  it('shows what would be a task for review, says why, and still leaves out the rest', () => {
    const decided = decide([item(), item({ kind: 'follow-up' }), item({ owner: 'Tobias Fenn' })], {
      run: { backfilled: true },
    });

    expect(decided.noTasksBecause).toBe('backfilled');
    expect(decided.items.map(({ decision }) => decision)).toEqual([
      { outcome: 'proposal', because: 'backfilled' },
      { outcome: 'proposal', because: 'backfilled' },
      { outcome: 'left-out', because: 'someone-elses' },
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
      atlasItemKey({
        meeting: { ...IDENTITY, externalId: 'granola-9e2f' },
        block: 't0001',
        owner: 'self',
      }),
      atlasItemKey({ meeting: { ...IDENTITY, provider: 'gemini' }, block: 't0001', owner: 'self' }),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cannot be forged by moving text between its parts', () => {
    expect(
      atlasItemKey({ meeting: { provider: 'a', externalId: 'b\nc' }, block: 'd', owner: 'self' }),
    ).not.toBe(
      atlasItemKey({ meeting: { provider: 'a', externalId: 'b' }, block: 'c\nd', owner: 'self' }),
    );
  });

  it('ignores the spaces around an external id, as the meeting’s identity does', () => {
    expect(
      atlasItemKey({
        meeting: { ...IDENTITY, externalId: ' granola-5c1d ' },
        block: 't0001',
        owner: 'self',
      }),
    ).toBe(SELF_KEY);
  });

  it('keys on the meeting read when it is the primary, first-imported copy', () => {
    const primary = { ...IDENTITY, externalId: ' granola-5c1d ' };

    expect(decideOne({}, { run: { primaryMeeting: primary } })).toEqual({
      outcome: 'task',
      atlasItem: SELF_KEY,
      payload: expect.anything(),
    });
  });

  const GEMINI: MeetingIdentity = { provider: 'gemini', externalId: 'gemini-77aa' };

  it.each([
    { order: 'the Gemini copy came first', read: IDENTITY, primary: GEMINI },
    { order: 'the Granola copy came first', read: GEMINI, primary: IDENTITY },
  ])(
    'makes no task from a copy of another recording, only proposals: $order',
    ({ read, primary }) => {
      const decided = decide(
        [item(), item({ source_block: 't0004', title: 'Draft the summary' })],
        {
          note: meeting([MARA, TOBIAS], read),
          run: { primaryMeeting: primary },
        },
      );

      expect(decided.items.map(({ decision }) => decision)).toEqual([
        { outcome: 'proposal', because: 'copy-of-another-recording' },
        { outcome: 'proposal', because: 'copy-of-another-recording' },
      ]);
    },
  );

  it('makes no task from a meeting the import does not vouch for: it has no identity to key on', () => {
    expect(decideOne({}, { note: meeting([MARA, TOBIAS], null) })).toEqual({
      outcome: 'proposal',
      because: 'not-imported',
    });
  });
});

describe('an item already made is skipped', () => {
  it('skips an item whose atlas_item a task already holds, in the vault or the Archive', () => {
    const made = { key: SELF_KEY, title: 'Send the renewal contract' };

    expect(decideOne({}, { run: { madeItems: [made] } })).toEqual({
      outcome: 'skipped',
      because: 'already-made',
      atlasItem: SELF_KEY,
    });
  });

  it.each([
    '[[Renewal review#^t0001]]',
    '[[Inbox/Meetings/Renewal review.md#^t0001]]',
    '[[renewal review#^t0001|the contract]]',
    ' [[Renewal review#^t0001]]\n',
  ])('skips an item when a task linked to the meeting already cites its block (%s)', (source) => {
    expect(decideOne({}, { run: { linkedTasks: [{ source, owner: 'self' }] } })).toEqual({
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
    expect(decideOne({}, { run: { linkedTasks: [{ source, owner: 'self' }] } })).toMatchObject({
      outcome: 'task',
    });
  });

  it('makes the owner’s task when the linked task citing its block is someone else’s', () => {
    const waitingOnTobias = { source: '[[Renewal review#^t0004]]', owner: 'tobias fenn' };

    expect(
      decideOne({ source_block: 't0004' }, { run: { linkedTasks: [waitingOnTobias] } }),
    ).toMatchObject({
      outcome: 'task',
      atlasItem: atlasItemKey({ meeting: IDENTITY, block: 't0004', owner: 'self' }),
    });
  });

  it('makes one task from two of the owner’s items on one turn, and proposes the other', () => {
    const decided = decide([item(), item({ title: 'Book the signing call' })]);

    expect(decided.items.map(({ decision }) => decision.outcome)).toEqual(['task', 'proposal']);
    expect(decided.items[1]!.decision).toEqual({
      outcome: 'proposal',
      because: 'turn-already-a-task',
    });
  });

  it('decides the same on a rerun: the made one is skipped, the other is still a proposal', () => {
    const decided = decide([item(), item({ title: 'Book the signing call' })], {
      run: {
        madeItems: [{ key: SELF_KEY, title: 'Send the renewal contract' }],
        linkedTasks: [{ source: '[[Renewal review#^t0001]]', owner: 'self' }],
      },
    });

    expect(decided.items.map(({ decision }) => decision)).toEqual([
      { outcome: 'skipped', because: 'already-made', atlasItem: SELF_KEY },
      { outcome: 'proposal', because: 'turn-already-a-task' },
    ]);
  });

  it('does not let a proposal take the key a later task of the same turn needs', () => {
    const decided = decide([
      item({ confidence: 'medium' }),
      item({ title: 'Book the signing call' }),
    ]);

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
    const { meetingItem, ...plain } = proposal!;
    expect(meetingItem).toBeDefined();

    expect(
      decideMeetingItems({ proposals: [plain], vault: VAULT, run: RUN }).items[0]!.decision,
    ).toEqual({ outcome: 'proposal', because: 'not-an-action-item' });
  });
});

/** A meeting whose transcript is these turns, in order: `[id, speaker, words]`. */
function meetingOf(turns: readonly (readonly [string, string, string])[]): AnsweredNote {
  const text = [
    ...MEETING_TEXT.split('## Transcript')[0]!.split('\n'),
    '## Transcript',
    '',
    ...turns.flatMap(([id, speaker, words]) => [`**${speaker}** [10:00:00] ${words} ^${id}`, '']),
  ].join('\n');
  return { ...meeting(), text };
}

/** Tobias and Lena talk for `between` turns after the owner's last word, then Tobias settles it. */
function exchangeAfter(between: number): AnsweredNote {
  const talk = Array.from({ length: between }, (_, at) => {
    const id = `t${String(at + 2).padStart(4, '0')}`;
    return [id, at % 2 === 0 ? 'Tobias Fenn' : 'Lena Hart', 'More on the release.'] as const;
  });
  const settled = `t${String(between + 2).padStart(4, '0')}`;
  return meetingOf([
    ['t0001', 'Mara Quill', 'What about the release?'],
    ...talk,
    [settled, 'Tobias Fenn', 'Agreed: we ship it on Friday.'],
  ]);
}

describe('a decision reaches the owner only when they took part and it was settled (#226)', () => {
  const decision = (block: string) => ({
    kind: 'decision',
    title: 'Ship the release on Friday',
    owner: '',
    source_block: block,
    confidence: 'high',
  });

  it.each([0, 5])(
    'shows a decision settled %i turns after the owner last spoke: within the exchange',
    (between) => {
      const block = `t${String(between + 2).padStart(4, '0')}`;
      expect(decideOne(decision(block), { note: exchangeAfter(between) })).toEqual({
        outcome: 'proposal',
        because: 'decision',
      });
    },
  );

  it('leaves out a decision settled more than the exchange’s turns after the owner last spoke', () => {
    expect(EXCHANGE_TURNS).toBe(6);
    const block = `t${String(EXCHANGE_TURNS + 2).padStart(4, '0')}`;

    expect(decideOne(decision(block), { note: exchangeAfter(EXCHANGE_TURNS) })).toEqual({
      outcome: 'left-out',
      because: 'not-the-owners-decision',
    });
  });

  it('does not count a turn by an unnamed speaker as the owner’s', () => {
    const note = meetingOf([
      ['t0001', 'Unknown', 'Shall we ship on Friday?'],
      ['t0002', 'Tobias Fenn', 'Agreed: we ship it on Friday.'],
    ]);

    expect(decideOne(decision('t0002'), { note })).toEqual({
      outcome: 'left-out',
      because: 'not-the-owners-decision',
    });
  });

  it('leaves out a decision the owner took part in but the model was not sure was settled', () => {
    expect(
      decideOne({ ...decision('t0002'), confidence: 'medium' }, { note: exchangeAfter(0) }),
    ).toEqual({ outcome: 'left-out', because: 'unsure' });
  });

  it('leaves out a decision with no claim, as one read before #226 would be', () => {
    const [proposal] = proposalsFor([decision('t0002')], {
      notes: [exchangeAfter(0)],
      vault: VAULT,
    });
    const { meetingDecision, ...plain } = proposal!;
    expect(meetingDecision).toEqual({ ownerTookPart: true });

    expect(
      decideMeetingItems({ proposals: [plain], vault: VAULT, run: RUN }).items[0]!.decision,
    ).toEqual({ outcome: 'left-out', because: 'not-the-owners-decision' });
  });
});

describe('someone else’s item reaches the owner only as a waiting-for they asked for (#226)', () => {
  const asked = meetingOf([
    ['t0001', 'Mara Quill', 'Tobias, could you send me the signed copy?'],
    ['t0002', 'Tobias Fenn', 'Yes, I’ll send it tomorrow.'],
  ]);
  const waiting = (fields: Record<string, unknown> = {}) => ({
    kind: 'waiting',
    title: 'Send the signed copy',
    owner: 'Tobias Fenn',
    source_block: 't0002',
    asked_by_owner: true,
    ...fields,
  });

  it('shows it when the model says the owner asked, and the owner spoke in the exchange', () => {
    expect(decideOne(waiting(), { note: asked })).toEqual({
      outcome: 'proposal',
      because: 'asked-for',
    });
  });

  it('leaves it out when the model does not say the owner asked', () => {
    expect(decideOne(waiting({ asked_by_owner: false }), { note: asked })).toEqual({
      outcome: 'left-out',
      because: 'someone-elses',
    });
    expect(decideOne(waiting({ asked_by_owner: undefined }), { note: asked })).toEqual({
      outcome: 'left-out',
      because: 'someone-elses',
    });
  });

  it('leaves it out when the model says the owner asked but the owner never spoke in the exchange', () => {
    const note = meetingOf([
      ['t0001', 'Lena Hart', 'Tobias, could you send the signed copy?'],
      ['t0002', 'Tobias Fenn', 'Yes, I’ll send it tomorrow.'],
    ]);

    expect(decideOne(waiting(), { note })).toEqual({
      outcome: 'left-out',
      because: 'someone-elses',
    });
  });

  it('leaves it out when the owner asked but the model is unsure', () => {
    expect(decideOne(waiting({ confidence: 'low' }), { note: asked })).toEqual({
      outcome: 'left-out',
      because: 'unsure',
    });
  });

  it('drops an item whose asked_by_owner is not true or false', () => {
    const reading = schema.read(JSON.stringify({ items: [waiting({ asked_by_owner: 'yes' })] }), {
      notes: [asked],
      vault: VAULT,
    });

    expect(reading.ok && reading.value).toEqual([]);
    expect(reading.ok && reading.dropped).toEqual([
      {
        title: 'Send the signed copy',
        reason: 'Its "asked_by_owner" is not true or false.',
      },
    ]);
  });
});

describe('a meeting of small talk and ideas makes nothing (#226)', () => {
  it('leaves out every item the model was unsure of or could name nobody for', () => {
    const decided = decide([
      item({ title: 'Maybe try the new café', confidence: 'low' }),
      item({ title: 'We should automate the report', owner: 'We', source_block: 't0004' }),
      item({ title: 'Somebody should chase the invoice', owner: '', source_block: 't0003' }),
      item({ kind: 'decision', title: 'Friday drinks are nice', confidence: 'low' }),
    ]);

    expect(decided.items.map(({ decision }) => decision.outcome)).toEqual([
      'left-out',
      'left-out',
      'left-out',
      'left-out',
    ]);
  });
});

describe('whether the Inbox says the owner cannot be told apart (#181)', () => {
  const mine = {
    enabled: true,
    action: {
      kind: 'claude',
      prompt: '.atlas/prompts/after-a-meeting.md',
      tools: [],
      output: { kind: 'proposals', schema: 'meeting-items' },
      apply: 'mine',
    },
  } as const;
  const NOBODY = { selfName: null, selfEmails: [], people: [] };

  it('says so while an enabled rule makes the owner’s tasks and the vault names nobody', () => {
    expect(ownerNeededBy([mine], NOBODY)).toBe(true);
  });

  it.each([
    ['a profile name', { ...NOBODY, selfName: 'Mara Quill' }],
    ['an address', { ...NOBODY, selfEmails: ['mara.quill@example.com'] }],
  ])('clears once the vault has %s', (_, owner) => {
    expect(ownerNeededBy([mine], owner)).toBe(false);
  });

  it('says nothing when no enabled rule makes the owner’s tasks', () => {
    const proposesOnly = {
      kind: 'claude',
      prompt: mine.action.prompt,
      tools: [],
      output: mine.action.output,
    } as const;
    expect(ownerNeededBy([{ ...mine, enabled: false }], NOBODY)).toBe(false);
    expect(ownerNeededBy([{ ...mine, action: proposesOnly }], NOBODY)).toBe(false);
    expect(ownerNeededBy([{ enabled: true, action: { kind: 'archive' } } as never], NOBODY)).toBe(
      false,
    );
    expect(ownerNeededBy([], NOBODY)).toBe(false);
  });
});
