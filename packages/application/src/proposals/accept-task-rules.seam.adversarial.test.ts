import { describe, expect, it } from 'vitest';
import { jsonLinesNote, proposalVault, vaultPath } from '../testing/proposal-vault.ts';
import { acceptProposalNote } from './accept-proposal.ts';

// Seam #64 (proposals) x #66 (GTD task rules, ADR-0029): every write that
// makes or changes a task is held to the task rules, "whoever makes it".
const TODAY = '2026-10-08';
const PROPOSAL = 'Inbox/Proposals/Chase Tobias.md';

const proposal = (kind: string, properties: Record<string, unknown>, title = 'Chase Tobias') =>
  jsonLinesNote({
    type: 'proposal',
    kind,
    state: 'open',
    payload: { title, properties },
  });

const accept = (files: Record<string, string>, payload?: unknown) => {
  const setup = proposalVault(files);
  const accepted = acceptProposalNote({
    ports: setup.ports,
    path: vaultPath(PROPOSAL),
    today: TODAY,
    ...(payload !== undefined && { payload }),
  });
  return { setup, accepted };
};

describe('accepting a task proposal is held to the GTD task rules', () => {
  it('refuses a task proposal that would make a task Waiting with nobody, writing no task', async () => {
    const { setup, accepted } = accept({ [PROPOSAL]: proposal('task', { status: 'waiting' }) });
    await expect(accepted).rejects.toThrow(/waiting task needs someone/i);
    expect(setup.paths()).not.toContain('Chase Tobias.md');
    expect(setup.paths()).toContain(PROPOSAL);
  });

  it('refuses a follow-up proposal edited to Waiting with nobody, writing no task', async () => {
    const { setup, accepted } = accept(
      { [PROPOSAL]: proposal('follow-up', { status: 'next' }) },
      { title: 'Chase Tobias', properties: { status: 'waiting' } },
    );
    await expect(accepted).rejects.toThrow(/waiting task needs someone/i);
    expect(setup.paths()).not.toContain('Chase Tobias.md');
  });

  it('dates a task proposal accepted already finished (Archive) with completed: today', async () => {
    const { setup, accepted } = accept({ [PROPOSAL]: proposal('task', { status: 'archive' }) });
    await accepted;
    expect(setup.propertiesOf('Chase Tobias.md')).toMatchObject({
      type: 'task',
      status: 'archive',
      completed: TODAY,
    });
  });
});
