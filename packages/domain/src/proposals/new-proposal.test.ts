import { describe, expect, it } from 'vitest';
import { createVaultPath } from '../vault/vault-path.ts';
import { compileProposalIdsQuery, proposalFileFor, type NewProposal } from './new-proposal.ts';
import { readProposal } from './proposal.ts';

const MEETING = createVaultPath('Inbox/Meetings/2026-10-06 Standup.md');

const PERSON: NewProposal = {
  kind: 'person',
  confidence: 'high',
  source: '[[2026-10-06 Standup]]',
  madeBy: 'meeting links',
  id: 'meeting links:x:person:ada@larkspur.example',
  name: 'Ada Venn — Q3: plan/review',
  reason: 'Ada was at this meeting.',
  payload: {
    title: 'Ada Venn',
    folder: createVaultPath('People'),
    properties: { email: 'ada@larkspur.example' },
    body: '',
    linkFrom: { note: MEETING, property: 'people' },
  },
};

describe('proposalFileFor', () => {
  it('is an open proposal in the Inbox that reads back as what was proposed', () => {
    const file = proposalFileFor(PERSON);
    expect(file.path).toBe('Inbox/Proposals/Ada Venn — Q3 plan review.md');
    expect(file.body).toBe('Ada was at this meeting.\n');
    expect(file.properties).toMatchObject({
      state: 'open',
      proposal_id: PERSON.id,
      made_by: 'meeting links',
    });
    const reading = readProposal({ path: file.path, properties: file.properties });
    expect(reading).toEqual({
      ok: true,
      proposal: {
        path: file.path,
        kind: 'person',
        state: 'open',
        confidence: 'high',
        source: '[[2026-10-06 Standup]]',
        madeBy: 'meeting links',
        payload: PERSON.payload,
      },
    });
  });

  it('leaves out what it does not hold, and names a nameless one', () => {
    const file = proposalFileFor({
      ...PERSON,
      confidence: null,
      source: null,
      reason: '',
      name: ' / ',
    });
    expect(file.path).toBe('Inbox/Proposals/Proposal.md');
    expect(file.body).toBe('');
    expect(file.properties).not.toHaveProperty('confidence');
    expect(file.properties).not.toHaveProperty('source');
  });
});

describe('compileProposalIdsQuery', () => {
  it('binds every id', () => {
    const { sql, parameters } = compileProposalIdsQuery(['a', "b'; DROP"]);
    expect(parameters).toEqual(['proposal_id', 'a', "b'; DROP"]);
    expect(sql).not.toContain('DROP');
  });
});
