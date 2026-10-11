import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { readNoteAnswer } from './note-answer.ts';
import {
  answerJson,
  citedBlockProblem,
  MAX_PROPOSALS_PER_ANSWER,
  proposalNoteProperties,
  registerProposalSchema,
  type AnswerContext,
  type ProposalSchema,
} from './proposal-schema.ts';
import { proposalSchemaNamed, PROPOSAL_SCHEMAS } from './proposal-schemas.ts';

/**
 * P29-03: a Claude step's answer, read against its rule's output. An answer
 * that does not read — not JSON, the wrong shape, one bad item — is refused
 * whole. Every proposal, whichever schema made it, cites a block of a note
 * the run read, and only ever proposes a new note.
 */

const STANDUP = createVaultPath('Meetings/2026-10-01 Standup.md');
const CONTEXT: AnswerContext = {
  notes: [
    {
      path: STANDUP,
      text: [
        '---',
        'type: meeting',
        '---',
        '',
        '**Mara Quill** Can you send me the payroll file by Friday? ^t0003',
        '',
        '| who | what |',
        '| --- | --- |',
        '',
        '^tbl1',
        '',
      ].join('\n'),
    },
  ],
};

const general = proposalSchemaNamed('proposals')!;

const item = (fields: Record<string, unknown> = {}) => ({
  kind: 'task',
  title: 'Send Mara the payroll file',
  properties: { status: 'next' },
  source: '[[2026-10-01 Standup#^t0003]]',
  confidence: 'high',
  why: 'Mara asked for it on the call.',
  ...fields,
});
const answer = (...items: unknown[]) => JSON.stringify({ proposals: items });
const problemOf = (text: string): string | null => {
  const read = general.read(text, CONTEXT);
  return read.ok ? null : read.problem;
};

describe('the general proposals schema', () => {
  it('reads each item into a proposal of a new note, citing its block', () => {
    const read = general.read(
      answer(item(), item({ kind: 'decision', title: 'Ship Friday' })),
      CONTEXT,
    );
    expect(read).toEqual({
      ok: true,
      value: [
        {
          kind: 'task',
          payload: {
            title: 'Send Mara the payroll file',
            folder: null,
            properties: { status: 'next' },
            body: '',
          },
          source: '[[2026-10-01 Standup#^t0003]]',
          confidence: 'high',
          why: 'Mara asked for it on the call.',
        },
        expect.objectContaining({ kind: 'decision' }),
      ],
    });
  });

  it('reads an answer with nothing to propose as none', () => {
    expect(general.read(answer(), CONTEXT)).toEqual({ ok: true, value: [] });
  });

  it('reads JSON a model fenced, and refuses anything else around it', () => {
    expect(problemOf(`\`\`\`json\n${answer(item())}\n\`\`\``)).toBeNull();
    expect(problemOf(`Here you go:\n${answer(item())}`)).toBe('It is not JSON.');
    expect(problemOf('{"proposals": [')).toBe('It is not JSON.');
  });

  it('refuses an answer that is not its list, or too long a one', () => {
    expect(problemOf(JSON.stringify({ items: [] }))).toBe('It is not { "proposals": [ … ] }.');
    expect(problemOf(JSON.stringify([item()]))).toBe('It is not { "proposals": [ … ] }.');
    const many = Array.from({ length: MAX_PROPOSALS_PER_ANSWER + 1 }, () => item());
    expect(problemOf(answer(...many))).toBe(
      `It made ${MAX_PROPOSALS_PER_ANSWER + 1} proposals; one run makes at most ${MAX_PROPOSALS_PER_ANSWER}.`,
    );
  });

  it('refuses the whole answer for one bad item, saying which', () => {
    expect(problemOf(answer(item(), item({ kind: 'edit' })))).toBe(
      'Item 2: Its kind is not one of task, decision, follow-up, person, term, project.',
    );
    expect(problemOf(answer('a task'))).toBe('Item 1: It is not an object.');
    expect(problemOf(answer(item({ source: undefined })))).toBe('Item 1: It has no "source".');
    expect(problemOf(answer(item({ confidence: 3 })))).toBe('Item 1: It has no "confidence".');
    expect(problemOf(answer(item({ why: 4 })))).toBe('Item 1: Its "why" is not text.');
  });

  it('never proposes a change to a note already there: a link proposal is not a kind it takes', () => {
    expect(problemOf(answer(item({ kind: 'link' })))).toMatch(/^Item 1: Its kind is not one of/);
  });

  it('holds each payload to the rules Accept writes by', () => {
    expect(problemOf(answer(item({ title: '' })))).toBe('Item 1: Its payload needs a title.');
    expect(problemOf(answer(item({ properties: ['status'] })))).toBe(
      'Item 1: Its payload’s properties must be keys and values.',
    );
    expect(problemOf(answer(item({ body: 7 })))).toBe('Item 1: Its payload’s body must be text.');
    expect(problemOf(answer(item({ folder: '.atlas/automations' })))).toMatch(
      /^Item 1: .*hidden configuration/,
    );
  });

  it('refuses a confidence it does not know', () => {
    expect(problemOf(answer(item({ confidence: 'certain' })))).toBe(
      'Item 1: Its confidence is not one of high, medium, low.',
    );
  });

  it('refuses a source that cites no block of a note the run read', () => {
    expect(problemOf(answer(item({ source: '[[2026-10-01 Standup]]' })))).toMatch(
      /is not a link to a block/,
    );
    expect(problemOf(answer(item({ source: '[[Other meeting#^t0003]]' })))).toBe(
      'Item 1: Its source cites "Other meeting", which is not a note this run read.',
    );
    expect(problemOf(answer(item({ source: '[[2026-10-01 Standup#^t9999]]' })))).toBe(
      'Item 1: 2026-10-01 Standup has no block ^t9999.',
    );
  });
});

