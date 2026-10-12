import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { applyProposal, type LinkTarget, type ProposalVault } from './apply-proposal.ts';
import { readProposal, type ProposalKind, type ProposalNote } from './proposal.ts';

const SOURCE = '[[2026-10-01 Standup#^t0003]]';
const MEETING = '[[2026-10-01 Standup]]';

function proposal(
  kind: ProposalKind,
  payload: Record<string, unknown>,
  more: Record<string, unknown> = {},
): ProposalNote {
  const reading = readProposal({
    path: createVaultPath('Inbox/Proposals/P.md'),
    properties: { type: 'proposal', kind, source: SOURCE, payload, ...more },
  });
  if (!reading.ok) throw new Error(reading.problem);
  return reading.proposal;
}

const empty: ProposalVault = { notePaths: [], target: null };
const notes = (...paths: string[]): VaultPath[] => paths.map(createVaultPath);

function writesOf(made: ProposalNote, vault: ProposalVault = empty) {
  const applied = applyProposal(made, vault);
  if (!applied.ok) throw new Error(applied.problem);
  return applied.writes;
}

function problemOf(made: ProposalNote, vault: ProposalVault = empty): string {
  const applied = applyProposal(made, vault);
  if (applied.ok) throw new Error('applied');
  return applied.problem;
}

describe('applyProposal — a task', () => {
  it('creates a task citing the block it came from, linked to its meeting', () => {
    const task = proposal('task', {
      title: 'Send Mara the payroll file',
      properties: { status: 'next', meeting: MEETING },
    });
    expect(writesOf(task)).toEqual([
      {
        kind: 'create',
        path: 'Send Mara the payroll file.md',
        properties: { type: 'task', status: 'next', meeting: MEETING, source: SOURCE },
        body: '',
      },
    ]);
  });

  it('puts it in the folder its payload names, with its body', () => {
    const task = proposal('task', { title: 'Call Tobias', folder: 'Work/Tasks', body: 'Re: Q4.' });
    expect(writesOf(task)).toMatchObject([
      { kind: 'create', path: 'Work/Tasks/Call Tobias.md', body: 'Re: Q4.' },
    ]);
  });

  it('keeps the type its kind makes, whatever the payload says, and cites its own source', () => {
    const task = proposal('task', {
      title: 'Call Tobias',
      properties: { Type: 'project', source: '[[Elsewhere]]' },
    });
    const [write] = writesOf(task);
    expect(write).toMatchObject({ properties: { type: 'task', source: SOURCE } });
    expect(write?.kind === 'create' && Object.keys(write.properties)).toEqual(['type', 'source']);
  });

  it('writes no source when the proposal cites none', () => {
    const task = proposal('task', { title: 'Call Tobias' }, { source: null });
    expect(writesOf(task)).toMatchObject([{ properties: { type: 'task' } }]);
    expect(writesOf(task)[0]).not.toHaveProperty('properties.source');
  });

  it.each([
    ['.atlas/views', /hidden configuration/],
    ['Projects/node_modules', /a folder the vault never shows/],
    ['Archive/Old', /in the Archive/],
    ['archive', /in the Archive/],
    ['inbox/proposals', /where proposals wait/],
  ])('refuses to make it in %s, saying why', (folder, reason) => {
    expect(problemOf(proposal('task', { title: 'Call Tobias', folder }))).toMatch(reason);
  });

  it('cuts a long title to a file name the disk takes, by whole characters', () => {
    const [write] = writesOf(proposal('task', { title: `${'é'.repeat(200)}x` }));
    expect(write?.path).toBe(`${'é'.repeat(126)}.md`); // 252 bytes, and the .md makes 255
  });

  it('refuses when a note is already where it would go, in any case, since it may be that task', () => {
    const task = proposal('task', { title: 'Call Tobias' });
    expect(problemOf(task, { notePaths: notes('call tobias.md'), target: null })).toBe(
      'There is already a note at Call Tobias.md, which may be this one. Edit the title to make another.',
    );
  });
});

