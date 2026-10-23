import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { vocabulary } from '../terms/vocabulary.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { claudeProposalId } from './claude-proposal-id.ts';
import type {
  AnsweredNote,
  AnswerContext,
  AnswerVault,
  CheckedProposal,
  PendingTerm,
} from './proposal-schema.ts';
import { proposalSchemaNamed } from './proposal-schemas.ts';

/**
 * #19: a meeting's answer may suggest glossary terms — words a turn seems to
 * have misheard, and their right spelling. Each is read against the Gemini
 * fixture meeting with its first turn misheard, and held to the glossary's
 * rules here, never the model's: what is proposed, what is left out and
 * why, and what a suggestion is known by so it is proposed once.
 */

const fixture = readFileSync(
  new URL('../meetings/fixtures/valid/gemini-platform-sync.md', import.meta.url),
  'utf8',
);
const MISHEARD = fixture.replace('start with the cache?', 'start with the Larks Purr cache?');

const meeting = (title: string, externalId: string, text = MISHEARD): AnsweredNote => ({
  path: createVaultPath(`Inbox/Meetings/${title}.md`),
  text,
  meeting: {
    identity: { provider: 'gemini', externalId },
    date: '2026-09-29',
    attendees: [{ name: 'Mara Quill', email: 'mara.quill@example.com', group: false }],
  },
});
const SYNC = meeting('Platform weekly sync', 'gemini-7f3a9c21');
const RETRO = meeting('Platform retro', 'gemini-0c11aa02');

const VOCABULARY = vocabulary({
  terms: [
    {
      path: createVaultPath('Terms/Brenwick Labs.md'),
      canonical: 'Brenwick Labs',
      variants: ['Bren Wick Labs'],
      kind: 'company',
    },
  ],
  people: [{ path: createVaultPath('People/Mara Quill.md'), name: 'Mara Quill', aliases: [] }],
  companies: [],
});
const vaultFor = (note: AnsweredNote): AnswerVault => ({
  selfName: 'Mara Quill',
  selfEmails: [],
  people: [],
  notePaths: [note.path],
  terms: ['Brenwick Labs'],
  vocabulary: VOCABULARY,
});
const about = (note: AnsweredNote): AnswerContext => ({ notes: [note], vault: vaultFor(note) });

const termItem = (fields: Record<string, unknown> = {}) => ({
  kind: 'term',
  title: 'Larkspur',
  heard: 'Larks Purr',
  owner: '',
  source_block: 't0001',
  confidence: 'medium',
  ...fields,
});