describe('citedBlockProblem', () => {
  it('finds a block by its path or its title, inline or on a line of its own', () => {
    const { notes } = CONTEXT;
    expect(citedBlockProblem('[[Meetings/2026-10-01 Standup.md#^t0003]]', notes)).toBeNull();
    expect(citedBlockProblem('[[2026-10-01 standup#^tbl1]]', notes)).toBeNull();
    expect(citedBlockProblem('![[2026-10-01 Standup#^t0003]]', notes)).toMatch(/not a link/);
    expect(citedBlockProblem('[[2026-10-01 Standup#Heading]]', notes)).toMatch(/not a link/);
    expect(citedBlockProblem('[[2026-10-01 Standup#^]]', notes)).toMatch(/not a link/);
  });
});

describe('a new kind of proposal (the extension point P29-05 plugs into)', () => {
  interface MeetingItem {
    readonly kind: 'task' | 'decision';
    readonly title: string;
    readonly owner: string | null;
    readonly sourceBlock: string;
    readonly confidence: string;
  }
  const meetingItems: ProposalSchema<MeetingItem> = {
    name: 'meeting-items',
    key: 'items',
    itemShape: '{ "kind", "title", "owner", "source_block", "confidence" }.',
    readItem: (value) => {
      const fields = value as Record<string, unknown>;
      if (fields['kind'] !== 'task' && fields['kind'] !== 'decision') {
        return { ok: false, problem: 'Not an action item.' };
      }
      return {
        ok: true,
        value: {
          kind: fields['kind'],
          title: String(fields['title']),
          owner: typeof fields['owner'] === 'string' ? fields['owner'] : null,
          sourceBlock: String(fields['source_block']),
          confidence: String(fields['confidence']),
        },
      };
    },
    proposalOf: (each, context) => ({
      kind: each.kind,
      payload: {
        title: each.title,
        properties: each.owner === null ? {} : { owner: `[[${each.owner}]]` },
      },
      source: `[[${context.notes[0]!.path.replace(/\.md$/, '')}#^${each.sourceBlock}]]`,
      confidence: each.confidence,
      why: '',
    }),
  };
  const registered = registerProposalSchema(meetingItems);

  it('reads its own items, and tells the model its own shape', () => {
    const read = registered.read(
      JSON.stringify({
        items: [
          {
            kind: 'task',
            title: 'Send the file',
            owner: 'Mara Quill',
            source_block: 't0003',
            confidence: 'medium',
          },
        ],
      }),
      CONTEXT,
    );
    expect(read).toMatchObject({
      ok: true,
      value: [
        {
          kind: 'task',
          payload: { title: 'Send the file', properties: { owner: '[[Mara Quill]]' } },
          source: '[[Meetings/2026-10-01 Standup#^t0003]]',
          confidence: 'medium',
        },
      ],
    });
    expect(registered.instructions).toContain('{ "items": [ … ] }');
    expect(registered.instructions).toContain('"source_block"');
  });

  it('is held to the shared rules it cannot skip: a block that is not there is refused', () => {
    const read = registered.read(
      JSON.stringify({
        items: [{ kind: 'task', title: 'Send', source_block: 'nope', confidence: 'high' }],
      }),
      CONTEXT,
    );
    expect(read).toEqual({ ok: false, problem: 'Item 1: 2026-10-01 Standup has no block ^nope.' });
  });

  it('is named among the schemas only once added to the registry', () => {
    expect(Object.keys(PROPOSAL_SCHEMAS)).toEqual(['proposals']);
    expect(proposalSchemaNamed('meeting-items')).toBeNull();
    expect(proposalSchemaNamed('constructor')).toBeNull();
  });
});