describe('applyProposal — every other kind that makes a note', () => {
  it.each([
    ['follow-up', 'task', true],
    ['decision', 'decision', true],
    ['person', 'person', false],
    ['term', 'term', false],
    ['project', 'project', false],
  ] as const)('a %s makes a %s note (citing its source: %s)', (kind, type, cites) => {
    const [write] = writesOf(proposal(kind, { title: 'Larkspur Payroll' }));
    expect(write).toMatchObject({ kind: 'create', path: 'Larkspur Payroll.md' });
    expect(write?.kind === 'create' && write.properties).toEqual({
      type,
      ...(cites && { source: SOURCE }),
    });
  });

  it('a decision keeps its date, meeting, project and people as proposed', () => {
    const decision = proposal('decision', {
      title: 'Ship on Friday',
      properties: { date: '2026-10-01', meeting: MEETING, people: ['[[Mara Quill]]'] },
    });
    expect(writesOf(decision)).toMatchObject([
      {
        properties: {
          type: 'decision',
          date: '2026-10-01',
          meeting: MEETING,
          people: ['[[Mara Quill]]'],
          source: SOURCE,
        },
      },
    ]);
  });
});

const linkPayloadOf = (made: ProposalNote) => made.payload as unknown as Record<string, unknown>;

describe('applyProposal — a link', () => {
  const link = proposal('link', {
    note: 'People/Mara Quill.md',
    property: 'companies',
    link: '[[Larkspur Payroll]]',
    digest: 'aaaa0001',
  });
  const target = (more: Partial<LinkTarget> = {}): ProposalVault => ({
    notePaths: [],
    target: { digest: 'aaaa0001', value: undefined, relation: { many: true }, ...more },
  });

  it('adds the link to a relation holding several notes', () => {
    expect(writesOf(link, target({ value: ['[[Fenn & Co]]'] }))).toEqual([
      {
        kind: 'set',
        path: 'People/Mara Quill.md',
        changes: { companies: ['[[Fenn & Co]]', '[[Larkspur Payroll]]'] },
      },
    ]);
  });

  it('sets a relation holding one note to the link', () => {
    expect(writesOf(link, target({ relation: { many: false } }))).toMatchObject([
      { changes: { companies: '[[Larkspur Payroll]]' } },
    ]);
  });

  it('refuses when the note changed since the proposal was made', () => {
    expect(problemOf(link, target({ digest: 'bbbb0002' }))).toBe(
      'Mara Quill changed since this was proposed, so it was left as it is.',
    );
  });

  it('refuses when the note is gone', () => {
    expect(problemOf(link, empty)).toBe('Mara Quill is not there any more.');
  });

  it('refuses when the note’s type has no such relation', () => {
    expect(problemOf(link, target({ relation: null }))).toMatch(/no relation called companies/);
  });

  it('refuses when the note already links it, as there is nothing to do', () => {
    expect(problemOf(link, target({ value: '[[Larkspur Payroll]]' }))).toMatch(/already links/);
  });

  it('refuses when the note already links the same note spelt another way', () => {
    const vault = {
      ...target({ value: ['[[Companies/Larkspur Payroll|Larkspur]]'] }),
      notePaths: notes('Companies/Larkspur Payroll.md'),
    };
    expect(problemOf(link, vault)).toMatch(/already links/);
  });

  it('still adds a link to a different note that reads alike', () => {
    const vault = {
      ...target({ value: ['[[Companies/Larkspur Payroll|Larkspur]]'] }),
      notePaths: notes('Companies/Larkspur Payroll.md', 'Clients/Larkspur Payroll.md'),
    };
    const other = proposal('link', {
      ...linkPayloadOf(link),
      link: '[[Clients/Larkspur Payroll]]',
    });
    expect(writesOf(other, vault)).toMatchObject([{ kind: 'set' }]);
  });
});

describe('applyProposal — a proposal that is not open', () => {
  it.each(['accepted', 'rejected'])('refuses one already %s', (state) => {
    expect(problemOf(proposal('task', { title: 'X' }, { state }))).toBe(`It was already ${state}.`);
  });
});