describe.each(['meeting-items', 'meeting-digest'])('a %s answer’s term', (output) => {
  const schema = proposalSchemaNamed(output)!;
  const read = (items: unknown[], note: AnsweredNote = SYNC) =>
    schema.read(JSON.stringify({ items }), about(note));
  const proposed = (items: unknown[], note: AnsweredNote = SYNC) => {
    const reading = read(items, note);
    if (!reading.ok) throw new Error(reading.problem);
    return reading;
  };

  it('is proposed as a term in Terms, misheard as the turn has it, citing that turn', () => {
    const reading = proposed([termItem()]);

    expect(reading.dropped).toEqual([]);
    expect(reading.value).toHaveLength(1);
    const [term] = reading.value;
    expect(term).toMatchObject({
      kind: 'term',
      source: '[[Platform weekly sync#^t0001]]',
      confidence: 'medium',
      payload: {
        title: 'Larkspur',
        folder: 'Terms',
        properties: { variants: ['Larks Purr'] },
        linkFrom: null,
      },
    });
    expect(term!.why).toContain('Heard as “Larks Purr” in Platform weekly sync.');
    // A term is the glossary's: it is never made a task, and never joins the meeting.
    expect(term!.meetingItem).toBeUndefined();
  });

  it('tells the model what a term item is', () => {
    expect(schema.instructions).toContain(
      '"kind": one of task, waiting, decision, follow-up, term',
    );
    expect(schema.instructions).toContain('"heard": only for a term');
  });

  it.each([
    [
      'not said in the turn it cites',
      { source_block: 't0002' },
      '“Larks Purr” is not said in turn ^t0002 as written.',
    ],
    [
      'heard in other capitals than the turn has',
      { heard: 'larks purr' },
      '“larks purr” is not said in turn ^t0001 as written.',
    ],
    [
      'everyday words',
      { title: 'Kash', heard: 'start with' },
      '“start with” is everyday words, and would be rewritten wherever anyone says it.',
    ],
    [
      'already in the glossary',
      { title: 'brenwick labs' },
      '“brenwick labs” is already in the glossary, as “Brenwick Labs”.',
    ],
    ['heard as nothing', { heard: ' ' }, 'It is a term with no "heard".'],
    ['heard as no text', { heard: 3 }, 'Its "heard" is not text.'],
  ])('is left out, and says why, when it is %s', (_, fields, reason) => {
    const reading = proposed([termItem(fields)]);

    expect(reading.value).toEqual([]);
    expect(reading.dropped).toEqual([{ title: expect.any(String), reason }]);
  });

  it('is left out once the vault has the term, from the same answer read again', () => {
    expect(proposed([termItem()]).value).toHaveLength(1);
    const added = vocabulary({
      terms: [
        {
          path: createVaultPath('Terms/Larkspur.md'),
          canonical: 'Larkspur',
          variants: ['Larks Purr'],
          kind: null,
        },
      ],
      people: [],
      companies: [],
    });
    const again = schema.read(JSON.stringify({ items: [termItem()] }), {
      notes: [SYNC],
      vault: { ...vaultFor(SYNC), vocabulary: added },
    });
    if (!again.ok) throw new Error(again.problem);
    expect(again.value).toEqual([]);
    expect(again.dropped.map((each) => each.reason)).toEqual([
      '“Larkspur” is already in the glossary, as “Larkspur”.',
    ]);
  });

  it('leaves the other items of the answer as they were', () => {
    const task = {
      kind: 'task',
      title: 'Write the rollout note',
      owner: 'You',
      source_block: 't0003',
      confidence: 'high',
    };
    const reading = proposed([termItem({ title: 'Kash', heard: 'start with' }), task]);

    expect(reading.value.map((each) => each.kind)).toEqual(['task']);
    expect(reading.dropped).toHaveLength(1);
  });
});

describe('what a suggested term is known by', () => {
  const schema = proposalSchemaNamed('meeting-items')!;
  const checked = (fields: Record<string, unknown>, note: AnsweredNote = SYNC): CheckedProposal => {
    const reading = schema.read(JSON.stringify({ items: [termItem(fields)] }), about(note));
    if (!reading.ok || reading.value.length !== 1) throw new Error(JSON.stringify(reading));
    return reading.value[0]!;
  };
  const idOf = (proposal: CheckedProposal, rule = 'After a meeting') =>
    claudeProposalId({ rule, proposal });

  it('is its right spelling alone: the same from another meeting, turn, rule or hearing', () => {
    const first = idOf(checked({}));
    const retro = RETRO.text.replace('Friday works.', 'Friday works for the Larks Purr team.');

    expect(idOf(checked({}, RETRO))).toBe(first);
    expect(idOf(checked({ source_block: 't0004' }, { ...RETRO, text: retro }))).toBe(first);
    expect(idOf(checked({}), 'Meeting extraction')).toBe(first);
    expect(idOf(checked({ heard: 'Purr' }))).toBe(first);
  });

  it('is one whatever the case, Latin accents or possessive of the right spelling, never a plural', () => {
    const first = idOf(checked({}));

    expect(idOf(checked({ title: 'LARKSPUR' }))).toBe(first);
    expect(idOf(checked({ title: 'Lárkspur' }))).toBe(first);
    expect(idOf(checked({ title: 'Larkspur’s' }))).toBe(first);
    expect(idOf(checked({ title: 'Larkspurs' }))).not.toBe(first);
    expect(idOf(checked({ title: 'Larkspar' }))).not.toBe(first);
    expect(first).toMatch(/^claude-[0-9a-f]+$/);
  });

  it('is never what a task of the same title on the same turn is known by', () => {
    const term = checked({ title: 'Larks' });
    const task = schema.read(
      JSON.stringify({
        items: [
          { kind: 'task', title: 'Larks', owner: 'You', source_block: 't0001', confidence: 'high' },
        ],
      }),
      about(SYNC),
    );
    if (!task.ok) throw new Error(task.problem);
    expect(idOf(task.value[0]!)).not.toBe(idOf(term));
  });
});