describe('proposalNoteProperties', () => {
  it('writes a checked proposal as an open proposal note, saying what made it', () => {
    const read = general.read(answer(item()), CONTEXT);
    if (!read.ok) throw new Error(read.problem);
    expect(proposalNoteProperties(read.value[0]!, 'Meeting actions · 2026-10-11 09:00:00')).toEqual(
      {
        type: 'proposal',
        kind: 'task',
        state: 'open',
        confidence: 'high',
        source: '[[2026-10-01 Standup#^t0003]]',
        made_by: 'Meeting actions · 2026-10-11 09:00:00',
        payload: { title: 'Send Mara the payroll file', properties: { status: 'next' } },
      },
    );
  });
});

describe('answerJson', () => {
  it('reads an answer padded with blank lines', () => {
    expect(answerJson('\n {"a": 1} \n')).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe('readNoteAnswer', () => {
  it('reads the one new note an answer describes', () => {
    const text = JSON.stringify({
      note: { title: 'Morning brief', body: '# Today\n', properties: { tags: ['brief'], day: 3 } },
    });
    expect(readNoteAnswer(text)).toEqual({
      ok: true,
      value: { title: 'Morning brief', body: '# Today\n', properties: { tags: ['brief'], day: 3 } },
    });
  });

  it('refuses a note it cannot write as asked', () => {
    const problem = (note: unknown) => {
      const read = readNoteAnswer(JSON.stringify({ note }));
      return read.ok ? null : read.problem;
    };
    expect(readNoteAnswer('nope')).toEqual({ ok: false, problem: 'It is not JSON.' });
    expect(readNoteAnswer('{"notes": {}}')).toEqual({
      ok: false,
      problem: 'It is not { "note": { … } }.',
    });
    expect(problem({ body: 'x' })).toBe('Its note has no title.');
    expect(problem({ title: 'A', body: 3 })).toBe('Its note’s body is not text.');
    expect(problem({ title: 'A', properties: 'x' })).toBe(
      'Its note’s properties are not keys and values.',
    );
    expect(problem({ title: 'A', properties: { atlas: 'automation' } })).toMatch(
      /Atlas keeps that one/,
    );
    expect(problem({ title: 'A', properties: { due: { at: 1 } } })).toBe(
      '“due” is not text, a number, true or false, or a list.',
    );
    expect(problem({ title: 'A', properties: { done: true } })).toBeNull();
  });
});