describe('applyProposal — a person who joins a meeting (P29-04)', () => {
  const STANDUP = 'Inbox/Meetings/2026-10-06 Standup.md';
  const person = proposal('person', {
    title: 'Ada Venn',
    folder: 'People',
    properties: { email: 'ada@larkspur.example' },
    link_from: { note: STANDUP, property: 'people' },
  });
  const meeting = (value: unknown, many = true): LinkTarget => ({
    digest: 'whatever it holds now',
    value,
    relation: { many },
  });

  it('makes the person, then adds them to the meeting’s people, keeping who is there', () => {
    const vault = { notePaths: notes(STANDUP), target: meeting(['[[Mara Quill]]']) };
    expect(writesOf(person, vault)).toEqual([
      {
        kind: 'create',
        path: 'People/Ada Venn.md',
        properties: { type: 'person', email: 'ada@larkspur.example' },
        body: '',
      },
      { kind: 'set', path: STANDUP, changes: { people: ['[[Mara Quill]]', '[[Ada Venn]]'] } },
    ]);
  });

  it('links them by path when another note has their name', () => {
    const vault = { notePaths: notes(STANDUP, 'Clients/Ada Venn.md'), target: meeting(undefined) };
    expect(writesOf(person, vault)[1]).toEqual({
      kind: 'set',
      path: STANDUP,
      changes: { people: ['[[People/Ada Venn]]'] },
    });
  });

  it('only makes the person when the meeting already links their name', () => {
    const vault = { notePaths: notes(STANDUP), target: meeting(['[[Ada Venn]]']) };
    expect(writesOf(person, vault).map(({ kind }) => kind)).toEqual(['create']);
  });

  it('still makes the person when the meeting is gone, and refuses a meeting with no such relation', () => {
    expect(writesOf(person, { notePaths: [], target: null }).map(({ kind }) => kind)).toEqual([
      'create',
    ]);
    const unrelated = { notePaths: notes(STANDUP), target: { ...meeting([]), relation: null } };
    expect(problemOf(person, unrelated)).toMatch(/no relation called people/);
  });

  it('links the person already made — from another meeting’s proposal — rather than refusing', () => {
    const vault = {
      notePaths: notes(STANDUP, 'people/ada venn.md'),
      target: meeting([]),
      heldTypes: ['Person'],
    };
    expect(writesOf(person, vault)).toEqual([
      { kind: 'set', path: STANDUP, changes: { people: ['[[ada venn]]'] } },
    ]);
  });

  it.each([[['project']], [[]], [undefined]])(
    'refuses a note at their path that is not a person (%j), rather than linking it as one',
    (heldTypes) => {
      const vault = {
        notePaths: notes(STANDUP, 'People/Ada Venn.md'),
        target: meeting([]),
        ...(heldTypes !== undefined && { heldTypes }),
      };
      expect(problemOf(person, vault)).toMatch(/not a person/);
    },
  );

  it('adds no second link when the meeting links them in another spelling', () => {
    const vault = { notePaths: notes(STANDUP), target: meeting(['[[ada venn]]']) };
    expect(writesOf(person, vault).map(({ kind }) => kind)).toEqual(['create']);
  });

  it('refuses a person already made when nothing joins a relation', () => {
    const plain = proposal('person', { title: 'Ada Venn', folder: 'People' });
    expect(problemOf(plain, { notePaths: notes('People/Ada Venn.md'), target: null })).toMatch(
      /already a note/,
    );
  });
});

describe('applyProposal — a link with no digest', () => {
  const STANDUP = 'Inbox/Meetings/2026-10-06 Standup.md';
  const link = (property: string, to: string) =>
    proposal('link', { note: STANDUP, property, link: to });
  const target = (value: unknown, many: boolean): LinkTarget => ({
    digest: 'changed by other steps since',
    value,
    relation: { many },
  });

  it('adds to a list whatever else the note now holds', () => {
    expect(
      writesOf(link('people', '[[Tobias Fenn]]'), {
        notePaths: [],
        target: target(['[[Mara Quill]]'], true),
      }),
    ).toEqual([
      { kind: 'set', path: STANDUP, changes: { people: ['[[Mara Quill]]', '[[Tobias Fenn]]'] } },
    ]);
  });

  it('fills an empty single link, and never replaces one set since', () => {
    expect(
      writesOf(link('project', '[[Ledger]]'), { notePaths: [], target: target(null, false) }),
    ).toEqual([{ kind: 'set', path: STANDUP, changes: { project: '[[Ledger]]' } }]);
    expect(
      problemOf(link('project', '[[Ledger]]'), {
        notePaths: [],
        target: target('[[Payrun]]', false),
      }),
    ).toBe('2026-10-06 Standup already links [[Payrun]] in project; this would replace it.');
  });
});
