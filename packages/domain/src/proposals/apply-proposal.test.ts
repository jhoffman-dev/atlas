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
});

describe('applyProposal — a proposal that is not open', () => {
  it.each(['accepted', 'rejected'])('refuses one already %s', (state) => {
    expect(problemOf(proposal('task', { title: 'X' }, { state }))).toBe(`It was already ${state}.`);
  });
});
