import { describe, expect, it } from 'vitest';
import type { NewProposal, VaultPath } from '@atlas/domain';
import { jsonLinesMarkdown, jsonLinesNote, proposalVault } from '../testing/proposal-vault.ts';
import { atlasQueryIndex } from '../testing/query-index.ts';
import { writeProposals } from './write-proposals.ts';

const proposal = (id: string, name: string): NewProposal => ({
  kind: 'task',
  confidence: null,
  source: null,
  madeBy: 'test',
  id,
  name,
  reason: 'Because.',
  payload: { title: name, folder: null, properties: {}, body: '', linkFrom: null },
});

/** A vault whose index holds `indexed` — all of `files` unless said: it may lag them. */
function vault(files: Record<string, string>, indexed: Record<string, string> = files) {
  const setup = proposalVault(files);
  const index = {
    ...setup.ports.index,
    query: atlasQueryIndex({ files: indexed, markdown: jsonLinesMarkdown() }),
  };
  return { setup, ports: { fs: setup.ports.fs, markdown: setup.ports.markdown, index } };
}

describe('writeProposals', () => {
  it('writes each as an open proposal, numbering a name another note has, making the folder', async () => {
    const { setup, ports } = vault({
      'Inbox/Proposals/Call Ada.md': jsonLinesNote({ type: 'task' }),
    });
    const written = await writeProposals({
      ...ports,
      proposals: [proposal('a', 'Call Ada'), proposal('b', 'Call Ada')],
    });
    expect(written).toEqual({
      written: ['Inbox/Proposals/Call Ada 2.md', 'Inbox/Proposals/Call Ada 3.md'],
      left: [],
    });
    expect(setup.propertiesOf('Inbox/Proposals/Call Ada 2.md')).toMatchObject({
      type: 'proposal',
      state: 'open',
      proposal_id: 'a',
    });
  });

  it('writes nothing for an id the vault holds, the Archive included', async () => {
    const { ports } = vault({
      'Archive/Inbox/Proposals/Old.md': jsonLinesNote({ type: 'proposal', proposal_id: 'a' }),
    });
    expect(await writeProposals({ ...ports, proposals: [proposal('a', 'Call Ada')] })).toEqual({
      written: [],
      left: [],
    });
  });

  it('writes nothing for an id a proposal waiting in the folder holds, before the index knows it', async () => {
    const waiting = {
      'Inbox/Proposals/Call Ada 7.md': jsonLinesNote({ type: 'proposal', proposal_id: 'a' }),
    };
    const { ports } = vault(waiting, {});
    expect(await writeProposals({ ...ports, proposals: [proposal('a', 'Call Ada')] })).toEqual({
      written: [],
      left: [],
    });
  });

  it('passes on a fault reading the folder', async () => {
    const { ports } = vault({});
    const fs = { ...ports.fs, listDirectory: async () => Promise.reject(new Error('denied')) };
    await expect(writeProposals({ ...ports, fs, proposals: [proposal('a', 'X')] })).rejects.toThrow(
      'denied',
    );
  });

  it('says which could not be written, and writes the rest', async () => {
    const { ports } = vault({});
    const fs = {
      ...ports.fs,
      createNote: async (args: { path: VaultPath; contents: string }) => {
        if (args.path.includes('Refused')) throw new Error('The disk said no.');
        await ports.fs.createNote(args);
      },
    };
    const outcome = await writeProposals({
      ...ports,
      fs,
      proposals: [proposal('a', 'Refused'), proposal('b', 'Fine')],
    });
    expect(outcome).toEqual({
      written: ['Inbox/Proposals/Fine.md'],
      left: [{ path: 'Inbox/Proposals/Refused.md', reason: 'The disk said no.' }],
    });
  });

  it('writes nothing, and asks nothing, when there is nothing to propose', async () => {
    const { ports } = vault({});
    const index = { ...ports.index, query: async () => Promise.reject(new Error('asked')) };
    expect(await writeProposals({ ...ports, index, proposals: [] })).toEqual({
      written: [],
      left: [],
    });
  });
});