describe('a term the general proposals schema proposes', () => {
  const general = proposalSchemaNamed('proposals')!;
  const proposedFrom = (note: AnsweredNote, block: string): CheckedProposal => {
    const reading = general.read(
      JSON.stringify({
        proposals: [
          {
            kind: 'term',
            title: 'Larkspur',
            source: `[[${note.path.slice(note.path.lastIndexOf('/') + 1, -3)}#^${block}]]`,
            confidence: 'high',
            why: 'It is misheard.',
          },
        ],
      }),
      { notes: [note] },
    );
    if (!reading.ok || reading.value.length !== 1) throw new Error(JSON.stringify(reading));
    return reading.value[0]!;
  };

  it('keeps the rule- and citation-scoped id: it is no meeting’s glossary suggestion', () => {
    const first = claudeProposalId({ rule: 'Mine', proposal: proposedFrom(SYNC, 't0001') });

    expect(claudeProposalId({ rule: 'Mine', proposal: proposedFrom(SYNC, 't0001') })).toBe(first);
    expect(claudeProposalId({ rule: 'Other', proposal: proposedFrom(SYNC, 't0001') })).not.toBe(
      first,
    );
    expect(claudeProposalId({ rule: 'Mine', proposal: proposedFrom(SYNC, 't0002') })).not.toBe(
      first,
    );
    const meetings = schemaTerm();
    expect(claudeProposalId({ rule: 'Mine', proposal: meetings })).not.toBe(first);
  });

  function schemaTerm(): CheckedProposal {
    const reading = proposalSchemaNamed('meeting-items')!.read(
      JSON.stringify({ items: [termItem()] }),
      about(SYNC),
    );
    if (!reading.ok) throw new Error(reading.problem);
    return reading.value[0]!;
  }
});

describe('a term already waiting in the Inbox', () => {
  const schema = proposalSchemaNamed('meeting-items')!;
  const readWith = (pendingTerms: readonly PendingTerm[], fields = {}) => {
    const reading = schema.read(JSON.stringify({ items: [termItem(fields)] }), {
      notes: [SYNC],
      vault: { ...vaultFor(SYNC), pendingTerms },
    });
    if (!reading.ok) throw new Error(reading.problem);
    return reading;
  };

  it('is not proposed again, and the log says it waits', () => {
    const reading = readWith([{ title: 'larkspur', variants: ['Larks Purr'] }]);

    expect(reading.value).toEqual([]);
    expect(reading.dropped.map((each) => each.reason)).toEqual([
      '“larkspur” is proposed already, waiting in the Inbox.',
    ]);
  });

  it('heard another way, says to add that spelling once the term is made', () => {
    const reading = readWith([{ title: 'Larkspur', variants: ['Lark Spurr'] }]);

    expect(reading.value).toEqual([]);
    expect(reading.dropped.map((each) => each.reason)).toEqual([
      '“Larkspur” is proposed already, waiting in the Inbox; once it is a term, add “Larks Purr” to its misheard spellings on the Terms page.',
    ]);
  });

  it('blocks another term heard the same way, and says which', () => {
    const reading = readWith([{ title: 'Larkspar', variants: ['Larks Purr'] }]);

    expect(reading.value).toEqual([]);
    expect(reading.dropped.map((each) => each.reason)).toEqual([
      '“Larks Purr” is proposed already, as “Larkspar”, waiting in the Inbox.',
    ]);
  });

  it('leaves a term with nothing in common with it to be proposed', () => {
    expect(readWith([{ title: 'Brenwick', variants: ['Bren Wick'] }]).value).toHaveLength(1);
  });
});

describe('one answer’s two terms heard the same way', () => {
  it('keeps the first and says why the second is left out', () => {
    const reading = proposalSchemaNamed('meeting-digest')!.read(
      JSON.stringify({
        summary: 'A sync.',
        key_points: [],
        open_questions: [],
        items: [termItem(), termItem({ title: 'Larkspar' })],
      }),
      about(SYNC),
    );
    if (!reading.ok) throw new Error(reading.problem);

    expect(reading.value.map((each) => each.payload.title)).toEqual(['Larkspur']);
    expect(reading.dropped).toEqual([
      {
        title: 'Larkspar',
        reason: '“Larks Purr” is heard for another term of this answer already.',
      },
    ]);
  });
});
